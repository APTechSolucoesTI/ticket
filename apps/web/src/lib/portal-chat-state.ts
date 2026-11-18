import { z } from "zod";
const persistedSchema = z.object({
  contact_id: z.string().uuid().optional(),
  email: z.string().max(255),
  ticket_id: z.string().uuid(),
  number: z.number().int().positive(),
});
export type PersistedPortalChat = z.infer<typeof persistedSchema>;
export function parsePersistedPortalChat(value: unknown): PersistedPortalChat | null {
  const parsed = persistedSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function persistedChatMatchesContact(
  chat: PersistedPortalChat | null,
  contact: { id: string; email: string | null },
): boolean {
  if (!chat) return false;
  if (chat.contact_id) return chat.contact_id === contact.id;
  return (
    !!contact.email?.trim() &&
    !!chat.email.trim() &&
    chat.email.trim().toLowerCase() === contact.email.trim().toLowerCase()
  );
}
