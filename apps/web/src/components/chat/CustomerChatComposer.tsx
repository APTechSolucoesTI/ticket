import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  X,
} from "lucide-react";
import { portalFetch } from "@/lib/portal-client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const EmojiPicker = lazy(() => import("emoji-picker-react"));
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Props = {
  ticketId: string;
  onSent: () => Promise<void> | void;
};

export function CustomerChatComposer({ ticketId, onSent }: Props) {
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRecordingRef = useRef(false);

  const addFiles = (incoming: FileList | File[]) => {
    setError(null);
    const next = Array.from(incoming);
    const oversized = next.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setError(`${oversized.name} excede o limite de 10 MB.`);
      return;
    }
    setFiles((current) => {
      const combined = [...current, ...next];
      if (combined.length > MAX_FILES) {
        setError("Envie no máximo 5 arquivos por mensagem.");
      }
      return combined.slice(0, MAX_FILES);
    });
  };

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (sending || (!reply.trim() && files.length === 0)) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("ticket_id", ticketId);
      form.append("content", reply.trim());
      files.forEach((file) => form.append("files", file));
      const response = await portalFetch("/api/public/portal/ticket-reply", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          detail?: string;
          name?: string;
        } | null;
        if (body?.error === "file_too_large") {
          throw new Error(`${body.name ?? "Arquivo"} excede o limite de 10 MB.`);
        }
        if (body?.error === "too_many_files") {
          throw new Error("Envie no máximo 5 arquivos por mensagem.");
        }
        throw new Error(body?.detail || "Não foi possível enviar a mensagem.");
      }
      setReply("");
      setFiles([]);
      await onSent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Gravação de áudio não é suportada neste navegador.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      cancelRecordingRef.current = false;
      recorder.ondataavailable = (chunk) => {
        if (chunk.data.size > 0) chunksRef.current.push(chunk.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!cancelRecordingRef.current && chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          addFiles([new File([blob], `audio-${Date.now()}.webm`, { type: mimeType })]);
        }
        chunksRef.current = [];
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(
        () => setRecordingSeconds((seconds) => seconds + 1),
        1000,
      );
    } catch {
      setError("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  };

  const stopRecording = (cancel: boolean) => {
    cancelRecordingRef.current = cancel;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    setRecordingSeconds(0);
  };

  useEffect(
    () => () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recorderRef.current?.state !== "inactive") {
        cancelRecordingRef.current = true;
        recorderRef.current?.stop();
      }
    },
    [],
  );

  return (
    <form onSubmit={send} className="border-t bg-card p-2">
      {files.length > 0 && (
        <div
          className="mb-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto"
          aria-label="Anexos selecionados"
        >
          {files.map((file, index) => (
            <span
              key={`${file.name}-${file.lastModified}-${index}`}
              className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-[10px]"
            >
              {file.type.startsWith("image/") ? (
                <ImageIcon className="size-3 shrink-0" aria-hidden="true" />
              ) : (
                <FileText className="size-3 shrink-0" aria-hidden="true" />
              )}
              <span className="max-w-40 truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}
                className="rounded p-0.5 hover:bg-muted"
                aria-label={`Remover ${file.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <p
          className="mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <textarea
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        rows={1}
        placeholder="Escreva uma mensagem…"
        aria-label="Mensagem"
        disabled={sending}
        className="max-h-28 min-h-10 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />

      <div className="mt-1.5 flex items-center gap-1">
        <label
          className="flex size-8 cursor-pointer items-center justify-center rounded-md border hover:bg-muted"
          title="Anexar arquivo"
        >
          <Paperclip className="size-4" aria-hidden="true" />
          <span className="sr-only">Anexar arquivo</span>
          <input
            type="file"
            multiple
            className="hidden"
            disabled={sending}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label
          className="flex size-8 cursor-pointer items-center justify-center rounded-md border hover:bg-muted"
          title="Anexar imagem ou vídeo"
        >
          <ImageIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">Anexar imagem ou vídeo</span>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            disabled={sending}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={sending}
              className="flex size-8 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-60"
              aria-label="Inserir emoji"
            >
              <Smile className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" side="top" align="start">
            <Suspense fallback={<div className="p-4 text-xs">Carregando…</div>}>
              <EmojiPicker
                onEmojiClick={(emoji) => setReply((current) => current + emoji.emoji)}
                width={300}
                height={340}
              />
            </Suspense>
          </PopoverContent>
        </Popover>
        {recording ? (
          <div className="flex h-8 items-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-1.5 text-[10px] text-destructive">
            <span className="min-w-8 font-mono tabular-nums">
              {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={() => stopRecording(false)}
              className="rounded p-1 hover:bg-destructive/10"
              aria-label="Concluir gravação"
            >
              <Square className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="rounded p-1 hover:bg-destructive/10"
              aria-label="Cancelar gravação"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            disabled={sending || files.length >= MAX_FILES}
            className="flex size-8 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-60"
            aria-label="Gravar áudio"
          >
            <Mic className="size-4" />
          </button>
        )}
        <button
          type="submit"
          disabled={sending || (!reply.trim() && files.length === 0)}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          aria-label="Enviar mensagem"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Enviar
        </button>
      </div>
    </form>
  );
}
