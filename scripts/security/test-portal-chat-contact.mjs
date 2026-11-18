import assert from "node:assert/strict";
const { parsePersistedPortalChat, persistedChatMatchesContact } =
  await import("../../apps/web/src/lib/portal-chat-state.ts");
const contact = { id: "bc300000-0000-4000-8000-000000000001", email: null };
const chat = {
  contact_id: contact.id,
  email: "",
  ticket_id: "bc400000-0000-4000-8000-000000000001",
  number: 1,
};
assert.equal(persistedChatMatchesContact(null, contact), false);
assert.equal(persistedChatMatchesContact(chat, contact), true);
assert.equal(
  persistedChatMatchesContact(
    { ...chat, contact_id: "bc300000-0000-4000-8000-000000000002" },
    contact,
  ),
  false,
);
assert.equal(
  persistedChatMatchesContact({ ...chat, contact_id: undefined }, contact),
  false,
  "empty emails never identify a contact",
);
assert.equal(
  persistedChatMatchesContact(
    { ...chat, contact_id: undefined, email: "PERSON@example.test" },
    { ...contact, email: "person@example.test" },
  ),
  true,
);
assert.equal(
  persistedChatMatchesContact(chat, { ...contact, email: "new@example.test" }),
  true,
  "contact ID survives email change",
);
assert.equal(parsePersistedPortalChat({ email: null }), null);
assert.equal(parsePersistedPortalChat({ ...chat, number: "1" }), null);
assert.deepEqual(parsePersistedPortalChat(chat), chat);
console.log(
  "PASS portal chat identity: nullable email, stable contact ID, legacy nonempty email fallback, malformed cache rejected",
);
