// Real frontend with mocked APIs: never creates real receivables/requests.
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
const reviewId = functionId('inter-charges.functions-', 'getInterChargeReview');
const prepareId = functionId('inter-charges.functions-', 'prepareInterCharge');
const receivable = {id:'e1000000-0000-0000-0000-000000000001',cliente_nome:'Cliente de teste',documento_referencia:'REC-TESTE',valor_original:1500,valor_aberto:1500,vencimento_em:'2026-10-15',status_cobranca:'a_faturar',billing_cycle_id:'cycle-test',competencia:'2026-09-01'};
const browser = await chromium.launch({channel:'msedge',headless:true});
mkdirSync('artifacts/inter-settings', {recursive:true});
try {
  for(const width of [1440,768,390]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors=[];let editable=true, fail=false, calls=0, requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const p=btoa(JSON.stringify({sub:'e2000000-0000-0000-0000-000000000001',email:'test@example.test',name:'Teste',tenant_id:'tenant-test',app:'apticket',exp:4102444800}));
      localStorage.setItem('apticket_session_token','test.'+p+'.mock');
    });
    await page.route('**/*',async route=>{
      const url=route.request().url();
      if(url.includes('/_serverFn/')) {
        if(url.includes(reviewId) && fail)return route.fulfill({json:{error:{message:'Falha de consulta simulada'},context:{}}});
        if(url.includes(prepareId)) {
          calls++;
          requests=[{id:'request-test',environment:'production',amount:1500,due_date:'2026-10-15',status:'blocked_homologation',created_at:'2026-09-09T12:00:00Z',deleted_at:null}];
          return route.fulfill({json:{result:{id:'request-test',reused:false},context:{}}});
        }
        const result=url.includes(permissionsId)?[{module:'financeiro',action:'view'},...(editable?[{module:'financeiro',action:'edit'}]:[])]:url.includes(reviewId)?{receivable,canPrepare:editable,requests}:[];
        return route.fulfill({json:{result,context:{}}});
      }
      if(url.includes('/rest/v1/contas_receber'))return route.fulfill({json:[receivable]});
      if(!url.startsWith('http://127.0.0.1:4173'))return route.fulfill({json:[]});
      return route.continue();
    });
    async function open(){await page.goto('http://127.0.0.1:4173/finance');await page.getByRole('button',{name:'Cobrança Inter',exact:true}).click();}
    await open();
    const dialog=page.getByRole('dialog');
    await dialog.getByText('Nenhuma solicitação neste ambiente.').waitFor();
    const submit=dialog.getByRole('button',{name:'Registrar preparação',exact:true});
    assert.equal(await submit.isDisabled(),true);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('tab',{name:'Produção / Oficial'}).click();
    assert.equal(await dialog.getByRole('checkbox').isChecked(),false);
    assert.equal(await submit.isDisabled(),true);
    await dialog.getByRole('checkbox').check();
    await submit.click();
    await dialog.getByText('Aguardando homologação',{exact:true}).waitFor();
    assert.equal(calls,1);
    assert.equal(await dialog.getByRole('button',{name:'Registrar preparação',exact:true}).count(),0);
    const bounds=await dialog.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width && bounds.y>=0 && bounds.y+bounds.height<=1001);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.screenshot({path:`artifacts/inter-settings/charge-review-${width}.png`});
    requests[0].amount=1600;
    await dialog.getByRole('button',{name:'Atualizar consulta'}).click();
    await dialog.getByText('O recebível mudou',{exact:false}).waitFor();
    await dialog.getByRole('button',{name:'Fechar',exact:true}).click();
    editable=false;
    await page.reload();await page.getByRole('button',{name:'Cobrança Inter',exact:true}).click();
    await dialog.getByText('Somente leitura.',{exact:false}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Registrar preparação',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    if(width===1440){
      fail=true;await page.reload();await page.getByRole('button',{name:'Cobrança Inter',exact:true}).click();
      await dialog.getByRole('button',{name:'Tentar novamente'}).waitFor({timeout:20000});
      fail=false;await dialog.getByRole('button',{name:'Tentar novamente'}).click();
      await dialog.getByText('Somente leitura.',{exact:false}).waitFor();
    }
    console.log(`PASS Inter preparation, confirmation, stale source, read-only, layout ${width}px`);
    await page.close();
  }
}finally{await browser.close();}
