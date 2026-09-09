// Browser integration with mocked APIs only; no real financial data or bank calls.
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
const cycleId = functionId('billing-cycle.functions-', 'getBillingCycle');
const cycle = {
  id:'e1000000-0000-0000-0000-000000000001',contract_id:'contract-test',operating_company_id:'company-test',
  cycle_start:'2026-01-01',cycle_end:'2026-02-01',service_start:'2026-01-16',service_end:'2026-02-01',
  total_amount:102.86,due_date:'2026-02-10',created_at:'2026-02-01',
  items:[
    {id:'fixed',kind:'fixed',description:'Parcela fixa proporcional',period_start:'2026-01-16',period_end:'2026-02-01',quantity:16,unit_price:100,divisor:31,amount:51.61,value_version_id:'version-test',consumption_snapshot_id:null},
    {id:'variable',kind:'variable',description:'Consumo: devices',period_start:'2026-01-16',period_end:'2026-02-01',quantity:10,unit_price:5.125,divisor:1,amount:51.25,value_version_id:'version-test',consumption_snapshot_id:'snapshot-test'},
  ],
};
const common = {cliente_nome:'Cliente de teste',descricao:'Contrato de suporte',competencia:'2026-01-01',valor_aberto:102.86,valor_original:102.86,vencimento_em:'2026-02-10',status_cobranca:'a_faturar'};
const receivables = [
  {...common,id:'rec',billing_cycle_id:cycle.id,documento_referencia:'REC-TESTE',medicoes_contrato:null},
  {...common,id:'med',billing_cycle_id:null,documento_referencia:'MED-TESTE',medicoes_contrato:{report_token:'report-test'}},
];
const browser = await chromium.launch({channel:'msedge',headless:true});
mkdirSync('artifacts/inter-settings', {recursive:true});
try {
  for (const width of [1440,768,390]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors=[]; let fail=false;
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const p=btoa(JSON.stringify({sub:'e2000000-0000-0000-0000-000000000001',email:'test@example.test',name:'Teste',tenant_id:'tenant-test',app:'apticket',exp:4102444800}));
      localStorage.setItem('apticket_session_token','test.'+p+'.mock');
    });
    await page.route('**/*',async route=>{
      const url=route.request().url();
      if(url.includes('/_serverFn/')) {
        if(url.includes(cycleId) && fail) return route.fulfill({json:{error:{message:'Fatura não disponível ou sem permissão para esta empresa.'},context:{}}});
        const result=url.includes(permissionsId)?[{module:'financeiro',action:'view'}]:url.includes(cycleId)?cycle:[];
        return route.fulfill({json:{result,context:{}}});
      }
      if(url.includes('/rest/v1/contas_receber'))return route.fulfill({json:receivables});
      if(!url.startsWith('http://127.0.0.1:4173'))return route.fulfill({json:[]});
      return route.continue();
    });
    await page.goto('http://127.0.0.1:4173/finance');
    await page.getByRole('button',{name:'Detalhar fatura',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByText('2. Dispositivos',{exact:true}).waitFor();
    await dialog.getByText('16 dias atendidos',{exact:false}).waitFor();
    assert.ok((await dialog.innerText()).includes('31/01/2026'),'exclusive end shown as last included day');
    assert.ok((await dialog.innerText()).includes('5,125'),'unit precision retained');
    const bounds=await dialog.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width && bounds.y>=0 && bounds.y+bounds.height<=901);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.screenshot({path:`artifacts/inter-settings/cycle-${width}.png`});
    await dialog.getByRole('button',{name:'Fechar',exact:true}).click();
    await page.getByRole('combobox',{name:'Filtrar origem'}).click();
    await page.getByRole('option',{name:'Ciclos recorrentes',exact:true}).click();
    assert.equal(await page.getByText('MED-TESTE',{exact:true}).count(),0);
    assert.equal(await page.getByText('REC-TESTE',{exact:true}).count(),1);
    assert.deepEqual(errors,[]);
    if(width===1440){
      fail=true;await page.reload();
      await page.getByRole('button',{name:'Detalhar fatura',exact:true}).click();
      await page.getByRole('button',{name:'Tentar novamente',exact:true}).waitFor({timeout:20000});
      fail=false;await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
      await page.getByText('2. Dispositivos',{exact:true}).waitFor();
    }
    console.log(`PASS cycle detail, origin filter, responsive dialog ${width}px`);
    await page.close();
  }
}finally{await browser.close();}
