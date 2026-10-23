import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = requireWeb("typescript");
function load(path) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports },
  );
  return exports;
}
const { SETTINGS_SECTIONS, canAccessSettingsSection, visibleSettingsNavigation, settingsSectionForPath, settingsTrail } = load("apps/web/src/lib/settings-navigation.ts");
const { MODULE_ORDER } = load("apps/web/src/lib/permission-catalog.ts");
function leaves(nodes) {
  return Array.from(nodes).flatMap((node) => typeof node === "string" ? [node] : leaves(node.children));
}
const all = Object.keys(SETTINGS_SECTIONS);
assert.equal(all.length, 16);
assert.deepEqual(leaves(visibleSettingsNavigation(() => true)).sort(), all.sort(), "Admin can reach every section exactly once");
assert.equal(visibleSettingsNavigation(() => false).length, 0);
for (const key of all) {
  const section = SETTINGS_SECTIONS[key];
  const parent = MODULE_ORDER.find((module) => module.key === section.module)?.parent;
  assert.equal(settingsSectionForPath(section.path + "/"), key);
  assert.equal(canAccessSettingsSection(key, (module) => module !== "configuracoes"), false, "Root permission required for " + key);
  assert.equal(canAccessSettingsSection(key, (module) => module !== section.module), false, "Leaf permission required for " + key);
  if (parent) assert.equal(canAccessSettingsSection(key, (module) => module !== parent), false, "Catalog parent required for " + key);
  const route = section.path.replace("/settings/", "settings.").replaceAll("/", ".");
  const source = readFileSync("apps/web/src/routes/_authenticated/" + route + ".tsx", "utf8");
  assert.ok(source.includes('section="' + key + '"'), "Deep link renders its guarded section: " + key);
}
const operatorOnly = (module) => ["configuracoes", "empresa_operadora"].includes(module);
assert.equal(canAccessSettingsSection("operating-companies", operatorOnly), true, "Operating companies do not depend on bank access");
assert.equal(canAccessSettingsSection("inter", operatorOnly), false);
assert.equal(canAccessSettingsSection("inter", (module) => module !== "empresa_operadora"), false, "Bank integration requires operator access");
const departmentOnly = (module) => ["configuracoes", "departamentos"].includes(module);
assert.deepEqual(leaves(visibleSettingsNavigation(departmentOnly)).sort(), ["departments", "financial"]);
assert.equal(visibleSettingsNavigation(departmentOnly).some((node) => node.id === "access"), false, "Hide empty access group");
assert.equal(visibleSettingsNavigation(departmentOnly).some((node) => node.id === "integrations"), false, "Hide empty integrations group");
assert.equal(settingsSectionForPath("/settings/access/roles-extra"), undefined);
assert.equal(settingsSectionForPath("/settings/unknown"), undefined);
assert.equal(settingsTrail("inter").join(" / "), "Parâmetros financeiros / Integrações bancárias / Banco Inter");
console.log("PASS settings navigation: 16 deep links, Admin, leaf/root/parent guards, independent operator access and empty groups");
