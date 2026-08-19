import { createFileRoute } from "@tanstack/react-router";

// Proxy reverso same-origin pra apps/api — mesmo padrão do rewrites() do
// Next.js usado no Integrador Bling (outro projeto de vocês), só que
// implementado como rota do próprio TanStack Start (Nitro/Vite não tem um
// "rewrites" nativo). O browser só fala com o domínio do frontend
// (apticket.aptechinfo.com.br); ele que repassa pra API por trás, então o
// backend nunca fica exposto direto.
//
// /backend/tickets no browser vira /tickets no Nest — por isso a API NÃO
// tem app.setGlobalPrefix('backend'): o prefixo existe só aqui, na borda,
// e é removido antes de repassar.
//
// SÓ funciona pra REST — não dá pra fazer upgrade de WebSocket (Socket.IO,
// canal de chat) através de um handler de request comum. Isso é resolvido
// direto no Traefik, roteando /socket.io/ pro serviço da API sem passar por
// aqui — ver infra/docker-compose.yml e o README.
//
// INTERNAL_BACKEND_URL: hostname interno do serviço Docker da API (nunca
// aponta pra fora, só tráfego container-a-container dentro do Dokploy/Swarm).
const BACKEND_URL = process.env.INTERNAL_BACKEND_URL ?? "http://api:3001";
const PREFIX = "/backend";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetPath = url.pathname.startsWith(PREFIX)
    ? url.pathname.slice(PREFIX.length)
    : url.pathname;
  const target = `${BACKEND_URL}${targetPath}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  });

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const Route = createFileRoute("/backend/$")({
  server: {
    handlers: {
      GET: ({ request }) => proxy(request),
      POST: ({ request }) => proxy(request),
      PATCH: ({ request }) => proxy(request),
      PUT: ({ request }) => proxy(request),
      DELETE: ({ request }) => proxy(request),
      OPTIONS: ({ request }) => proxy(request),
    },
  },
});
