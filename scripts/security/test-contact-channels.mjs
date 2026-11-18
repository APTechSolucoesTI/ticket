import assert from "node:assert/strict";
const { contactPrimaryChannelsSchema, hasContactChannel } =
  await import("../../apps/web/src/lib/contact-channels.ts");
for (const input of [
  { email: " Person@example.test ", phone: "" },
  { email: "", phone: "(11) 98888-7777" },
  { email: null, phone: "5511988887777" },
  { phone: "5511988887777" },
  { email: "person@example.test", phone: "5511988887777" },
])
  assert.equal(contactPrimaryChannelsSchema.safeParse(input).success, true, JSON.stringify(input));
for (const input of [
  {},
  { email: "", phone: "" },
  { email: "  ", phone: "  " },
  { email: null, phone: null },
  { email: "invalid", phone: "5511988887777" },
  { email: "person@example.test", phone: "123" },
  { phone: "abc" },
])
  assert.equal(contactPrimaryChannelsSchema.safeParse(input).success, false, JSON.stringify(input));
assert.deepEqual(
  contactPrimaryChannelsSchema.parse({ email: " Person@example.test ", phone: null }),
  { email: "person@example.test", phone: "" },
);
assert.equal(hasContactChannel({ secondary_emails: ["secondary@example.test"] }), true);
assert.equal(hasContactChannel({ secondary_phones: ["5511988887777"] }), true);
assert.equal(
  hasContactChannel({ email: " ", phone: null, secondary_emails: [], secondary_phones: [] }),
  false,
);
console.log(
  "PASS contact channel boundary: email-only, phone-only, both, missing/blank, invalid supplied fields, normalization and secondary presence",
);
