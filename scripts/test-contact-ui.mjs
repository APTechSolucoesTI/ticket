// Real frontend, mocked APIs. Database invariants are covered by the SQL test.
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const files = readdirSync('apps/web/.output/server/_ssr');
const source = readFileSync('apps/web/.output/server/_ssr/' + files.find(f => f.startsWith('permissions.functions-')), 'utf8');
const permissions = source.match(/id: "([^"]+)",\s+name: "getMyPermissions"/)[1];
let activePage; const trace = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const companyA = 'b6300000-0000-4000-8000-000000000001';
const companyB = 'b6300000-0000-4000-8000-000000000002';
const contactId = 'b6400000-0000-4000-8000-000000000001';
mkdirSync('artifacts/contacts', { recursive: true });
try {
  for (const [width, height] of [[1440, 900], [1366, 768], [768, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    activePage = page;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let contacts = [], saved = null, clientPayload = null, editable = true, failSave = false, companyError = false;
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: 'b6200000-0000-4000-8000-000000000001', email: 'test@example.test', name: 'Teste', tenant_id: 'tenant-test', app: 'apticket', exp: 4102444800 }));
      localStorage.setItem('apticket_session_token', 'test.' + claims + '.mock');
    });
    await page.route('**/*', async route => {
      const request = route.request(), url = request.url(); if (url.includes('/rest/v1/')) trace.push({url, method: request.method(), body: request.postData()});
      if (url.includes('/_serverFn/')) {
        const result = url.includes(permissions) ? ['contatos', 'tickets'].flatMap(module => (editable ? ['view', 'create', 'edit', 'delete'] : ['view']).map(action => ({ module, action }))) : [];
        return route.fulfill({ json: { result, context: {} } });
      }
      if (url.includes('/rest/v1/companies')) return route.fulfill(companyError ? { status: 500, json: { message: 'Unavailable' } } : { json: [{ id: companyA, name: 'APTech Soluções' }, { id: companyB, name: 'Empresa Beta' }] });
      if (url.includes('/rest/v1/profiles')) return route.fulfill({ json: { tenant_id: 'tenant-test' } });
      if (url.includes('/rest/v1/rpc/set_contact_companies')) {
        clientPayload = request.postDataJSON();
        return route.fulfill({ status: 204, body: '' });
      }
      if (url.includes('/rest/v1/contacts')) {
        if (request.method() === 'POST' || request.method() === 'PATCH') {
          if (failSave) return route.fulfill({ status: 500, json: { message: 'Não foi possível salvar o contato.' } });
          saved = request.postDataJSON();
          contacts = [{ ...saved, id: contactId, contact_companies: saved.company_id === companyB ? [{ company_id: companyB, companies: { name: 'Empresa Beta' } }, { company_id: companyA, companies: { name: 'APTech Soluções' } }] : [{ company_id: companyA, companies: { name: 'APTech Soluções' } }] }];
          return route.fulfill({ json: request.method() === 'POST' ? { id: contactId } : null });
        }
        return route.fulfill({ json: contacts });
      }
      if (!url.startsWith('http://127.0.0.1:4173')) return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto('http://127.0.0.1:4173/contacts');
    await page.getByRole('button', { name: 'Novo contato', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByText('Novo contato', { exact: true }) });
    await dialog.getByRole('button', { name: 'Salvar contato', exact: true }).click();
    await dialog.getByText('Selecione ao menos um cliente', { exact: true }).waitFor();
    await dialog.getByLabel('Clientes *', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill('Beta');
    await page.getByRole('option', { name: /Empresa Beta/ }).click();
    await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill('APTech');
    await page.getByRole('option', { name: /APTech/ }).click();
    await page.getByRole('button', { name: 'Concluir', exact: true }).click();
    await dialog.getByLabel('Nome *', { exact: true }).fill('Contato de teste');
    await dialog.getByLabel('E-mails *', { exact: true }).click();
    await page.getByLabel('E-mail 1 · Principal', { exact: true }).fill(' PRIMARY@example.com ');
    await page.getByRole('button', { name: 'Adicionar e-mail', exact: true }).click();
    await page.getByLabel('E-mail 2', { exact: true }).fill('primary@example.com');
    await page.getByRole('button', { name: 'Concluir', exact: true }).click();
    await dialog.getByRole('button', { name: 'Salvar contato', exact: true }).click();
    await dialog.getByText('Este e-mail já foi informado no contato', { exact: true }).waitFor();
    await dialog.getByLabel('E-mails *', { exact: true }).click();
    await page.getByLabel('E-mail 2', { exact: true }).fill('secondary@example.com');
    await page.getByRole('button', { name: 'Concluir', exact: true }).click();
    await dialog.getByRole('button', { name: 'Definir secondary@example.com como e-mail principal', exact: true }).click();
    await page.screenshot({ path: `artifacts/contacts/form-${width}.png` });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    const buttonBounds = await dialog.getByRole('button', { name: 'Salvar contato', exact: true }).boundingBox();
    assert.ok(buttonBounds.y + buttonBounds.height <= height, 'Save stays inside viewport');
    await dialog.getByRole('button', { name: 'Salvar contato', exact: true }).click();
    await page.getByText('Contato criado', { exact: true }).waitFor();
    assert.equal(saved.phone, null);
    assert.deepEqual(saved.secondary_phones, []);
    assert.deepEqual(saved.secondary_emails, ['primary@example.com']);
    assert.equal(saved.email, 'secondary@example.com');
    assert.deepEqual(clientPayload.p_company_ids, [companyB, companyA]);
    await page.goto(`http://127.0.0.1:4173/contacts?record=${contactId}`);
    const edit = page.getByRole('dialog').filter({ has: page.getByText('Editar contato', { exact: true }) });
    const primaryEmail = edit.getByRole('button', { name: 'Definir secondary@example.com como e-mail principal', exact: true });
    await primaryEmail.waitFor();
    assert.equal(await primaryEmail.getAttribute('aria-pressed'), 'true');
    await edit.getByLabel('Telefones (opcional)', { exact: true }).click();
    await page.getByLabel('Telefone 1 · Principal', { exact: true }).fill('11988881010');
    await page.getByRole('button', { name: 'Adicionar telefone', exact: true }).click();
    await page.getByLabel('Telefone 2', { exact: true }).fill('11977772020');
    await page.getByRole('button', { name: 'Concluir', exact: true }).click();
    await edit.getByRole('button', { name: 'Definir 55 11 97777-2020 como telefone principal', exact: true }).click();
    await page.screenshot({ path: `artifacts/contacts/primary-${width}.png` });
    if (width === 1366) {
      await edit.getByLabel('E-mails *', { exact: true }).click();
      for (let index = 3; index <= 8; index++) {
        await page.getByRole('button', { name: 'Adicionar e-mail', exact: true }).click();
        await page.getByLabel(`E-mail ${index}`, { exact: true }).fill(`secondary${index}@example.com`);
      }
      await page.getByRole('button', { name: 'Concluir', exact: true }).click();
      await page.screenshot({ path: 'artifacts/contacts/many-emails-1366.png' });
      const saveBounds = await edit.getByRole('button', { name: 'Salvar contato', exact: true }).boundingBox();
      assert.ok(saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= height, 'Save remains visible with many channels');
      assert.equal(await edit.evaluate(el => el.scrollWidth > el.clientWidth), false);
      for (let index = 8; index >= 3; index--) await edit.getByRole('button', { name: `Remover e-mail secondary${index}@example.com`, exact: true }).click();
    }
    await edit.getByRole('button', { name: 'Definir APTech Soluções como cliente principal', exact: true }).click();
    await edit.getByRole('button', { name: 'Salvar contato', exact: true }).click();
    await page.getByText('Contato atualizado', { exact: true }).waitFor();
    assert.equal(saved.phone, '5511977772020');
    assert.deepEqual(saved.secondary_phones, ['5511988881010']);
    await page.goto(`http://127.0.0.1:4173/contacts?record=${contactId}`);
    const reopened = page.getByRole('dialog').filter({ has: page.getByText('Editar contato', { exact: true }) });
    const primaryPhone = reopened.getByRole('button', { name: 'Definir 55 11 97777-2020 como telefone principal', exact: true });
    await primaryPhone.waitFor();
    assert.equal(await primaryPhone.getAttribute('aria-pressed'), 'true');
    await reopened.getByRole('button', { name: 'Remover e-mail secondary@example.com', exact: true }).click();
    assert.equal(await reopened.getByRole('button', { name: 'Definir primary@example.com como e-mail principal', exact: true }).getAttribute('aria-pressed'), 'true');
    await reopened.getByRole('button', { name: 'Remover telefone 55 11 97777-2020', exact: true }).click();
    assert.equal(await reopened.getByRole('button', { name: 'Definir 55 11 98888-1010 como telefone principal', exact: true }).getAttribute('aria-pressed'), 'true');
    await reopened.getByRole('button', { name: 'Remover telefone 55 11 98888-1010', exact: true }).click();
    if (width === 1440) {
      failSave = true;
      await reopened.getByRole('button', { name: 'Salvar contato', exact: true }).click();
      await page.getByText('Não foi possível salvar o contato.', { exact: true }).waitFor();
      assert.ok(await reopened.isVisible());
      failSave = false;
    }
    await reopened.getByRole('button', { name: 'Salvar contato', exact: true }).click();
    await page.getByText('Contato atualizado', { exact: true }).waitFor();
    assert.equal(saved.email, 'primary@example.com');
    assert.equal(saved.phone, null);
    assert.deepEqual(saved.secondary_emails, []);
    assert.deepEqual(saved.secondary_phones, []);
    editable = false;
    await page.goto(`http://127.0.0.1:4173/contacts?record=${contactId}`);
    const view = page.getByRole('dialog').filter({ has: page.getByText('Visualizar contato', { exact: true }) });
    await view.getByText('Modo de leitura.', { exact: false }).waitFor();
    assert.equal(await view.getByRole('button', { name: 'Salvar contato', exact: true }).count(), 0);
    assert.equal(await view.getByRole('button', { name: 'Adicionar e-mail', exact: true }).count(), 0);
    assert.equal(await view.getByLabel('Clientes *', { exact: true }).isDisabled(), true);
    assert.equal(await view.getByLabel('E-mails *', { exact: true }).isDisabled(), true);
    assert.equal(await view.getByLabel('Telefones (opcional)', { exact: true }).isDisabled(), true);
    assert.equal(await view.getByRole('button', { name: 'Definir primary@example.com como e-mail principal', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log(`PASS contact create/edit/remove, validation, primary client, read-only and layout ${width}x${height}`);
    await page.close();
  }
} catch (error) { await activePage.screenshot({ path: 'artifacts/contacts/failure.png' }); console.log(JSON.stringify(trace)); console.log(await activePage.locator('body').innerText()); throw error; } finally { await browser.close(); }
