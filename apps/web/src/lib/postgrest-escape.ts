/**
 * Escapes a value for safe interpolation into a PostgREST filter string
 * (e.g. `.or()`, `.filter()`), per PostgREST's "Quoting Values" rules:
 * https://postgrest.org/en/stable/references/api/tables_views.html#operators
 *
 * Without this, characters that are part of PostgREST's filter grammar
 * (`,` `.` `(` `)` `:`) let a user-controlled search term inject extra
 * conditions or operators into the query - e.g. a search for
 * `x,id.neq.00000000-0000-0000-0000-000000000000` widens the `.or()`
 * beyond the intended column/operator pair.
 *
 * Wrapping the value in double quotes makes PostgREST treat it as a
 * single opaque literal; backslashes and embedded quotes are escaped
 * so the quoting itself can't be broken out of.
 */
export function escapePostgrestValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
