// Real application with isolated APIs; validates management flows without production writes.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const dir = "apps/web/.output/server/_ssr";
const source = readFileSync(`${dir}/${readdirSync(dir).find(f => f.startsWith("permissions.functions-"))}`, "utf8");
const permissionId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const operator = "fc300000-0000-4000-8000-000000000001";
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "4176", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "financial-category-management-fixture-secret" }, stdio: "ignore" });
let browser, active;
try {
  for (let i=0;i<100;i++) { try { if ((await fetch("http://127.0.0.1:4176")).ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  mkdirSync("artifacts/financial-synthetic", { recursive: true });
  for (const width of [1440,768,390]) {
    const errors=[], writes=[];
    let readOnly=false, failArchive=false;
    let rows=[
      {id:"root",code:"01",name:"Receitas",classification_type:"synthetic"},
      {id:"group",code:"01.01",name:"Serviços gerenciados",classification_type:"synthetic"},
      {id:"used",code:"01.01.0001",name:"Monitoramento NOC",classification_type:"analytic",description:"Mensalidades de monitoramento e operação dos clientes."},
      {id:"free",code:"01.01.0002",name:"Consultoria técnica",classification_type:"analytic",description:"Atendimentos técnicos avulsos."},
      {id:"inactive",code:"01.01.0003",name:"Serviço desativado",classification_type:"analytic",is_active:false},
    ].map(row=>({operating_company_id:operator,is_global:true,is_active:true,direction:"inflow",description:null,...row}));
    const page=await browser.newPage({viewport:{width,height:1000}}); active=page;
    page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript(()=>{const claims=btoa(JSON.stringify({sub:"fc200000-0000-4000-8000-000000000001",tenant_id:"fc100000-0000-4000-8000-000000000001",name:"Financeiro",email:"test@example.test",app:"apticket",exp:4102444800}));localStorage.setItem("apticket_session_token",`test.${claims}.mock`);});
    await page.route("**/*",async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname.includes("/_serverFn/")) return route.fulfill({json:{result:url.pathname.includes(permissionId)?["financeiro","financeiro_fluxo_caixa"].flatMap(module=>["view",...(readOnly?[]:["edit"])].map(action=>({module,action}))):[],context:{}}});
      if(url.pathname==="/rest/v1/operating_companies")return route.fulfill({json:[{id:operator,legal_name:"APTech Operadora",trade_name:null}]});
      if(url.pathname==="/rest/v1/financial_categories")return route.fulfill({json:rows});
      if(url.pathname==="/rest/v1/rpc/get_financial_category_dependencies"){
        const id=request.postDataJSON().p_id,target=rows.find(row=>row.id===id);
        if(!target)return route.fulfill({status:404,json:{message:"Categoria arquivada."}});
        const children=rows.filter(row=>row.code.startsWith(`${target.code}.`));
        return route.fulfill({json:{children:children.length,active_children:children.filter(row=>row.is_active).length,active_links:id==="used"?1:0,history_links:id==="used"?2:0}});
      }
      if(url.pathname==="/rest/v1/rpc/create_financial_category"){
        const value=request.postDataJSON();writes.push(value);
        rows.push({id:"new",operating_company_id:operator,code:"01.01.0005",name:value.p_name,description:value.p_description,direction:value.p_direction,is_global:value.p_is_global,is_active:value.p_is_active,classification_type:value.p_classification_type});
        return route.fulfill({json:"new"});
      }
      if(url.pathname==="/rest/v1/rpc/archive_financial_dimension"){
        if(failArchive)return route.fulfill({status:400,json:{message:"Falha simulada ao arquivar."}});
        const value=request.postDataJSON();writes.push(value);rows=rows.filter(row=>row.id!==value.p_id);return route.fulfill({json:true});
      }
      if(url.pathname==="/rest/v1/rpc/save_financial_category"){
        const value=request.postDataJSON();writes.push(value);const target=rows.find(row=>row.id===value.p_id);Object.assign(target,{name:value.p_name,description:value.p_description,is_active:value.p_is_active});return route.fulfill({json:target.id});
      }
      if(url.pathname.startsWith("/rest/v1/")||url.origin!=="http://127.0.0.1:4176")return route.fulfill({json:[]});
      return route.continue();
    });
    async function choose(trigger,label){await trigger.click();await page.getByRole("option",{name:label,exact:true}).click();await page.getByRole("dialog",{name:"Selecionar opção",exact:true}).waitFor({state:"hidden"});}
    async function open(){await page.goto("http://127.0.0.1:4176/finance/cash-flow");await choose(page.getByRole("combobox",{name:"Empresa operadora",exact:true}),"APTech Operadora");await page.getByRole("button",{name:"Classificações",exact:true}).click();}
    await open();
    const dialog=page.getByRole("dialog",{name:"Classificações financeiras",exact:true});
    const search=dialog.getByRole("textbox",{name:"Buscar categorias",exact:true});
    await search.fill("CONSULTORIA TECNICA");await dialog.getByText("Consultoria técnica",{exact:true}).waitFor();
    assert.equal(await dialog.getByText("Monitoramento NOC",{exact:true}).count(),0);
    assert.equal(await dialog.getByText("Receitas",{exact:true}).count(),1,"keeps ancestor context");
    await search.fill("termo inexistente");await dialog.getByText("Nenhum cadastro encontrado",{exact:true}).waitFor();
    await dialog.getByRole("button",{name:"Limpar filtros",exact:true}).click();
    await choose(dialog.getByRole("combobox",{name:"Situação",exact:true}),"Inativas");
    await dialog.getByText("Serviço desativado",{exact:true}).waitFor();assert.equal(await dialog.getByText("Consultoria técnica",{exact:true}).count(),0);
    await dialog.getByRole("button",{name:"Limpar filtros",exact:true}).click();
    await choose(dialog.getByRole("combobox",{name:"Natureza",exact:true}),"Somente saídas");await dialog.getByText("Nenhum cadastro encontrado",{exact:true}).waitFor();
    await dialog.getByRole("button",{name:"Limpar filtros",exact:true}).click();
    await dialog.getByRole("button",{name:"Recolher Receitas",exact:true}).click();
    await search.fill("monitoramento");await dialog.getByText("Monitoramento NOC",{exact:true}).waitFor();
    await dialog.getByRole("button",{name:"Limpar filtros",exact:true}).click();
    await dialog.getByRole("button",{name:"Expandir Receitas",exact:true}).click();
    await page.screenshot({path:`artifacts/financial-synthetic/category-list-${width}.png`,animations:"disabled"});
    await dialog.getByRole("button",{name:"Adicionar abaixo de Serviços gerenciados",exact:true}).click();
    assert.equal(await dialog.locator("#dimension-code").getAttribute("readonly"),"");
    assert.equal(await dialog.getByText("Natureza *",{exact:true}).locator("..").getByRole("combobox").innerText(),"Somente entradas");
    assert.equal(await dialog.getByText("Global *",{exact:true}).locator("..").getByRole("combobox").innerText(),"Sim");
    await dialog.locator("#dimension-name").fill("Segurança gerenciada");
    await dialog.locator("#dimension-description").fill("Receitas de serviços gerenciados de segurança.");
    await page.screenshot({path:`artifacts/financial-synthetic/category-parent-${width}.png`,animations:"disabled"});
    await dialog.getByRole("button",{name:"Salvar",exact:true}).click();
    await dialog.getByText("Segurança gerenciada",{exact:true}).waitFor();
    assert.equal(writes[0].p_parent_id,"group");assert.equal(writes[0].p_direction,"inflow");assert.equal(writes[0].p_is_global,true);assert.equal(writes[0].p_code,undefined);
    assert.equal(await dialog.getByText("01.01.0005",{exact:true}).count(),1,"uses actual server allocation");
    await dialog.getByRole("button",{name:"Arquivar Receitas",exact:true}).click();
    const confirm=page.getByRole("alertdialog");await confirm.getByText(/Operação bloqueada/).waitFor();
    assert.equal(await confirm.getByRole("button",{name:"Confirmar arquivamento",exact:true}).isDisabled(),true);
    await confirm.getByRole("button",{name:"Cancelar",exact:true}).click();await confirm.waitFor({state:"hidden"});
    await dialog.getByRole("button",{name:"Editar Monitoramento NOC",exact:true}).click();
    await dialog.getByText(/Sua estrutura está protegida/).waitFor();assert.equal(await dialog.locator("#dimension-name").isDisabled(),true);
    await dialog.locator("#dimension-description").fill("Novas orientações para classificação.");
    await dialog.getByRole("button",{name:"Salvar",exact:true}).click();await search.waitFor();
    await dialog.getByRole("switch",{name:"Desativar Monitoramento NOC",exact:true}).click();
    await confirm.getByText(/Operação bloqueada/).waitFor();assert.equal(await confirm.getByRole("button",{name:"Confirmar inativação",exact:true}).isDisabled(),true);
    await confirm.getByRole("button",{name:"Cancelar",exact:true}).click();await confirm.waitFor({state:"hidden"});
    await dialog.getByRole("button",{name:"Arquivar Consultoria técnica",exact:true}).click();
    await confirm.getByRole("button",{name:"Cancelar",exact:true}).click();await confirm.waitFor({state:"hidden"});assert.equal(rows.some(row=>row.id==="free"),true);
    await dialog.getByRole("button",{name:"Arquivar Consultoria técnica",exact:true}).click();failArchive=true;
    await confirm.getByRole("button",{name:"Confirmar arquivamento",exact:true}).click();await page.getByText(/Falha simulada ao arquivar/).waitFor();assert.equal(await confirm.isVisible(),true);
    failArchive=false;await confirm.getByRole("button",{name:"Confirmar arquivamento",exact:true}).click();await confirm.waitFor({state:"hidden"});
    await dialog.getByText("Consultoria técnica",{exact:true}).waitFor({state:"hidden"});
    await dialog.getByRole("button",{name:"Adicionar",exact:true}).click();await dialog.locator("#dimension-name").fill("Novo grupo");
    assert.equal(await dialog.getByRole("button",{name:"Salvar",exact:true}).isDisabled(),true,"root requires explicit nature");
    await choose(dialog.getByRole("combobox",{name:"Categoria pai",exact:true}),"01.01 · Serviços gerenciados");
    assert.equal(await dialog.getByRole("button",{name:"Salvar",exact:true}).isDisabled(),false);
    await dialog.getByRole("button",{name:"Cancelar",exact:true}).click();
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await dialog.getByRole("button",{name:"Fechar",exact:true}).click();await dialog.waitFor({state:"hidden"});
    readOnly=true;await open();await search.fill("monitoramento");await dialog.getByText("Monitoramento NOC",{exact:true}).waitFor();
    assert.equal(await dialog.getByRole("button",{name:"Adicionar",exact:true}).count(),0);assert.equal(await dialog.getByRole("switch").first().isDisabled(),true);
    assert.deepEqual(errors,[]);console.log(`PASS category search, filters, hierarchy context, parent inheritance, server code, dependency guards, description editing, confirmation/error/retry and readonly at ${width}px`);
    await page.close();
  }
}catch(error){if(active){console.error(await active.locator("body").innerText());await active.screenshot({path:"artifacts/financial-synthetic/category-management-failure.png"});}throw error;}
finally{await browser?.close();app.kill();}
