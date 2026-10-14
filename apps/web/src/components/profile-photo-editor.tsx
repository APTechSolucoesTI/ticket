import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { avatarFileError, avatarImageExtension } from "@/lib/profile-avatar";
import { removeMyAvatar, uploadMyAvatar } from "@/lib/profile.functions";
import { getUserFacingError } from "@/lib/user-facing-error";

export function ProfilePhotoEditor({
  avatarUrl,
  name,
  initials,
  onSaved,
}: {
  avatarUrl: string | null;
  name: string;
  initials: string;
  onSaved(avatarUrl: string | null): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const uploadAvatar = useServerFn(uploadMyAvatar);
  const removeAvatar = useServerFn(removeMyAvatar);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const save = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Escolha uma foto para salvar.");
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(new Error("Não foi possível ler a foto. Escolha o arquivo novamente."));
        reader.readAsDataURL(file);
      });
      return uploadAvatar({
        data: { imageBase64, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp" },
      });
    },
    onSuccess: (result) => {
      onSaved(result.avatarUrl);
      setFile(null);
      setError("");
      toast.success("Foto de perfil atualizada.");
    },
    onError: (cause) => setError(getUserFacingError(cause, "Não foi possível salvar sua foto.")),
  });
  const remove = useMutation({
    mutationFn: () => removeAvatar(),
    onSuccess: () => {
      onSaved(null);
      setError("");
      toast.success("Foto de perfil removida.");
    },
    onError: (cause) => setError(getUserFacingError(cause, "Não foi possível remover sua foto.")),
  });
  const busy = reading || save.isPending || remove.isPending;

  async function chooseFile(candidate: File | undefined) {
    if (!candidate) return;
    const current = ++selection.current;
    setError("");
    const invalid = avatarFileError(candidate.size, candidate.type);
    if (invalid) {
      setError(invalid);
      return;
    }
    setReading(true);
    const url = URL.createObjectURL(candidate);
    try {
      avatarImageExtension(new Uint8Array(await candidate.arrayBuffer()), candidate.type);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (current === selection.current) setFile(candidate);
    } catch {
      if (current === selection.current)
        setError("Não foi possível abrir essa imagem. Escolha uma foto JPG, PNG ou WebP válida.");
    } finally {
      URL.revokeObjectURL(url);
      if (current === selection.current) setReading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Avatar className="size-20 border-4 border-card shadow-sm">
        {preview || avatarUrl ? (
          <AvatarImage
            src={preview || avatarUrl || undefined}
            alt={`Foto de perfil de ${name}`}
            className="object-cover"
          />
        ) : null}
        <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Escolher foto de perfil"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          void chooseFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
          {reading ? "Preparando foto…" : avatarUrl || file ? "Alterar foto" : "Adicionar foto"}
        </Button>
        {file ? (
          <>
            <p className="text-xs text-muted-foreground">
              Prévia da nova foto. Salve para aplicar ao perfil.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="flex-1"
                disabled={busy}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Salvando…" : "Salvar foto"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  ++selection.current;
                  setFile(null);
                  setError("");
                }}
              >
                Cancelar
              </Button>
            </div>
          </>
        ) : avatarUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            disabled={busy}
            onClick={() => remove.mutate()}
          >
            <Trash2 className="size-3.5" />
            {remove.isPending ? "Removendo…" : "Remover foto"}
          </Button>
        ) : null}
        <p className="text-[11px] text-muted-foreground">JPG, PNG ou WebP · até 2 MB.</p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
