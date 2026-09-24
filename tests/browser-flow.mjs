// End-to-end tests use only the disposable loopback server in local-server.mjs.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {server} from './local-server.mjs';
const require=createRequire(import.meta.url);
let playwright;
try{playwright=await import('playwright')}catch{playwright=await import(pathToFileURL((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'')+'/playwright/index.mjs'))}
const {chromium}=playwright;
const browser=await chromium.launch({headless:true,...(process.env.LG_BROWSER_EXECUTABLE?{executablePath:process.env.LG_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--use-gl=angle','--use-angle=swiftshader']});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const screenshots=new URL('../validacao/',import.meta.url);await mkdir(screenshots,{recursive:true});
const errors=[],checks=[];
async function context(width=1440){const c=await browser.newContext({viewport:{width,height:1100}});await c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));return c}
async function site(c){const p=await c.newPage();await p.goto(origin,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.LGOrders&&document.querySelectorAll('#product-grid .card').length===35);await p.addStyleTag({content:'html{scroll-behavior:auto!important}.toast{visibility:hidden!important}'});return p}
async function add(p,id){await p.locator(`#product-grid [data-add="${id}"]`).click()}
async function create(p){await add(p,1);await add(p,9);await p.locator('#open-cart').click();await p.locator('#customer-name').fill('Cliente fictício');await p.locator('#customer-sector').fill('Testes locais');await p.locator('#customer-phone').fill('21900000000');await p.locator('#submit-order').click();await p.waitForSelector('#order-success:not([hidden])');return (await p.locator('#order-code').innerText()).trim()}
async function refreshClient(p){await p.locator('#refresh-tracking').click();await p.waitForFunction(()=>document.querySelector('#tracking-message').textContent==='Pedido atualizado agora.')}
async function addition(p,id=9){await p.locator('#track-addition').click();await p.waitForSelector('#addition-banner:not([hidden])');await add(p,id);await p.locator('#review-addition').click();await p.waitForSelector('#addition-review .order-amounts')}
async function confirmAddition(p){await p.locator('#confirm-addition').click();await p.waitForSelector('#addition-banner[hidden]',{state:'attached'})}
async function adminPage(){const c=await context();const p=await c.newPage();await p.goto(origin+'/admin/');await p.locator('#key').fill('local-test-only');await p.locator('#login-form button').click();await p.waitForSelector('#admin-area:not([hidden])');await p.waitForFunction(()=>typeof orderCard==='function'&&orders.length>0);return p}
async function adminRefresh(p){await p.evaluate(()=>loadOrders(true))}
async function list(){return fetch(origin+'/api/orders',{headers:{'x-admin-key':'local-test-only'}}).then(r=>r.json())}
async function stock(id,value){await fetch(origin+`/__test/stock?id=${id}&value=${value}`,{method:'POST'})}
async function overflow(p,label){const data=await p.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));assert.ok(data.document<=data.viewport+1,`${label}: overflow ${JSON.stringify(data)}`)}
async function shot(p,name){await p.waitForTimeout(300);await p.screenshot({path:new URL(name,screenshots).pathname,animations:'disabled'})}
try{
  const c=await context(),p=await site(c);const code=await create(p);
  await p.locator('#success-addition').click();await p.waitForSelector('#addition-banner:not([hidden])');await add(p,9);await p.locator('#review-addition').click();await p.waitForSelector('#addition-review .order-amounts');
  assert.match(await p.locator('#addition-review').innerText(),/28,00/);await overflow(p,'revisão desktop');await shot(p,'desktop-revisao-acrescimo.png');
  await p.evaluate(()=>{const b=document.querySelector('#confirm-addition');b.click();b.click()});await p.waitForSelector('#addition-banner[hidden]',{state:'attached'});
  let o=(await list())[0];assert.equal(o.code,code);assert.equal(o.total,28);assert.deepEqual(o.items.map(i=>i.quantity),[1,2]);checks.push('Exemplo completo + duplo clique no navegador');
  await p.reload();await p.waitForSelector('#track-addition');assert.match(await p.locator('#tracking-content').innerText(),new RegExp(code));
  const storage=await c.storageState();await p.close();const restored=await browser.newContext({storageState:storage,viewport:{width:390,height:844}});await restored.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const mobile=await site(restored);await mobile.waitForSelector('#track-addition');checks.push('Acesso privado e pedido preservados após atualizar/fechar a página');
  const admin=await adminPage();await admin.locator('[data-payment-id]').selectOption('paid');await admin.waitForFunction(()=>orders[0].payment_status==='paid');
  await admin.locator('[data-order-id]').selectOption('preparing');await admin.waitForFunction(()=>orders[0].status==='preparing');
  await refreshClient(mobile);await addition(mobile);assert.match(await mobile.locator('#addition-review').innerText(),/41,00/);await confirmAddition(mobile);
  o=(await list())[0];assert.equal(o.total,28);assert.equal(o.paid_amount_cents,2800);assert.equal(o.balance_cents,0);assert.equal(o.additions.at(-1).state,'pending');
  await mobile.locator('#meus-pedidos').scrollIntoViewIfNeeded();await overflow(mobile,'acompanhamento 390px');await mobile.locator('#toast').evaluate(e=>e.classList.remove('show'));await mobile.locator('#meus-pedidos').screenshot({path:new URL('celular-acrescimo-pendente.png',screenshots).pathname,animations:'disabled'});
  await adminRefresh(admin);await admin.waitForSelector('[data-addition-decision="approve"]');await overflow(admin,'central desktop');await admin.locator('#orders-list .order-card').screenshot({path:new URL('desktop-central-aprovacao.png',screenshots).pathname,animations:'disabled'});
  await admin.locator('[data-addition-decision="approve"]').click();await admin.waitForFunction(()=>orders[0].total===41);await refreshClient(mobile);
  o=(await list())[0];assert.equal(o.paid_amount_cents,2800);assert.equal(o.balance_cents,1300);checks.push('Pedido já pago: solicitação separada, aprovação e apenas diferença pendente');
  await addition(mobile,1);await confirmAddition(mobile);await adminRefresh(admin);admin.once('dialog',d=>d.accept('Produção encerrada para este acréscimo.'));await admin.locator('[data-addition-decision="reject"]').click();await admin.waitForFunction(()=>orders[0].additions.some(a=>a.reason==='Produção encerrada para este acréscimo.'));await refreshClient(mobile);assert.match(await mobile.locator('#tracking-content').innerText(),/Produção encerrada/);assert.equal((await list())[0].total,41);checks.push('Recusa na Central com motivo visível ao cliente, sem cobrança');
  await addition(mobile);await confirmAddition(mobile);await stock(9,0);await adminRefresh(admin);let stockError='';admin.once('dialog',async d=>{stockError=d.message();await d.accept()});await admin.locator('[data-addition-decision="approve"]').click();await admin.waitForFunction(()=>document.querySelector('[data-addition-decision="approve"]')?.disabled===false);assert.match(stockError,/Estoque insuficiente/);assert.equal((await list())[0].total,41);checks.push('Falta de estoque impede aprovação pela interface');
  await admin.locator('[data-order-id]').selectOption('ready');await admin.waitForFunction(()=>orders[0].status==='ready');await refreshClient(mobile);assert.equal(await mobile.locator('#track-addition').count(),0);assert.match(await mobile.locator('#tracking-content').innerText(),/não aceita mais acréscimos/);checks.push('Pedido pronto bloqueado no cliente e solicitações encerradas');
  await mobile.setViewportSize({width:320,height:740});await overflow(mobile,'acompanhamento 320px');await admin.setViewportSize({width:390,height:844});await overflow(admin,'central 390px');await admin.setViewportSize({width:320,height:740});await overflow(admin,'central 320px');checks.push('Sem rolagem horizontal em 320, 390 e 1440 pixels');
  await stock(9,30);
  // The server accepts the request, then the response is deliberately lost.
  const c2=await context(),retry=await site(c2);let dropped=false;
  await retry.route('**/api/orders',async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();return route.abort('connectionfailed')}return route.continue()});
  await add(retry,1);await retry.locator('#open-cart').click();await retry.locator('#customer-name').fill('Falha fictícia');await retry.locator('#customer-sector').fill('Teste de conexão');await retry.locator('#customer-phone').fill('21900000000');await retry.locator('#submit-order').click();await retry.waitForFunction(()=>document.querySelector('#submit-order').textContent.includes('Verificar'));
  assert.equal((await list()).length,2);await retry.reload();await retry.waitForFunction(()=>document.querySelector('#submit-order').textContent.includes('Verificar'));await retry.locator('#submit-order').click();await retry.waitForSelector('#order-success:not([hidden])');assert.equal((await list()).length,2);checks.push('Resposta perdida no pedido inicial + atualização não cria duplicata');
  await retry.locator('#success-track').click();await refreshClient(retry);await addition(retry);
  await retry.route('**/api/customer-order?action=submit',async route=>{await route.fetch();return route.abort('connectionfailed')});await retry.locator('#confirm-addition').click();await retry.waitForFunction(()=>document.querySelector('#confirm-addition').textContent.includes('Verificar'));await retry.reload();await retry.waitForSelector('#addition-banner[hidden]',{state:'attached'});await retry.waitForFunction(()=>document.querySelector('#tracking-content').textContent.includes('15,00'));o=(await list()).find(o=>o.customer_name==='Falha fictícia');assert.equal(o.total,15);assert.equal(o.additions.filter(a=>a.state==='applied').length,1);checks.push('Resposta perdida no acréscimo recuperada automaticamente, sem repetir baixa');
  await addition(retry);await fetch(origin+'/__test/price?id=9&value=14',{method:'POST'});await retry.unroute('**/api/customer-order?action=submit');await retry.locator('#confirm-addition').click();await retry.waitForFunction(()=>document.querySelector('#confirm-addition').textContent==='Aceitar novo valor e continuar');assert.equal((await list()).find(o=>o.customer_name==='Falha fictícia').total,15);assert.match(await retry.locator('#addition-review').innerText(),/29,00/);await confirmAddition(retry);assert.equal((await list()).find(o=>o.customer_name==='Falha fictícia').total,29);checks.push('Preço alterado exige botão de aceite e preserva itens com preço anterior');
  const access=await retry.evaluate(()=>JSON.parse(localStorage.getItem('lg-customer-orders-v24')).active);const privateContext=await context(390);const privatePage=await privateContext.newPage();await privatePage.goto(origin+'/#pedido='+access);await privatePage.waitForSelector('#track-addition');assert.equal(new URL(privatePage.url()).hash,'');assert.match(await privatePage.locator('#tracking-content').innerText(),/Falha fictícia/);await privatePage.reload();await privatePage.waitForSelector('#track-addition');checks.push('Link privado funciona em outro navegador e remove segredo da barra de endereço');
  assert.deepEqual(errors,[]);console.log(checks.map((s,i)=>`${i+1}. OK — ${s}`).join('\n'));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
