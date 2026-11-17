// Optional local Lua interpreter. CI also executes the same script in real Redis.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { FIXED_WINDOW_RATE_LIMIT_SCRIPT } = requireApi("./dist/queue/redis-rate-limit.js");
const requireTool = createRequire(
  new URL("../../node_modules/.cache/atomic-flow-tools/package.json", import.meta.url),
);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = requireTool("fengari");
const state = lauxlib.luaL_newstate();
lualib.luaL_openlibs(state);
const program = `
local store = {}
local now = 0
redis = {}
redis.call = function(command, key, value)
 local row = store[key]
 if row and row.expires and row.expires <= now then store[key] = nil; row = nil end
 if command == 'INCR' then
  if not row then row = {count = 0}; store[key] = row end
  row.count = row.count + 1; return row.count
 elseif command == 'TTL' then
  if not row then return -2 end
  if not row.expires then return -1 end
  return math.floor(row.expires - now)
 elseif command == 'EXPIRE' then
  assert(row); row.expires = now + tonumber(value); return 1
 end
 error('unexpected command')
end
local function check(key, seconds)
 KEYS = {key}; ARGV = {tostring(seconds)}
 return (function()
${FIXED_WINDOW_RATE_LIMIT_SCRIPT}
 end)()
end
for n = 1, 100 do local result = check('burst',60); assert(result[1] == n); assert(result[2] == 60) end
now = 17
local next = check('burst',60); assert(next[1] == 101 and next[2] == 43)
assert(store['burst'].expires == 60)
store['orphan'] = {count=7}
local orphan = check('orphan',60); assert(orphan[1] == 8 and orphan[2] == 60)
assert(store['orphan'].expires == 77)
store['zero'] = {count=0,expires=now+10}
local zero = check('zero',60); assert(zero[1] == 1 and zero[2] == 10)
assert(store['zero'].expires == 27)
now = 59.75
local boundary = check('burst',60); assert(boundary[2] == 0)
now = 60.1
local renewed = check('burst',60); assert(renewed[1] == 1 and renewed[2] == 60)
`;
try {
  const status = lauxlib.luaL_dostring(state, to_luastring(program));
  assert.equal(
    status,
    lua.LUA_OK,
    status === lua.LUA_OK ? "" : to_jsstring(lua.lua_tostring(state, -1)),
  );
  console.log(
    "PASS actual Lua: burst counts, unchanged expiration, orphan repair, TTL zero and next window",
  );
} finally {
  lua.lua_close(state);
}
