// Frontend real, APIs simuladas. Não confirma vínculos bancários reais.
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const files = readdirSync('apps/web/.output/server/_ssr');
function id(prefix, name) {
  const source = readFileSync('apps/web/.output/server/_ssr/' + files.find(f => f.startsWith(prefix)), 'utf8');
  return source.match(new RegExp('id: "([^"]+)",\\s+name: "' + name + '"'))[1];
}
const permissions = id('permissions.functions-', 'getMyPermissions');
const list = id('inter-binding.functions-', 'listInterOperatingCompanies');
const review = id('inter-binding.functions-', 'getInterBindingReview');
const confirm = id('inter-binding.functions-', 'confirmInterBinding');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts/inter-settings', { recursive: true });
try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let editable = true, empty = false, fail = false, confirmed = false, calls = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: 'b6200000-0000-0000-0000-000000000001', email: 'test@example.test', name: 'Teste', tenant_id: 'tenant-test', app: 'apticket', exp: 4102444800 }));
      localStorage.setItem('apticket_session_token', 'test.' + claims + '.mock');
    });
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.includes('/_serverFn/')) {
        if (url.includes(review) && fail) return route.fulfill({ json: { error: { message: 'Consulta indisponível no teste' }, context: {} } });
        if (url.includes(confirm)) { calls++; confirmed = true; }
        const result = url.includes(permissions) ? [{ module: 'financeiro', action: 'view' }, { module: 'financeiro', action: 'edit' }]
          : url.includes(list) ? empty ? [] : [{ id: 'b6300000-0000-0000-0000-000000000001', legal_name: 'APTECH SOLUCOES EM TECNOLOGIA DA INFORMACAO LTDA', tax_id: '36471917000111' }]
          : url.includes(review) ? { state: confirmed ? 'confirmed' : 'confirmation_required', configuration_version: 5, account_last_four: '5678', certificate_expires_at: '2026-10-09T00:00:00Z', binding_id: confirmed ? 'b6400000-0000-0000-0000-000000000001' : null, confirmed_at: confirmed ? '2026-09-09T15:00:00Z' : null, canConfirm: editable }
          : url.includes(confirm) ? { id: 'b6400000-0000-0000-0000-000000000001', reused: false, dispatch_enabled: false } : [];
        return route.fulfill({ json: { result, context: {} } });
      }
      if (!url.startsWith('http://127.0.0.1:4173')) return route.fulfill({ json: [] });
      return route.continue();
    });
    async function open() { await page.goto('http://127.0.0.1:4173/finance'); await page.getByRole('button', { name: 'Empresa operadora', exact: true }).click(); }
    await open();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Confirmar vínculo', exact: true });
    await submit.waitFor();
    assert.equal(await submit.isDisabled(), true);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('tab', { name: 'Produção / Oficial' }).click();
    await submit.waitFor();
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Atualizar consulta' }).click();
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false);
    await dialog.getByRole('checkbox').check();
    await page.screenshot({ path: `artifacts/inter-settings/binding-${width}.png` });
    await submit.click();
    await dialog.getByText('Confirmação registrada. Nenhuma cobrança foi enviada.').waitFor();
    assert.equal(calls, 1);
    assert.equal(await submit.count(), 0);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 1001);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    editable = false;
    await open();
    await dialog.getByText('Somente leitura.', { exact: false }).waitFor();
    assert.equal(await submit.count(), 0);
    if (width === 1440) {
      fail = true; await open();
      await dialog.getByRole('button', { name: 'Tentar novamente' }).waitFor({ timeout: 20000 });
      fail = false; await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
      await dialog.getByText('Somente leitura.', { exact: false }).waitFor();
      empty = true; await open(); await dialog.getByText('Nenhuma empresa disponível').waitFor();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS vínculo, confirmação, leitura, layout ${width}px`);
    await page.close();
  }
} finally { await browser.close(); }
