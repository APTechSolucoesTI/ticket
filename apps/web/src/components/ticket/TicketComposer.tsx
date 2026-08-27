import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Paperclip,
  Send,
  Smile,
  Mic,
  Square,
  MapPin,
  UserSquare2,
  Sticker,
  Phone,
  X,
  Image as ImageIcon,
  FileText,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/session";
import { getMyTenantId } from "@/lib/tenant";
import { maskPhone, normalizePhone } from "@/lib/masks";
import { escapePostgrestValue } from "@/lib/postgrest-escape";
import { backendClient } from "@/lib/backend-client";
import { cn } from "@/lib/utils";

// Lazy emoji picker to avoid inflating initial bundle
import { lazy, Suspense } from "react";
const EmojiPicker = lazy(() => import("emoji-picker-react"));

type CannedResponse = { id: string; title: string; body: string };

type Props = {
  ticketId: string;
  tenantId: string;
  channel: string | null;
  agentName: string;
  cannedList: CannedResponse[];
  applyTemplate: (body: string) => string;
  publicReplyEnabled: boolean;
  onSent?: () => void;
  /** Canal "chat" (WebSocket, ChatGateway) — texto puro só, sem anexo. */
  onSendChat?: (content: string) => void;
  onTyping?: (isTyping: boolean) => void;
};

export function TicketComposer({
  ticketId,
  tenantId,
  channel,
  agentName,
  cannedList,
  applyTemplate,
  publicReplyEnabled,
  onSent,
  onSendChat,
  onTyping,
}: Props) {
  const isWa = channel === "whatsapp";
  // Strictly the email channel — "manual" tickets keep their pre-existing
  // behavior of just logging a message tagged channel="email" for display,
  // with no real dispatch (no guarantee they even have a contact email).
  const isEmail = channel === "email";
  const isChat = channel === "chat";
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(() => !publicReplyEnabled);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Audio recording
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Dialogs
  const [contactOpen, setContactOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);

  const signaturize = useCallback(
    (text: string) => {
      if (internal || !text.trim() || !agentName) return text;
      const sig = `*${agentName}*:`;
      if (text.startsWith(sig)) return text;
      return `${sig}\n${text.trimStart()}`;
    },
    [internal, agentName],
  );

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    const oversized = arr.find((file) => file.size > 10 * 1024 * 1024);
    if (oversized) {
      toast.error(`${oversized.name} excede o limite de 10 MB`);
      return;
    }
    setFiles((prev) => [...prev, ...arr].slice(0, 10));
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const uploadFile = async (file: File): Promise<{ path: string; url: string }> => {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const path = `${tenantId}/${ticketId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
    const { error } = await supabase.storage
      .from("ticket-attachments")
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw error;
    const { data: signed } = await supabase.storage
      .from("ticket-attachments")
      .createSignedUrl(path, 60 * 60 * 24);
    return { path, url: signed?.signedUrl ?? "" };
  };

  const sendAll = async () => {
    if (sending) return;
    if (!internal && !publicReplyEnabled) {
      toast.error("Inicie o Time Tracking antes de enviar uma resposta pública");
      return;
    }
    const text = signaturize(reply);
    if (!text.trim() && files.length === 0) return;
    setSending(true);
    try {
      // E-mail is one SMTP message containing all attachments. Other channels
      // keep one timeline message per file so delivery status stays granular.
      if (isEmail && !internal && files.length > 0) {
        const attachments: Array<{ path: string; name: string; size: number; type: string }> = [];
        for (const file of files) {
          const uploaded = await uploadFile(file);
          attachments.push({
            path: uploaded.path,
            name: file.name,
            size: file.size,
            type: file.type || "application/octet-stream",
          });
        }
        await backendClient.post("/channels/email/accounts/me/send", {
          ticketId,
          content:
            text.trim() ||
            `Anexo${files.length > 1 ? "s" : ""} enviado${files.length > 1 ? "s" : ""}.`,
          attachments,
        });
      } else {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const isLast = i === files.length - 1;
          const caption = isLast ? text : undefined;
          const uploaded = await uploadFile(f);
          if (isWa && !internal) {
            if (!uploaded.url) throw new Error("URL de mídia indisponível");
            await backendClient.post("/channels/whatsapp/instances/me/send-media", {
              ticketId,
              url: uploaded.url,
              path: uploaded.path,
              filename: f.name,
              mimetype: f.type || "application/octet-stream",
              size: f.size,
              caption: caption || undefined,
            });
          } else {
            const authorId = getCurrentUserId();
            const { error } = await supabase.from("messages").insert({
              tenant_id: tenantId,
              ticket_id: ticketId,
              content: caption ?? `[anexo] ${f.name}`,
              author_id: authorId,
              author_type: "agent",
              is_internal: internal,
              channel: (channel === "manual" ? "email" : channel) as
                "chat" | "email" | "portal" | "whatsapp" | null,
              attachments: [{ path: uploaded.path, name: f.name, size: f.size, type: f.type }],
            });
            if (error) throw error;
          }
        }
      }

      // 2) Text-only if no files (files carry caption already)
      if (files.length === 0 && text.trim()) {
        if (isWa && !internal) {
          await backendClient.post("/channels/whatsapp/instances/me/send", {
            ticketId,
            content: text,
          });
        } else if (isEmail && !internal) {
          await backendClient.post("/channels/email/accounts/me/send", { ticketId, content: text });
        } else if (isChat && !internal && onSendChat) {
          // ChatGateway já persiste a mensagem (messages, channel='chat') e
          // distribui via WebSocket — não insere aqui de novo.
          onSendChat(text);
          onTyping?.(false);
        } else {
          const authorId = getCurrentUserId();
          const { error } = await supabase.from("messages").insert({
            tenant_id: tenantId,
            ticket_id: ticketId,
            content: text,
            author_id: authorId,
            author_type: "agent",
            is_internal: internal,
            channel: (channel === "manual" ? "email" : channel) as
              "chat" | "email" | "portal" | "whatsapp" | null,
          });
          if (error) throw error;
        }
      }

      setReply("");
      setFiles([]);
      onSent?.();
      toast.success(
        files.length > 0
          ? `Enviado (${files.length} anexo${files.length > 1 ? "s" : ""})`
          : "Mensagem enviada",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const file = new File([blob], `audio-${Date.now()}.webm`, { type: mime });
        try {
          const up = await uploadFile(file);
          if (isWa && !internal) {
            await backendClient.post("/channels/whatsapp/instances/me/send-media", {
              ticketId,
              url: up.url,
              path: up.path,
              filename: file.name,
              mimetype: mime,
              size: file.size,
            });
          } else if (isEmail && !internal) {
            await backendClient.post("/channels/email/accounts/me/send", {
              ticketId,
              content: "Mensagem de voz",
              attachments: [{ path: up.path, name: file.name, size: file.size, type: mime }],
            });
          } else {
            const authorId = getCurrentUserId();
            await supabase.from("messages").insert({
              tenant_id: tenantId,
              ticket_id: ticketId,
              content: "🎤 Mensagem de voz",
              author_id: authorId,
              author_type: "agent",
              is_internal: internal,
              channel: (channel === "manual" ? "email" : channel) as
                "chat" | "email" | "portal" | "whatsapp" | null,
              attachments: [{ path: up.path, name: file.name, size: file.size, type: mime }],
            });
          }
          onSent?.();
          toast.success("Áudio enviado");
        } catch (e) {
          toast.error((e as Error).message);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const stopRecording = (cancel = false) => {
    const rec = recorderRef.current;
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    recTimerRef.current = null;
    if (!rec) return;
    if (cancel) {
      rec.onstop = () => rec.stream.getTracks().forEach((t) => t.stop());
    }
    rec.stop();
    recorderRef.current = null;
    setRecording(false);
    setRecSeconds(0);
  };

  useEffect(
    () => () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (recorderRef.current) recorderRef.current.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  useEffect(() => {
    if (!publicReplyEnabled) setInternal(true);
  }, [publicReplyEnabled]);

  // Drag & drop
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={cn("border-t p-3 relative", dragOver && "bg-primary/5")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 rounded-md border-2 border-dashed border-primary/60 bg-primary/5 flex items-center justify-center text-xs text-primary">
          Solte os arquivos aqui para anexar
        </div>
      )}

      {/* Toolbar top */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <div className="flex rounded-md border p-0.5">
          <button
            type="button"
            disabled={!publicReplyEnabled}
            onClick={() => setInternal(false)}
            title={
              publicReplyEnabled
                ? undefined
                : "Inicie o Time Tracking para enviar uma resposta pública"
            }
            className={cn(
              "h-6 rounded-sm px-2 disabled:cursor-not-allowed disabled:opacity-45",
              !internal && "bg-blue-500/15 text-blue-600 dark:text-blue-400",
            )}
          >
            Resposta pública
          </button>
          <button
            type="button"
            onClick={() => setInternal(true)}
            className={cn(
              "h-6 rounded-sm px-2",
              internal && "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
            )}
          >
            Nota interna
          </button>
        </div>

        <select
          className="h-6 rounded-md border bg-background px-1 text-[11px]"
          onChange={(e) => {
            const c = cannedList.find((x) => x.id === e.target.value);
            if (c) setReply((r) => (r ? r + "\n\n" : "") + applyTemplate(c.body));
            e.target.value = "";
          }}
        >
          <option value="">Respostas padrão…</option>
          {cannedList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>

        {!internal && agentName && (
          <span className="text-[10px] text-muted-foreground">
            Assinando como <strong className="text-foreground">{agentName}</strong>
          </span>
        )}
        {!publicReplyEnabled && (
          <span className="text-[10px] text-muted-foreground">
            Inicie o Time Tracking para responder ao cliente.
          </span>
        )}
      </div>

      {/* File chips */}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => {
            const isImg = f.type.startsWith("image/");
            return (
              <div
                key={i}
                className="group relative flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-[11px]"
              >
                {isImg ? (
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                <span className="max-w-[160px] truncate">{f.name}</span>
                <span className="text-muted-foreground">{Math.round(f.size / 1024)} KB</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remover anexo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Recording banner */}
      {recording && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Gravando… {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:
            {String(recSeconds % 60).padStart(2, "0")}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={() => stopRecording(true)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => stopRecording(false)}
            >
              <Send className="h-3 w-3" /> Enviar áudio
            </Button>
          </div>
        </div>
      )}

      <textarea
        value={reply}
        disabled={!internal && !publicReplyEnabled}
        onChange={(e) => {
          setReply(e.target.value);
          if (isChat && onTyping) {
            onTyping(true);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => onTyping(false), 2000);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            sendAll();
          }
        }}
        placeholder={
          internal
            ? "Escreva uma nota interna…"
            : "Responda ao cliente…  (Ctrl/⌘+Enter para enviar)"
        }
        className={cn(
          "w-full resize-none rounded-md border bg-background p-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
          internal && "bg-yellow-500/5",
        )}
        rows={3}
      />

      {/* Bottom toolbar */}
      <div className="mt-2 flex items-center gap-1">
        {/* Attach multi */}
        <label className="flex h-8 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] hover:bg-muted">
          <Paperclip className="h-3.5 w-3.5" />
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>

        {/* Image quick */}
        <label className="flex h-8 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] hover:bg-muted">
          <ImageIcon className="h-3.5 w-3.5" />
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>

        {/* Emoji */}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 px-2">
              <Smile className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" side="top" align="start">
            <Suspense fallback={<div className="p-4 text-xs">Carregando…</div>}>
              <EmojiPicker
                onEmojiClick={(e) => setReply((r) => r + e.emoji)}
                width={320}
                height={360}
              />
            </Suspense>
          </PopoverContent>
        </Popover>

        {/* Audio */}
        {!recording && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2"
            onClick={startRecording}
            title="Gravar áudio"
          >
            <Mic className="h-3.5 w-3.5" />
          </Button>
        )}
        {recording && (
          <Button
            size="sm"
            variant="destructive"
            className="h-8 px-2"
            onClick={() => stopRecording(true)}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* WhatsApp-only extras */}
        {isWa && !internal && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-[11px]"
                disabled={!publicReplyEnabled}
              >
                Mais…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setContactOpen(true)}>
                <UserSquare2 className="mr-2 h-3.5 w-3.5" /> Enviar contato
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocationOpen(true)}>
                <MapPin className="mr-2 h-3.5 w-3.5" /> Enviar localização
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStickerOpen(true)}>
                <Sticker className="mr-2 h-3.5 w-3.5" /> Enviar figurinha
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCallOpen(true)}>
                <Phone className="mr-2 h-3.5 w-3.5" /> Ligar (chamada WhatsApp)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="ml-auto">
          <Button
            size="sm"
            onClick={sendAll}
            disabled={
              sending || (!internal && !publicReplyEnabled) || (!reply.trim() && files.length === 0)
            }
            aria-busy={sending}
            className="gap-1 text-xs"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {sending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      </div>

      {/* Contact dialog */}
      <ContactDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        onSubmit={async (name, phone) => {
          try {
            await backendClient.post("/channels/whatsapp/instances/me/send-contact", {
              ticketId,
              name,
              phone,
            });
            toast.success("Contato enviado");
            onSent?.();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />

      {/* Location dialog */}
      <LocationDialog
        open={locationOpen}
        onOpenChange={setLocationOpen}
        onSubmit={async (lat, lng, name, address) => {
          try {
            await backendClient.post("/channels/whatsapp/instances/me/send-location", {
              ticketId,
              latitude: lat,
              longitude: lng,
              name,
              address,
            });
            toast.success("Localização enviada");
            onSent?.();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />

      {/* Sticker dialog */}
      <StickerDialog
        open={stickerOpen}
        onOpenChange={setStickerOpen}
        uploadFile={uploadFile}
        onSend={async ({ url, path, filename }) => {
          try {
            await backendClient.post("/channels/whatsapp/instances/me/send-sticker", {
              ticketId,
              url,
              path,
              filename,
            });
            toast.success("Figurinha enviada");
            onSent?.();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />

      {/* Call dialog */}
      <CallDialog
        open={callOpen}
        onOpenChange={setCallOpen}
        onSubmit={async (duration) => {
          try {
            await backendClient.post("/channels/whatsapp/instances/me/call", {
              ticketId,
              duration,
            });
            toast.success("Ligação disparada");
            onSent?.();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

function ContactDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (name: string, phone: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"search" | "manual">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ id: string; name: string; phone: string | null; email: string | null }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!open || mode !== "search") return;
    const q = query.trim();
    const h = setTimeout(async () => {
      setLoading(true);
      let req = supabase
        .from("contacts")
        .select("id, name, phone, email")
        .not("phone", "is", null)
        .limit(20);
      if (q) {
        const term = escapePostgrestValue(`%${q}%`);
        req = req.or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
      }
      const { data } = await req;
      setResults(data ?? []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(h);
  }, [query, open, mode]);

  const reset = () => {
    setQuery("");
    setResults([]);
    setName("");
    setPhone("");
    setMode("search");
  };
  const submit = async (n: string, p: string) => {
    const digits = normalizePhone(p);
    if (!n || !digits) return toast.error("Informe nome e telefone");
    await onSubmit(n, digits);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar contato</DialogTitle>
        </DialogHeader>
        <div className="mb-2 flex gap-1 rounded-md border p-0.5 text-xs">
          <button
            className={cn(
              "flex-1 rounded px-2 py-1",
              mode === "search" && "bg-accent text-accent-foreground",
            )}
            onClick={() => setMode("search")}
          >
            Buscar cadastrado
          </button>
          <button
            className={cn(
              "flex-1 rounded px-2 py-1",
              mode === "manual" && "bg-accent text-accent-foreground",
            )}
            onClick={() => setMode("manual")}
          >
            Digitar manual
          </button>
        </div>

        {mode === "search" ? (
          <div className="space-y-2">
            <input
              autoFocus
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="Buscar por nome, e-mail ou telefone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-64 overflow-auto rounded-md border">
              {loading ? (
                <div className="p-3 text-xs text-muted-foreground">Buscando…</div>
              ) : results.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  Nenhum contato com telefone encontrado.
                </div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.id}
                    className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
                    onClick={() => submit(c.name, c.phone ?? "")}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.phone ? maskPhone(c.phone) : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="55 11 99999-9999"
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={() => submit(name, phone)}>Enviar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LocationDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (lat: number, lng: number, name?: string, address?: string) => Promise<void>;
}) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const useCurrent = () => {
    if (!navigator.geolocation) return toast.error("Geolocalização indisponível");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
      },
      (err) => toast.error(err.message),
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar localização</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="Latitude"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
            <input
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="Longitude"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
          </div>
          <input
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            placeholder="Nome do local (opcional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            placeholder="Endereço (opcional)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Button size="sm" variant="outline" className="w-full" onClick={useCurrent}>
            <MapPin className="mr-2 h-3.5 w-3.5" /> Usar minha localização atual
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={async () => {
              const la = parseFloat(lat);
              const ln = parseFloat(lng);
              if (isNaN(la) || isNaN(ln)) return toast.error("Coordenadas inválidas");
              await onSubmit(la, ln, name || undefined, address || undefined);
              setLat("");
              setLng("");
              setName("");
              setAddress("");
              onOpenChange(false);
            }}
          >
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StickerDialog({
  open,
  onOpenChange,
  uploadFile,
  onSend,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  uploadFile: (file: File) => Promise<{ path: string; url: string }>;
  onSend: (sticker: { url: string; path: string; filename: string }) => Promise<void>;
}) {
  const [items, setItems] = useState<
    Array<{ id: string; name: string; storage_path: string; url: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("stickers")
        .select("id,name,storage_path")
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as Array<{ id: string; name: string; storage_path: string }>;
      const withUrls = await Promise.all(
        rows.map(async (r) => {
          const { data: s } = await supabase.storage
            .from("ticket-attachments")
            .createSignedUrl(r.storage_path, 60 * 60);
          return { ...r, url: s?.signedUrl ?? "" };
        }),
      );
      setItems(withUrls);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name}: apenas imagens`);
          continue;
        }
        // Upload into ticket-attachments (reused by composer's uploadFile helper is per-ticket; here we mirror the stickers folder for reuse)
        const _tid = await getMyTenantId();
        if (!_tid) throw new Error("Tenant não encontrado");
        const prof = { tenant_id: _tid };
        const tenant_id = prof?.tenant_id;
        if (!tenant_id) throw new Error("Tenant não encontrado");
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
        const path = `${tenant_id}/_stickers/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from("ticket-attachments")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from("stickers").insert({
          tenant_id,
          name: file.name.replace(/\.[^.]+$/, ""),
          storage_path: path,
          created_by: getCurrentUserId(),
        });
        if (insErr) throw insErr;
      }
      toast.success("Adicionado à galeria");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const pick = async (item: { url: string; storage_path: string; name: string }) => {
    if (!item.url) return toast.error("URL indisponível");
    await onSend({ url: item.url, path: item.storage_path, filename: item.name });
    onOpenChange(false);
  };

  const sendOneOff = async (file: File) => {
    try {
      const up = await uploadFile(file);
      await onSend({ url: up.url, path: up.path, filename: file.name });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw]">
        <DialogHeader>
          <DialogTitle>Figurinhas</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            Clique em uma figurinha para enviar. Recomendado .webp 512×512.
          </span>
          <div className="flex gap-2">
            <label className="inline-flex">
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (f) sendOneOff(f);
                }}
              />
              <Button asChild size="sm" variant="outline">
                <span>Enviar arquivo</span>
              </Button>
            </label>
            <label className="inline-flex">
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(e) => {
                  handleUpload(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
              <Button asChild size="sm" disabled={uploading}>
                <span>{uploading ? "Salvando…" : "Adicionar à galeria"}</span>
              </Button>
            </label>
          </div>
        </div>
        <div className="mt-2 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma figurinha cadastrada ainda.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {items.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pick(s)}
                  className="group relative aspect-square overflow-hidden rounded-md border bg-background p-1 hover:border-primary"
                  title={s.name}
                >
                  <img
                    src={s.url}
                    alt={s.name}
                    className="h-full w-full object-contain transition-transform group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CallDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (duration: number) => Promise<void> | void;
}) {
  const [duration, setDuration] = useState(15);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4" /> Ligar via WhatsApp
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            Dispara uma chamada de voz para o contato do ticket. A ligação toca no aparelho por
            alguns segundos — útil para chamar a atenção do cliente antes de enviar a próxima
            mensagem.
          </p>
          <label className="flex items-center gap-2">
            <span className="w-28 text-muted-foreground">Duração (s)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Math.min(60, Number(e.target.value) || 15)))}
              className="h-8 w-24 rounded-md border bg-background px-2 text-xs"
            />
          </label>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            size="sm"
            className="gap-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(duration);
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Phone className="h-3.5 w-3.5" />
            )}
            Ligar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
