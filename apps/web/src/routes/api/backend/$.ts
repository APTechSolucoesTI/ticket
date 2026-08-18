import { createFileRoute } from "@tanstack/react-router";

// Proxy reverso same-origin pra apps/api — mesma ideia do rewrites() do
// Next.js que vocês já usam noutro projeto (apbling-backend), só que
// implementado como rota do próprio TanStack Start em vez de config do
// framework (Nitro/Vite não tem um "rewrites" nativo aqui). O browser só
// fala com o domínio do frontend; ele que repassa pra API por trás.
//
// SÓ funciona pra REST — não dá pra fazer upgrade de WebSocket (Socket.IO,
// canal de chat) através de um handler de request comum. Isso precisa ser
// resolvido no reverse proxy de infra (Traefik/Nginx) apontando pro mesmo
// `/backend` prefix com os headers de Upgrade — ver infra/docker-compose.yml
// e o README. O client do chat conecta direto em VITE_API_URL.
//
// BACKEND_URL: nome do serviço Docker (ex.: "http://api:3001" dentro do
// compose) — nunca aponta pra fora, só tráfego interno entre containers.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://api:3001";
const PREFIX = "/api/backend";

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
  const targetPath = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
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

export const Route = createFileRoute("/api/backend/$")({
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
