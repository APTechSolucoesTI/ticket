// Teste visual com APIs simuladas: não acessa tenant nem banco reais.
// PLAYWRIGHT_MODULE deve apontar para o index.mjs do Playwright instalado.
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const files = readdirSync('apps/web/.output/server/_ssr');
function functionId(prefix, name) {
  const source = readFileSync('apps/web/.output/server/_ssr/' + files.find(f => f.startsWith(prefix)), 'utf8');
  return source.match(new RegExp('id: "([^"]+)",\\s+name: "' + name + '"'))[1];
}
const permissionsId = functionId('permissions.functions-', 'getMyPermissions');
const listId = functionId('inter-settings.functions-', 'listInterSettings');
const saveId = functionId('inter-settings.functions-', 'saveInterSettings');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts/inter-settings', { recursive: true });
try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = [];
    let editable = true;
    let metadata = [];
    let failList = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const payload = btoa(JSON.stringify({ sub:'d2000000-0000-0000-0000-000000000001',email:'visual@example.test',name:'Administrador de teste',tenant_id:'d1000000-0000-0000-0000-000000000001',app:'apticket',exp:4102444800 }));
      localStorage.setItem('apticket_session_token', 'test.'+payload+'.mock');
    });
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.includes('/_serverFn/')) {
        if (url.includes(listId) && failList) return route.fulfill({json:{error:{message:'Falha simulada'},context:{}}});
        if (url.includes(saveId)) {
          metadata[0] = {...metadata[0],account:'987654',version:2};
          return route.fulfill({json:{result:{saved:true},context:{}}});
        }
        const result = url.includes(permissionsId) ? [{module:'configuracoes',action:'view'},{module:'empresa',action:'view'},...(editable?[{module:'empresa',action:'edit'}]:[])] : url.includes(listId) ? metadata : [];
        return route.fulfill({ json: { result, context: {} } });
      }
      if (!url.startsWith('http://127.0.0.1:4173')) return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto('http://127.0.0.1:4173/settings');
    await page.getByRole('tab', {name:'Banco Inter',exact:true}).click();
    await page.getByRole('button', {name:'Salvar configuração'}).waitFor();
    await page.getByRole('button', {name:'Salvar configuração'}).click();
    await page.getByText('Obrigatório na primeira configuração deste ambiente.').first().waitFor();
    await page.getByRole('tab', {name:'Produção / Oficial'}).click();
    await page.getByLabel('Selecionar este ambiente como padrão do tenant').check();
    await page.getByText('Confirmo que estou selecionando o ambiente oficial', {exact:false}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Overflow at '+width);
    assert.deepEqual(errors, [], 'Browser errors');
    await page.locator('main').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({path:`artifacts/inter-settings/production-${width}.png`,fullPage:true});
    console.log(`PASS layout/validation/production-confirmation ${width}px`);
    if (width === 1440) {
      metadata = [{environment:'sandbox',account:'123456',is_active:false,certificate_expires_at:'2040-01-01',certificate_fingerprint:'TEST-FINGERPRINT',version:1,updated_at:'2026-09-08'}];
      await page.reload();
      await page.getByRole('tab',{name:'Banco Inter',exact:true}).click();
      await page.getByLabel('Conta corrente com dígito').fill('987654');
      await page.getByRole('button',{name:'Salvar configuração'}).click();
      await page.getByText('Configuração do Inter salva com segurança.').waitFor();
      assert.equal(await page.getByLabel('Client Secret',{exact:true}).inputValue(),'');
      editable=false;
      await page.reload();
      await page.getByRole('tab',{name:'Banco Inter',exact:true}).click();
      await page.getByText('Somente leitura.',{exact:false}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Salvar configuração'}).isDisabled(),true);
      failList=true;
      await page.reload();
      await page.getByRole('tab',{name:'Banco Inter',exact:true}).click();
      await page.getByRole('button',{name:'Tentar novamente'}).waitFor({timeout:20000});
      failList=false;
      await page.getByRole('button',{name:'Tentar novamente'}).click();
      await page.getByText('Somente leitura.',{exact:false}).waitFor();
      console.log('PASS mocked save, secret masking, read-only, error and retry');
    }
    await page.close();
  }
} finally { await browser.close(); }
