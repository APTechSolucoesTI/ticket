export const PROFILE_AVATAR_BUCKET = "apticket-profile-avatars";
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function avatarFileError(size: number, mimeType: string): string | null {
  if (!AVATAR_MIME_TYPES.includes(mimeType as (typeof AVATAR_MIME_TYPES)[number]))
    return "Escolha uma imagem JPG, PNG ou WebP.";
  if (size <= 0) return "A imagem está vazia. Escolha outro arquivo.";
  if (size > MAX_AVATAR_BYTES) return "A foto deve ter no máximo 2 MB.";
  return null;
}

export function avatarImageExtension(bytes: Uint8Array, mimeType: string): string {
  const error = avatarFileError(bytes.length, mimeType);
  if (error) throw new Error(error);
  const matches = (offset: number, signature: number[]) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (
    mimeType === "image/png" &&
    bytes.length >= 33 &&
    matches(0, [137, 80, 78, 71, 13, 10, 26, 10]) &&
    matches(12, [73, 72, 68, 82])
  )
    return "png";
  if (
    mimeType === "image/jpeg" &&
    bytes.length >= 12 &&
    matches(0, [255, 216, 255]) &&
    matches(bytes.length - 2, [255, 217])
  )
    return "jpg";
  if (
    mimeType === "image/webp" &&
    bytes.length >= 20 &&
    matches(0, [82, 73, 70, 70]) &&
    matches(8, [87, 69, 66, 80]) &&
    matches(12, [86, 80, 56])
  )
    return "webp";
  throw new Error("O conteúdo do arquivo não corresponde a uma imagem JPG, PNG ou WebP válida.");
}

export function isOwnAvatarPath(
  path: string | null,
  tenantId: string,
  userId: string,
): path is string {
  return Boolean(
    path &&
    path.startsWith(`${tenantId}/${userId}/`) &&
    /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path.split("/")[2] ?? "") &&
    path.split("/").length === 3,
  );
}
