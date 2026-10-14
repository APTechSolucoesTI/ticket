import assert from "node:assert/strict";
import { test } from "node:test";
import { allocationError, allocationTotal, percentageUnits, allocationPayload, allocationSummary } from "../apps/web/src/lib/contract-allocations.ts";
const item = (id, percentage) => ({ item_id: id, percentage });
test("decimal percentages total exactly 100 without floats", () => {
  assert.equal(allocationTotal([item("a", "33,33"), item("b", "33.33"), item("c", "33.34")]), 10000);
  assert.equal(allocationError([item("a", "33.33"), item("b", "66.67")], "categorias"), null);
});
test("invalid percentage values are rejected before rounding", () => {
  for (const value of ["0", "-1", "100.01", "33.333", "1e2", "", "NaN", Infinity]) assert.equal(percentageUnits(value), null, String(value));
});
test("missing, duplicate and incorrect totals block save", () => {
  for (const rows of [[], [item("", 100)], [item("a", 50), item("a", 50)], [item("a", 90)], [item("a", 70), item("b", 40)]]) assert.ok(allocationError(rows, "categorias"));
});
test("dimensions are independent", () => {
  assert.equal(allocationError([item("a", 100)], "categorias"), null);
  assert.match(allocationError([item("b", 90)], "centros"), /atual: 90%/);
});
test("transport normalizes comma and summary preserves percentages", () => {
  assert.deepEqual(allocationPayload([item("a", "33,33")]), [{ item_id: "a", percentage: "33.33" }]);
  assert.equal(allocationSummary([{ ...item("a", 70), name: "Serviços" }, { ...item("b", 30), name: "Licenças" }]), "Serviços (70%) / Licenças (30%)");
});
