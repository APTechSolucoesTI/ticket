import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, X, Loader2, ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { CustomerChatComposer } from "@/components/chat/CustomerChatComposer";
import { AttachmentPreview, type Attachment } from "@/components/ticket/AttachmentPreview";
import {
  getPortalToken,
  portalFetch,
  requestPortalOtp,
  setPortalToken,
  verifyPortalOtp,
} from "@/lib/portal-client";

type Contract = {
  id: string;
  name: string;
  description: string | null;
};

type SessionResp =
  | { found: false }
  | {
      found: true;
      contact: {
        id: string;
        name: string;
        email: string;
        company_name: string | null;
        can_open_tickets: boolean;
      };
      has_active_contract: boolean;
      contracts: Contract[];
      tickets: Array<{
        id: string;
        number: number;
        subject: string;
        status: string;
        created_at: string;
      }>;
    };

export type PortalChatSession = Omit<Extract<SessionResp, { found: true }>, "found">;

type HomeChatProps = {
  authenticatedSession?: PortalChatSession;
  onTicketCreated?: () => void | Promise<void>;
};

type ChatMsg = {
  id: string;
  content: string;
  author_type: string;
  author_name: string;
  is_internal: boolean;
  created_at: string;
  attachments?: Attachment[];
};

type Step = "closed" | "email" | "otp" | "start" | "chat";

const STORAGE_KEY = "apticket_home_chat_v1";

type Persisted = { email: string; ticket_id: string; number: number } | null;

function loadPersisted(): Persisted {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function savePersisted(v: Persisted) {
  if (typeof window === "undefined") return;
  if (!v) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

export default function HomeChat({ authenticatedSession, onTicketCreated }: HomeChatProps) {
  const [step, setStep] = useState<Step>("closed");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<Extract<SessionResp, { found: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string>("");
  const [firstMessage, setFirstMessage] = useState("");
  const [ticket, setTicket] = useState<{ id: string; number: number } | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authenticatedSession) return;
    setEmail(authenticatedSession.contact.email);
    setSession({ found: true, ...authenticatedSession });
    setContractId((current) =>
      authenticatedSession.contracts.some((contract) => contract.id === current)
        ? current
        : (authenticatedSession.contracts[0]?.id ?? ""),
    );
  }, [authenticatedSession]);

  // Restore existing chat on open (only if the verified session token is still present -
  // otherwise the poll effect would immediately 401 and bounce back anyway).
  useEffect(() => {
    if (step === "closed") return;
    if (ticket) return;
    const p = loadPersisted();
    const belongsToAuthenticatedContact =
      !authenticatedSession ||
      p?.email.toLocaleLowerCase() === authenticatedSession.contact.email.toLocaleLowerCase();
    if (p && getPortalToken() && belongsToAuthenticatedContact) {
      setEmail(p.email);
      setTicket({ id: p.ticket_id, number: p.number });
      setStep("chat");
    } else if (p) {
      savePersisted(null);
    }
  }, [authenticatedSession, step, ticket]);

  const fetchMessages = useCallback(async () => {
    if (!ticket) return;
    try {
      const res = await portalFetch("/api/public/portal/ticket-detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticket.id }),
      });
      if (res.status === 401) {
        setPortalToken(null);
        savePersisted(null);
        setTicket(null);
        setMessages([]);
        setSession(null);
        setStep("email");
        return;
      }
      if (!res.ok) return;
      const json = (await res.json()) as { messages?: ChatMsg[] };
      setMessages(json.messages ?? []);
    } catch {
      // Polling retries transient failures on the next interval.
    }
  }, [ticket]);

  useEffect(() => {
    if (step !== "chat" || !ticket || !email) return;
    void fetchMessages();
    const id = setInterval(() => void fetchMessages(), 4000);
    return () => clearInterval(id);
  }, [step, ticket, email, fetchMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await requestPortalOtp(email.trim());
      setStep("otp");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o código. Tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const result = await verifyPortalOtp(email.trim(), code);
      if (!result.ok) {
        setError("Código inválido ou expirado.");
        return;
      }
      const res = await portalFetch("/api/public/portal/session", { method: "POST" });
      const json: SessionResp = await res.json();
      if (!json.found) {
        setError("E-mail verificado, mas nenhum cadastro de cliente foi encontrado.");
        setPortalToken(null);
        return;
      }
      if (!json.contact.can_open_tickets) {
        setError("Seu contato não tem permissão para abrir chamados.");
        return;
      }
      if (!json.has_active_contract || json.contracts.length === 0) {
        setError("Nenhum contrato ativo com suporte técnico foi encontrado.");
        return;
      }
      setSession(json);
      setContractId(json.contracts[0].id);
      setStep("start");
    } catch {
      setError("Não foi possível validar o código. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const startChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstMessage.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await portalFetch("/api/public/portal/chat-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(contractId ? { contract_id: contractId } : {}),
          message: firstMessage.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError("Não foi possível iniciar o chat. Tente novamente.");
        return;
      }
      const t = { id: json.ticket_id as string, number: json.number as number };
      setTicket(t);
      savePersisted({ email: email.trim(), ticket_id: t.id, number: t.number });
      setFirstMessage("");
      setStep("chat");
      await onTicketCreated?.();
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const endChat = () => {
    savePersisted(null);
    setTicket(null);
    setMessages([]);
    // Starting a new chat doesn't require re-verifying: the OTP token is still
    // valid, so jump straight back to "describe your request" instead of
    // asking for the email/code again.
    if (session && getPortalToken()) {
      setStep("start");
    } else {
      setSession(null);
      setStep("email");
    }
  };

  if (step === "closed") {
    return (
      <button
        type="button"
        onClick={() => setStep(ticket ? "chat" : authenticatedSession ? "start" : "email")}
        aria-label="Abrir chat de suporte"
        className={
          authenticatedSession
            ? "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/15"
            : "fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full gradient-primary text-white shadow-premium transition-transform hover:scale-105"
        }
      >
        <MessageCircle className={authenticatedSession ? "size-4" : "size-6"} />
        {authenticatedSession && <span>Atendimento via chat</span>}
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[60] flex h-[70vh] max-h-[620px] w-[92vw] max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
      {/* Header */}
      <div className="gradient-primary text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {step === "chat" && (
            <button
              onClick={endChat}
              className="p-1 hover:bg-white/10 rounded"
              aria-label="Novo chat"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">Suporte APTicket</div>
            <div className="text-[11px] text-white/80 truncate">
              {ticket ? `Chamado #${ticket.number}` : "Fale com nosso time"}
            </div>
          </div>
        </div>
        <button
          onClick={() => setStep("closed")}
          className="p-1 hover:bg-white/10 rounded"
          aria-label="Fechar chat"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {step === "email" && (
          <form onSubmit={requestCode} className="p-4 flex flex-col gap-3 h-full">
            <p className="text-sm text-muted-foreground">
              Informe o e-mail cadastrado no seu contrato. Enviaremos um código de verificação.
            </p>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com.br"
              className="w-full rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <div className="text-xs text-destructive">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="gradient-primary text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              Enviar código
            </button>
            <div className="text-[11px] text-muted-foreground text-center mt-auto">
              Não tem cadastro?{" "}
              <Link
                to="/portal"
                className="underline text-primary"
                onClick={() => setStep("closed")}
              >
                Acesse o Portal
              </Link>
            </div>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={verifyCode} className="p-4 flex flex-col gap-3 h-full">
            <p className="text-sm text-muted-foreground">
              Enviamos um código de 6 dígitos para <strong>{email}</strong>. Ele expira em 10
              minutos.
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-full rounded-md border border-input px-3 py-2 text-sm text-center text-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <div className="text-xs text-destructive">{error}</div>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="gradient-primary text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              Entrar
            </button>
            <div className="flex justify-between text-[11px] mt-auto">
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              >
                Trocar e-mail
              </button>
              <button
                type="button"
                className="text-primary underline"
                onClick={() => {
                  setError(null);
                  requestPortalOtp(email.trim()).catch((error: unknown) =>
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Não foi possível reenviar o código.",
                    ),
                  );
                }}
              >
                Reenviar código
              </button>
            </div>
          </form>
        )}

        {step === "start" && session && (
          <form onSubmit={startChat} className="p-4 flex flex-col gap-3 h-full">
            <div className="text-xs text-muted-foreground">
              Olá <span className="font-medium text-foreground">{session.contact.name}</span> -
              pronto pra abrir um novo chat.
            </div>
            {session.contracts.length > 1 && (
              <div>
                <label className="text-xs font-medium block mb-1">Contrato</label>
                <select
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                  className="w-full rounded-md border border-input px-2 py-2 text-sm"
                >
                  {session.contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {session.contracts.find((c) => c.id === contractId)?.description && (
              <div className="text-[11px] rounded-md bg-muted p-2 leading-snug">
                {session.contracts.find((c) => c.id === contractId)?.description}
              </div>
            )}
            {session.contracts.length === 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-900 dark:text-amber-100">
                O atendimento será aberto como avulso, pois não há contrato ativo disponível.
              </div>
            )}
            <label className="text-xs font-medium">Descreva sua solicitação</label>
            <textarea
              required
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              rows={5}
              placeholder="Conte o que está acontecendo…"
              className="flex-1 min-h-24 resize-none rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <div className="text-xs text-destructive">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="gradient-primary text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              Iniciar chat
            </button>
          </form>
        )}

        {step === "chat" && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/30">
              {messages.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">
                  Aguardando mensagens…
                </div>
              )}
              {messages.map((m) => {
                const mine = m.author_type === "contact";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        mine
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-card border rounded-bl-sm"
                      }`}
                    >
                      {!mine && (
                        <div className="text-[10px] font-semibold opacity-70 mb-0.5">
                          {m.author_name}
                        </div>
                      )}
                      {m.content && (
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>
                      )}
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1.5">
                          {m.attachments.map((attachment, index) => (
                            <AttachmentPreview key={`${attachment.path}-${index}`} a={attachment} />
                          ))}
                        </div>
                      )}
                      <div
                        className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                      >
                        {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {ticket && <CustomerChatComposer ticketId={ticket.id} onSent={fetchMessages} />}
          </>
        )}
      </div>
    </div>
  );
}
