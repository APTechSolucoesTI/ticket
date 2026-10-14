import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isOwnAvatarPath, PROFILE_AVATAR_BUCKET } from "@/lib/profile-avatar";

export async function resolveProfileAvatar(
  path: string | null,
  tenantId: string,
  userId: string,
): Promise<string | null> {
  if (!path) return null;
  if (!isOwnAvatarPath(path, tenantId, userId)) {
    // Retain existing external avatars; never sign another user's storage path.
    return /^https:\/\//i.test(path) ? path : null;
  }
  const { data, error } = await supabaseAdmin.storage
    .from(PROFILE_AVATAR_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

export async function deleteOwnAvatar(path: string | null, tenantId: string, userId: string) {
  if (!isOwnAvatarPath(path, tenantId, userId)) return;
  const { error } = await supabaseAdmin.storage.from(PROFILE_AVATAR_BUCKET).remove([path]);
  if (error) console.warn("Não foi possível limpar o arquivo de foto substituído.");
}
