import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ExternalLink, FileText, MapPin, UserRound } from "lucide-react";
import { maskPhone } from "@/lib/masks";

export type Attachment = {
  path: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  kind?: "contact" | "location" | "sticker";
  contact?: { name: string; phone: string | null };
  location?: {
    latitude: number;
    longitude: number;
    name: string | null;
    address: string | null;
  };
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
  const [url, setUrl] = useState<string | null>(
    isHttpUrl(a.url) ? a.url! : isHttpUrl(a.path) ? a.path : null,
  );
  const [loading, setLoading] = useState(!url);

  useEffect(() => {
    let cancelled = false;
    if (url) {
      setLoading(false);
      return;
    }
    if (!a.path || isHttpUrl(a.path)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.storage
      .from("ticket-attachments")
      .createSignedUrl(a.path, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) {
          setUrl(data?.signedUrl ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.path, a.url]);

  return { url, loading };
}

export function AttachmentPreview({ a }: { a: Attachment }) {
  const { url, loading } = useResolvedUrl(a);

  const openInNewTab = () => {
    if (!url) {
      toast.error("Não foi possível abrir o anexo.");
      return;
    }
    window.open(url, "_blank", "noopener");
  };

  if (a.kind === "contact" && a.contact) {
    return (
      <article className="flex w-full min-w-0 max-w-sm items-center gap-3 rounded-lg border border-emerald-500/25 bg-background px-3 py-2.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <UserRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{a.contact.name}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {a.contact.phone ? maskPhone(a.contact.phone) : "Telefone não informado"}
          </p>
        </div>
        {a.contact.phone && (
          <a
            href={`tel:+${a.contact.phone.replace(/\D/g, "")}`}
            className="rounded-md p-1.5 text-emerald-700 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300"
            aria-label={`Ligar para ${a.contact.name}`}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
      </article>
    );
  }

  if (a.kind === "location" && a.location) {
    const { latitude, longitude, name, address } = a.location;
    const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
    return (
      <a
        href={mapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex w-full min-w-0 max-w-sm items-center gap-3 rounded-lg border border-sky-500/25 bg-background px-3 py-2.5 shadow-sm transition-colors hover:bg-sky-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <MapPin className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{name || "Localização compartilhada"}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`}
          </p>
        </div>
        <ExternalLink
          className="h-4 w-4 text-muted-foreground group-hover:text-sky-700"
          aria-hidden="true"
        />
      </a>
    );
  }

  if (loading) {
    return (
      <div className="rounded border px-2 py-1 text-[10px] text-muted-foreground">Carregando…</div>
    );
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
      <span className="inline-flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        {a.name}
      </span>
    </button>
  );
}
