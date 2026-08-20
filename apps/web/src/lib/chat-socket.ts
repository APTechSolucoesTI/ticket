// Client do canal de chat em tempo real (ChatGateway, apps/api). Não passa
// pelo proxy same-origin (src/routes/backend/$.ts) — upgrade de WebSocket
// não dá pra fazer num handler de request comum. Conecta em VITE_API_URL,
// que em produção é o MESMO domínio público do frontend (o Traefik roteia
// /socket.io/ direto pro serviço da API, sem passar pelo proxy — ver
// README, seção "WebSocket").
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getToken } from "@/lib/session";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

type ChatMessageEvent = {
  id: string;
  ticketId: string;
  content: string;
  authorId: string;
  authorType: "agent" | "contact";
  createdAt: string;
};
type TypingEvent = { ticketId: string; userId: string; isTyping: boolean };
type PresenceEvent = { userId: string; online: boolean };

/**
 * Conecta uma vez por sessão de ticket aberto. `onMessage` roda a cada
 * `message:receive` — quem chama decide o que fazer (ex.: invalidar a
 * query de mensagens do ticket).
 */
export function useChatSocket(
  ticketId: string | undefined,
  onMessage: (msg: ChatMessageEvent) => void,
) {
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const socketRef = useRef<Socket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!ticketId) return;
    const token = getToken();
    if (!token) return;

    const socket = io(`${API_URL}/chat`, { auth: { token }, transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("ticket:join", { ticketId });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("message:receive", (msg: ChatMessageEvent) => {
      if (msg.ticketId === ticketId) onMessageRef.current(msg);
    });
    socket.on("typing", (ev: TypingEvent) => {
      if (ev.ticketId !== ticketId) return;
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (ev.isTyping) next.add(ev.userId);
        else next.delete(ev.userId);
        return next;
      });
    });
    // presence:update existe no gateway mas essa tela só precisa de
    // typing/mensagem por enquanto — sem consumidor de presença ainda.
    socket.on("presence:update", (_ev: PresenceEvent) => {});

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      setTypingUsers(new Set());
    };
  }, [ticketId]);

  function sendMessage(content: string) {
    socketRef.current?.emit("message:send", { ticketId, content });
  }

  function setTyping(isTyping: boolean) {
    socketRef.current?.emit("typing", { ticketId, isTyping });
  }

  return { connected, typingUsers, sendMessage, setTyping };
}
