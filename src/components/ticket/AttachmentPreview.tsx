import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Attachment = {
  path: string;
  name: string;
  size: number;
  type: string;
  url?: string;
};

function isHttpUrl(v: string | undefined | null): v is string {
  return !!v && /^(https?:|data:|blob:)/i.test(v);
}

function isImageMime(a: Attachment): boolean {
  if (a.type?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.name || "");
}

function isAudioMime(a: Attachment): boolean {
  if (a.type?.startsWith("audio/")) return true;
  return /\.(mp3|ogg|wav|m4a|opus|aac)$/i.test(a.name || "");
}

function isVideoMime(a: Attachment): boolean {
  if (a.type?.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|mkv)$/i.test(a.name || "");
}

/** Resolve any attachment shape to a browser-usable URL. */
function useResolvedUrl(a: Attachment): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(isHttpUrl(a.url) ? a.url! : isHttpUrl(a.path) ? a.path : null);
  const [loading, setLoading] = useState(!url);

  useEffect(() => {
    let cancelled = false;
    if (url) { setLoading(false); return; }
    if (!a.path || isHttpUrl(a.path)) { setLoading(false); return; }
    setLoading(true);
    supabase.storage
      .from("ticket-attachments")
      .createSignedUrl(a.path, 60 * 60)
      .then(({ data }) => { if (!cancelled) { setUrl(data?.signedUrl ?? null); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.path, a.url]);

  return { url, loading };
}

export function AttachmentPreview({ a }: { a: Attachment }) {
  const { url, loading } = useResolvedUrl(a);

  const openInNewTab = () => {
    if (!url) { toast.error("Não foi possível abrir o anexo."); return; }
    window.open(url, "_blank", "noopener");
  };

  if (loading) {
    return <div className="rounded border px-2 py-1 text-[10px] text-muted-foreground">Carregando…</div>;
  }

  if (isImageMime(a) && url) {
    return (
      <button
        type="button"
        onClick={openInNewTab}
        className="group relative block overflow-hidden rounded-md border bg-muted/30"
        title={a.name}
      >
        <img
          src={url}
          alt={a.name}
          loading="lazy"
          className="max-h-56 max-w-[240px] object-contain"
        />
      </button>
    );
  }

  if (isAudioMime(a) && url) {
    return <audio controls src={url} className="max-w-[280px]" />;
  }

  if (isVideoMime(a) && url) {
    return <video controls src={url} className="max-h-56 max-w-[280px] rounded-md" />;
  }

  return (
    <button
      type="button"
      onClick={openInNewTab}
      className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
      title={`${a.name}${a.size ? ` (${Math.round(a.size / 1024)} KB)` : ""}`}
    >
      📎 {a.name}
    </button>
  );
}
