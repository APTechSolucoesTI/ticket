// Operator CLI: no dotenv, no default credentials, audit unless --apply is given.
import { createRequire } from "node:module";
import { open, readFile } from "node:fs/promises";
import { auditStorage, applyManifest, storageOrigin } from "./reconciliation.mjs";
const requireApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
let output;
try {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--tenant", "--days", "--page-size", "--max-objects", "--report", "--apply"].includes(
        args[i],
      ) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      Object.hasOwn(options, args[i])
    )
      throw new Error("storage_arguments_invalid");
    options[args[i]] = args[i + 1];
  }
  if (
    !options["--report"] ||
    (options["--apply"] &&
      ["--tenant", "--days", "--page-size", "--max-objects"].some((key) => options[key]))
  )
    throw new Error("storage_arguments_invalid");
  const url = process.env.APTICKET_STORAGE_URL,
    key = process.env.APTICKET_STORAGE_SERVICE_KEY;
  if (!url || !key) throw new Error("storage_environment_required");
  const origin = storageOrigin(url);
  const manifest = options["--apply"]
    ? JSON.parse(await readFile(options["--apply"], "utf8"))
    : null;
  // Refuse overwrites before any external operation. Reports can contain paths;
  // keep them outside git and restrict access using the host's filesystem ACLs.
  output = await open(options["--report"], "wx", 0o600);
  const { createClient } = requireApi("@supabase/supabase-js");
  const client = createClient(origin, key, {
    db: { schema: "apticket" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }),
    },
  });
  const result = manifest
    ? await applyManifest(client, manifest, { origin })
    : await auditStorage(client, {
        origin,
        tenant: options["--tenant"],
        days: Number(options["--days"] ?? 30),
        pageSize: Number(options["--page-size"] ?? 100),
        maxObjects: Number(options["--max-objects"] ?? 10000),
      });
  await output.writeFile(JSON.stringify(result, null, 2) + "\n");
  console.log(
    manifest
      ? `Storage: ${result.deletedOrAbsent} removidos/ausentes; ${result.protected} protegidos; ${result.missing} ausentes antes da reserva.`
      : `Storage: ${result.objects.length} objetos auditados; ${result.objects.filter((row) => row.state === "candidate").length} candidatos; inventário ${result.truncated ? "parcial" : "completo"}.`,
  );
} catch {
  console.error(
    "storage_reconciliation_failed: confira argumentos, variáveis explícitas, destino, migrations e relatório; reservas já adquiridas permanecem válidas para retry.",
  );
  process.exitCode = 1;
} finally {
  await output?.close();
}
