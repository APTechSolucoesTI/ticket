import assert from "node:assert/strict";
// Query state is a runtime boundary, not just a TypeScript declaration.
const { ticketListSearchSchema, ticketInboxResultSchema, validateTicketRouteSearch } =
  await import("../../apps/web/src/lib/ticket-query.ts");
const defaults = ticketListSearchSchema.parse({});
assert.equal(
  validateTicketRouteSearch({}).pageSize,
  undefined,
  "SSR must not materialize a size before browser preferences load",
);
assert.equal(validateTicketRouteSearch({ pageSize: 50 }).pageSize, 50);
assert.equal(validateTicketRouteSearch({ pageSize: 11 }).pageSize, 10);
assert.equal(defaults.page, 1);
assert.equal(defaults.pageSize, 10);
assert.deepEqual(defaults.status, ["new", "in_progress", "pending"]);
assert.equal(ticketListSearchSchema.parse({ page: "3", pageSize: "20", search: "ação" }).page, 3);
assert.equal(ticketListSearchSchema.parse({ page: -1, pageSize: 11 }).page, 1);
assert.equal(ticketListSearchSchema.parse({ page: -1, pageSize: 11 }).pageSize, 10);
assert.deepEqual(ticketListSearchSchema.parse({ status: "new,pending" }).status, [
  "new",
  "pending",
]);
assert.deepEqual(ticketListSearchSchema.parse({ status: [] }).status, []);
assert.equal(ticketListSearchSchema.parse({ sortKey: "id;drop table tickets" }).sortKey, "");
assert.equal(
  ticketInboxResultSchema.safeParse({ items: [], total: -1, page: 1, pageSize: 10 }).success,
  false,
);
console.log(
  "PASS ticket query boundary: URL defaults, explicit clear, sizes, filters, sort whitelist and remote response",
);
