// Isolated real-component browser regression. No application server, routes, auth or env files.
// Run: node scripts/security/test-dialog-windows.mjs
// Install Chromium with the same Playwright package, or set CHROME_PATH.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const web = path.join(root, "apps/web");
const requireWeb = createRequire(path.join(web, "package.json"));
const requireTools = createRequire(
  path.join(root, "node_modules/.cache/atomic-flow-tools/package.json"),
);
const { chromium } = requireTools(process.env.APTICKET_PLAYWRIGHT_MODULE || "playwright");
const { createServer } = await import(pathToFileURL(requireWeb.resolve("vite")).href);
const { default: tailwind } = await import(
  pathToFileURL(requireWeb.resolve("@tailwindcss/vite")).href
);
const { default: react } = await import(
  pathToFileURL(requireWeb.resolve("@vitejs/plugin-react")).href
);
const directory = path.join(root, "node_modules/.cache/dialog-windows-qa");
const fixture = path.join(root, "scripts/security/fixtures/dialog-windows.tsx");
const fsUrl = (value) => `/@fs/${value.replaceAll("\\", "/")}`;
await mkdir(directory, { recursive: true });
await writeFile(
  path.join(directory, "index.html"),
  `<!doctype html><html lang="pt-BR"><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Dialog windows fixture</title>
<link rel="stylesheet" href="${fsUrl(path.join(web, "src/styles.css"))}"></head>
<body><div id="root"></div><script type="module" src="${fsUrl(fixture)}"></script></body></html>`,
);
const server = await createServer({
  configFile: false,
  envDir: false,
  root: directory,
  logLevel: "warn",
  plugins: [
    react(),
    tailwind(),
    {
      name: "fixture-permission-boundary",
      resolveId(id) {
        if (id === "\0fixture-permissions") return id;
      },
      load(id) {
        if (id === "\0fixture-permissions")
          return "export const usePermissions=()=>({loading:false,has:()=>true});";
      },
    },
  ],
  resolve: {
    alias: [
      { find: "@/lib/use-permissions", replacement: "\0fixture-permissions" },
      { find: "@", replacement: path.join(web, "src") },
      { find: "react", replacement: path.dirname(requireWeb.resolve("react/package.json")) },
      {
        find: "react-dom",
        replacement: path.dirname(requireWeb.resolve("react-dom/package.json")),
      },
    ],
  },
  optimizeDeps: { entries: [fixture] },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
});
let browser;
const errors = [];
const checks = [];
let page;
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const dialog = (title = "Cadastro A") => page.getByRole("dialog", { name: title, exact: true });
const control = (name, title) => button(dialog(title), name);
const restore = (title = "Cadastro A") => button(page, `Restaurar ${title}`);
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function poll(read, predicate, message) {
  const end = Date.now() + 4000;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  } while (Date.now() < end);
  assert.fail(message);
}
async function bounds(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, "visible bounds required");
  return box;
}
async function reachable(title = "Cadastro A") {
  const viewport = page.viewportSize();
  for (const name of ["Minimizar janela", "Fechar janela"]) {
    const box = await bounds(control(name, title));
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1,
      `${name} inside viewport`,
    );
  }
}
async function open(title = "Cadastro A") {
  await button(page, `Abrir ${title}`).click();
  await dialog(title).waitFor();
}
async function reset(viewport = { width: 1440, height: 1000 }, dark = false) {
  await page.setViewportSize(viewport);
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate((value) => document.documentElement.classList.toggle("dark", value), dark);
  await button(page, "Abrir Cadastro A").waitFor();
}
try {
  await server.listen();
  const chrome =
    process.env.CHROME_PATH ||
    (process.platform === "win32" &&
    existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
      ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
      : undefined);
  browser = await chromium.launch({
    headless: true,
    ...(chrome ? { executablePath: chrome } : {}),
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(6000);
  page.on("pageerror", (error) => errors.push(error.message));
  // Block every external HTTP request, including font loading; the fixture uses system fallbacks.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await reset();
  await check("shared title and window controls", async () => {
    await open();
    await dialog().getByRole("heading", { name: "Cadastro A", exact: true }).waitFor();
    // First missing feature on the old primitive: baseline must fail here, not at module loading.
    await control("Maximizar janela").waitFor();
    await reachable();
  });
  await check("maximize and restore original geometry", async () => {
    const initial = await bounds(dialog());
    await control("Maximizar janela").click();
    await control("Restaurar tamanho").waitFor();
    const expanded = await bounds(dialog());
    assert.ok(
      expanded.width > initial.width + 100 && expanded.height >= initial.height,
      "maximized window grows despite caller max-width/max-height",
    );
    await reachable();
    await control("Minimizar janela").click();
    await restore().focus();
    await page.keyboard.press("Enter");
    await control("Restaurar tamanho").waitFor();
    const resumed = await bounds(dialog());
    assert.ok(
      Math.abs(resumed.width - expanded.width) < 3,
      "minimized maximized geometry survives",
    );
    await control("Restaurar tamanho").click();
    await poll(
      () => bounds(dialog()),
      (box) => Math.abs(box.width - initial.width) < 3 && Math.abs(box.x - initial.x) < 3,
      "restored original geometry",
    );
  });
  await check("titlebar pointer/keyboard movement and viewport clamping", async () => {
    const header = dialog().locator("[data-dialog-window-header]");
    const before = await bounds(dialog());
    const handle = await bounds(header);
    await page.mouse.move(handle.x + 35, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 125, handle.y + handle.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    const moved = await bounds(dialog());
    assert.ok(moved.x > before.x + 40, "titlebar drag moves window");
    await header.focus();
    await page.keyboard.press("ArrowLeft");
    await poll(
      () => bounds(dialog()),
      (box) => box.x < moved.x,
      "arrow keys move focused titlebar",
    );
    const current = await bounds(header);
    await page.mouse.move(current.x + 35, current.y + current.height / 2);
    await page.mouse.down();
    await page.mouse.move(-200, -200, { steps: 8 });
    await page.mouse.up();
    await reachable();
    await page.setViewportSize({ width: 900, height: 700 });
    await reachable();
  });
  await check(
    "restore clamps saved position after minimized/maximized viewport resize",
    async () => {
      const failures = [];
      for (const mode of ["minimized", "maximized"]) {
        await reset();
        await open();
        const header = dialog().locator("[data-dialog-window-header]");
        const handle = await bounds(header);
        await page.mouse.move(handle.x + 35, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(1430, handle.y + handle.height / 2, { steps: 8 });
        await page.mouse.up();
        assert.ok(
          (await bounds(dialog())).x > 700,
          "precondition: window dragged to desktop right edge",
        );
        await control(mode === "minimized" ? "Minimizar janela" : "Maximizar janela").click();
        await page.setViewportSize({ width: 768, height: 900 });
        if (mode === "minimized") await restore().click();
        else await control("Restaurar tamanho").click();
        await page.evaluate(() => new Promise(requestAnimationFrame));
        try {
          await reachable();
        } catch (error) {
          failures.push(
            `${mode}: ${error.message}; window=${JSON.stringify(await bounds(dialog()))}`,
          );
          await page.screenshot({ path: path.join(directory, `resize-${mode}-failure.png`) });
        }
      }
      assert.deepEqual(
        failures,
        [],
        "restoring either mode must keep saved geometry within new viewport",
      );
    },
  );
  await reset();
  await check("open modal blocks background click, focus and scrolling", async () => {
    await open();
    await dialog().getByLabel("Nome do rascunho").fill("Rascunho preservado");
    const background = page.getByLabel("Campo de fundo");
    await background.evaluate((element) => element.focus());
    assert.equal(
      await background.evaluate((element) => element === document.activeElement),
      false,
      "modal traps focus",
    );
    const target = await bounds(page.getByTestId("background-action"));
    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
    assert.equal(
      await page.getByTestId("background-action").textContent(),
      "Ação de fundo: 0",
      "background did not receive pointer click",
    );
    if (!(await dialog().isVisible())) await open(); // Outside dismissal remains the existing policy.
    await page.mouse.move(5, 5);
    await page.mouse.wheel(0, 450);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => scrollY), 0, "background scroll locked");
  });
  await check("minimize releases background and preserves React/DOM/file state", async () => {
    await dialog().getByLabel("Nome do rascunho").fill("Rascunho preservado");
    await button(dialog(), "Contador React: 0").click();
    await dialog()
      .getByLabel("Arquivo do rascunho")
      .setInputFiles({
        name: "rascunho.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("conteudo local"),
      });
    const originalInput = await dialog().getByLabel("Nome do rascunho").elementHandle();
    const closes = await page.getByTestId("closes-Cadastro A").textContent();
    await control("Minimizar janela").click();
    await restore().waitFor();
    assert.equal(await dialog().isVisible(), false);
    await button(page, "Ação de fundo: 0").click();
    await button(page, "Ação de fundo: 1").waitFor();
    await page.getByLabel("Campo de fundo").fill("Fundo liberado");
    assert.equal(
      await page
        .getByLabel("Campo de fundo")
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.mouse.move(20, 600);
    await page.mouse.wheel(0, 500);
    await poll(
      () => page.evaluate(() => scrollY),
      (value) => value > 100,
      "background scroll unlocked",
    );
    await restore().click();
    await dialog().waitFor();
    assert.equal(await dialog().getByLabel("Nome do rascunho").inputValue(), "Rascunho preservado");
    assert.equal(
      await dialog()
        .getByLabel("Nome do rascunho")
        .evaluate((element, original) => element === original, originalInput),
      true,
      "same uncontrolled DOM node survives",
    );
    await button(dialog(), "Contador React: 1").waitFor();
    assert.deepEqual(
      await dialog()
        .getByLabel("Arquivo do rascunho")
        .evaluate(async (element) => [element.files[0]?.name, await element.files[0]?.text()]),
      ["rascunho.txt", "conteudo local"],
    );
    assert.equal(
      await page.getByTestId("closes-Cadastro A").textContent(),
      closes,
      "minimize/restore never calls close callback",
    );
    await originalInput.dispose();
  });
  await check("portalled Select/Popover and nested confirmation remain usable", async () => {
    await dialog().getByRole("combobox", { name: "Prioridade" }).click();
    await page.getByRole("option", { name: "Alta", exact: true }).click();
    assert.equal(
      await dialog().getByRole("combobox", { name: "Prioridade" }).textContent(),
      "Alta",
    );
    await button(dialog(), "Abrir ajuda").click();
    await page.getByLabel("Nota na ajuda").fill("Ajuda funciona");
    await page.keyboard.press("Escape");
    await button(dialog(), "Abrir janela filha").click();
    await dialog("Cadastro filho").waitFor();
    await page.getByLabel("Campo filho").fill("Filho");
    await control("Minimizar janela", "Cadastro filho").click();
    await restore("Cadastro filho").waitFor();
    assert.equal(await dialog().isVisible(), true, "parent remains modal after child minimizes");
    const background = page.getByLabel("Campo de fundo");
    await background.evaluate((element) => element.focus());
    assert.equal(await background.evaluate((element) => element === document.activeElement), false);
    await restore("Cadastro filho").click();
    assert.equal(await page.getByLabel("Campo filho").inputValue(), "Filho");
    await control("Fechar janela", "Cadastro filho").click();
    await dialog().getByLabel("Nome do rascunho").fill("Pai continua ativo");
    await button(dialog(), "Solicitar confirmação").click();
    const confirmation = page.getByRole("alertdialog", { name: "Confirmar alteração" });
    await confirmation.waitFor();
    assert.equal(await button(confirmation, "Minimizar janela").count(), 0);
    await button(confirmation, "Voltar ao cadastro").click();
    await dialog().waitFor();
  });
  await check("multiple docks, uncontrolled root, close and owner unmount", async () => {
    await control("Minimizar janela").click();
    await open("Cadastro B");
    await dialog("Cadastro B").getByLabel("Nome do rascunho").fill("Segundo cadastro");
    await control("Minimizar janela", "Cadastro B").click();
    await restore().waitFor();
    await restore("Cadastro B").waitFor();
    await restore("Cadastro B").click();
    assert.equal(
      await dialog("Cadastro B").getByLabel("Nome do rascunho").inputValue(),
      "Segundo cadastro",
    );
    await control("Fechar janela", "Cadastro B").click();
    assert.equal(await restore("Cadastro B").count(), 0);
    await button(page, "Fechar Cadastro A").click();
    assert.equal(await restore().count(), 0, "dock close uses the existing close callback");
    assert.ok(Number(await page.getByTestId("closes-Cadastro A").textContent()) > 0);
    await open();
    await control("Minimizar janela").click();
    await button(page, "Desmontar proprietário").click();
    assert.equal(await restore().count(), 0, "owner unmount removes stale dock");
  });
  await reset();
  await check("mandatory opt-out cannot minimize, close, or escape", async () => {
    await button(page, "Abrir escolha obrigatória").click();
    const mandatory = dialog("Escolha obrigatória");
    await mandatory.waitFor();
    assert.equal(
      await mandatory.getByRole("button").count(),
      1,
      "only the mandatory action is exposed",
    );
    assert.equal(await mandatory.getByRole("button", { name: /janela/ }).count(), 0);
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    assert.equal(await mandatory.isVisible(), true);
    await button(mandatory, "Concluir escolha").click();
  });
  for (const [size, viewport] of Object.entries({
    desktop: { width: 1440, height: 1000 },
    tablet: { width: 900, height: 900 },
    mobile: { width: 390, height: 844 },
  })) {
    for (const dark of [false, true])
      await check(`${size} ${dark ? "dark" : "light"} controls and restoration`, async () => {
        await reset(viewport, dark);
        await open();
        await reachable();
        assert.ok(
          await dialog().evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          "no horizontal overflow",
        );
        if (size === "mobile")
          for (const name of ["Minimizar janela", "Fechar janela"]) {
            const box = await bounds(control(name));
            assert.ok(box.width >= 44 && box.height >= 44, "mobile touch targets at least 44px");
          }
        await page.screenshot({
          path: path.join(directory, `${size}-${dark ? "dark" : "light"}.png`),
        });
        await control("Minimizar janela").click();
        await restore().click();
        await reachable();
        await control("Fechar janela").click();
        assert.equal(await restore().count(), 0);
      });
  }
  await check(
    "rich editor preserves formatted HTML, editing and Undo across minimize",
    async () => {
      await reset();
      await button(page, "Abrir editor").click();
      const editorDialog = dialog("Cadastro com editor");
      const editable = editorDialog.locator('[contenteditable="true"]');
      const html = () => page.getByTestId("editor-html").textContent();
      const liveResources = () =>
        page.evaluate(() => {
          const probe = window.__dialogResourceProbe;
          return probe.created - probe.disposed;
        });
      await editable.fill("Texto formatado");
      await poll(
        liveResources,
        (value) => value === 1,
        "one live resource while open under StrictMode",
      );
      await editable.press("ControlOrMeta+a");
      await editorDialog.getByTitle("Negrito", { exact: true }).click();
      const formatted = await poll(
        html,
        (value) => value.includes("<strong>Texto formatado</strong>"),
        "formatted HTML generated",
      );
      await editorDialog.getByTitle("Desfazer", { exact: true }).click();
      const previousUndo = await poll(
        html,
        (value) => value !== formatted,
        "Undo works before minimize",
      );
      await editorDialog.getByTitle("Refazer", { exact: true }).click();
      await poll(html, (value) => value === formatted, "Redo restores formatted HTML");
      await control("Minimizar janela", "Cadastro com editor").click();
      await restore("Cadastro com editor").waitFor();
      await page.waitForTimeout(600); // Exceeds TipTap's deferred destruction and history grouping timers.
      assert.equal(await liveResources(), 1, "minimizing retains the imperative resource");
      await restore("Cadastro com editor").click();
      await page.waitForTimeout(100); // Allow the editor's resumed effects to finish before checking crashes.
      assert.deepEqual(errors, [], "restoring the real editor does not crash");
      assert.equal(await liveResources(), 1, "restoring reuses the imperative resource");
      await editable.waitFor();
      assert.equal(await html(), formatted, "controlled formatted HTML survives hidden effects");
      await editable.click();
      await editable.press("ControlOrMeta+End");
      await editable.pressSequentially(" após restaurar");
      await poll(
        html,
        (value) => value.includes("após restaurar"),
        "editor accepts typing after restore",
      );
      await editorDialog.getByTitle("Desfazer", { exact: true }).click();
      await poll(html, (value) => value === formatted, "Undo removes post-restore typing");
      await editorDialog.getByTitle("Desfazer", { exact: true }).click();
      assert.equal(await html(), previousUndo, "pre-minimize Undo history survives");
      await control("Fechar janela", "Cadastro com editor").click();
      await poll(
        liveResources,
        (value) => value === 0,
        "actual close disposes the imperative resource",
      );
      await button(page, "Abrir editor").click();
      await editable.waitFor();
      await poll(liveResources, (value) => value === 1, "reopening creates one live resource");
      assert.equal(
        await html(),
        "<p>Inicial editor</p>",
        "reopening initializes a fresh controlled draft",
      );
      assert.equal(
        await editable.textContent(),
        "Inicial editor",
        "new editor contains no previous draft",
      );
      await editorDialog.getByTitle("Desfazer", { exact: true }).click();
      assert.equal(
        await editable.textContent(),
        "Inicial editor",
        "closed editor Undo history is disposed",
      );
      assert.deepEqual(errors, [], "closing and reopening the editor does not crash");
      await control("Fechar janela", "Cadastro com editor").click();
      await poll(liveResources, (value) => value === 0, "second close has no resource leak");
      await button(page, "Abrir editor").click();
      await editable.waitFor();
      await control("Minimizar janela", "Cadastro com editor").click();
      await button(page, "Desmontar editor").click();
      await poll(
        liveResources,
        (value) => value === 0,
        "owner unmount disposes suspended resources",
      );
      assert.equal(await restore("Cadastro com editor").count(), 0, "unmount removes editor dock");
    },
  );
  await check("nested suspended resource survives minimizing its parent", async () => {
    await reset();
    await open();
    await button(dialog(), "Abrir janela filha").click();
    const identity = page.getByTestId("child-resource-identity");
    await identity.waitFor();
    const original = await identity.textContent();
    const live = () =>
      page.evaluate(() => {
        const probe = window.__dialogChildResourceProbe;
        return probe.created - probe.disposed;
      });
    const retained = async (phase) => {
      assert.equal(await live(), 1, `${phase}: nested resource remains live`);
    };
    await poll(live, (value) => value === 1, "child resource exists while open");
    await control("Minimizar janela", "Cadastro filho").click();
    await restore("Cadastro filho").waitFor();
    await retained("child minimized");
    await control("Minimizar janela").click();
    await restore().waitFor();
    await page.waitForTimeout(100);
    await retained("parent and child minimized");
    await restore().click();
    await dialog().waitFor();
    await retained("parent restored with child suspended");
    await restore("Cadastro filho").click();
    await dialog("Cadastro filho").waitFor();
    await page.waitForTimeout(100);
    await retained("child restored");
    assert.equal(
      await identity.textContent(),
      original,
      "child retains the same resource identity",
    );
    await control("Fechar janela", "Cadastro filho").click();
    await control("Fechar janela").click();
    await poll(live, (value) => value === 0, "final close disposes nested resource");
  });
  assert.deepEqual(errors, [], "no browser runtime errors");
  console.log(`PASS dialog windows: ${checks.length} behavioral checks; screenshots: ${directory}`);
} catch (error) {
  if (page) {
    const metadata = await page
      .evaluate(() => {
        const describe = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            html: element.outerHTML.slice(0, 700),
            rect: rect.toJSON(),
            display: style.display,
            zIndex: style.zIndex,
            pointerEvents: style.pointerEvents,
            parentDialog: element.parentElement
              ?.closest('[role="dialog"]')
              ?.getAttribute("aria-labelledby"),
            hits: document
              .elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
              .slice(0, 8)
              .map((hit) => hit.outerHTML.slice(0, 500)),
          };
        };
        return {
          active: document.activeElement?.outerHTML.slice(0, 500),
          scrollY,
          body: {
            overflow: getComputedStyle(document.body).overflow,
            pointerEvents: getComputedStyle(document.body).pointerEvents,
          },
          surfaces: [
            ...document.querySelectorAll(
              '[role="dialog"], [role="alertdialog"], [data-dialog-restore], [data-dialog-dock-slot]',
            ),
          ].map(describe),
          overlays: [...document.querySelectorAll("[data-state]")]
            .filter((element) => getComputedStyle(element).position === "fixed")
            .map(describe),
        };
      })
      .catch((failure) => ({ error: failure.message }));
    await writeFile(path.join(directory, "failure-dom.json"), JSON.stringify(metadata, null, 2));
  }
  if (page)
    await page
      .screenshot({ path: path.join(directory, "failure.png"), fullPage: true })
      .catch(() => {});
  console.error(`FAIL dialog windows after ${checks.length} checks: ${error.message}`);
  if (errors.length) console.error("Browser errors:", errors);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
