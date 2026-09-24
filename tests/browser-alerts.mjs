import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {server} from './local-server.mjs';
let playwright;try{playwright=await import('playwright')}catch{playwright=await import(pathToFileURL(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/index.mjs'))}
const browser=await playwright.chromium.launch({headless:true,...(process.env.LG_BROWSER_EXECUTABLE?{executablePath:process.env.LG_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--use-gl=angle','--use-angle=swiftshader']});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const json=async(url,body,token)=>{const r=await fetch(origin+url,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});assert.ok(r.ok);return r.json()};
try{
  const created=await json('/api/orders',{name:'Teste de alerta',sector:'Local',items:[{productId:1,quantity:1}]});
  const c=await browser.newContext();await c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const p=await c.newPage();await p.goto(origin+'/admin/');await p.locator('#key').fill('local-test-only');await p.locator('#login-form button').click();await p.waitForSelector('#admin-area:not([hidden])');
  await p.locator('#enable-alerts').click();await p.waitForFunction(()=>audioContext?.state==='running');
  // Count oscillators to verify a new alert actually emits a sound signal.
  await p.evaluate(()=>{window.localSoundCount=0;const original=audioContext.createOscillator.bind(audioContext);audioContext.createOscillator=()=>{window.localSoundCount++;return original()}});
  await p.evaluate(()=>loadOrders(true));const quoted=await json('/api/customer-order?action=quote',{clientKey:crypto.randomUUID(),items:[{productId:9,quantity:1}]},created.accessToken);await json('/api/customer-order?action=submit',{additionId:quoted.addition.id,expectedRevision:quoted.addition.revision},created.accessToken);
  await p.evaluate(()=>loadOrders(true));await p.waitForSelector('#addition-alerts:not([hidden])');assert.match(await p.locator('#addition-notices').innerText(),/Adicionado: 1× Torta Salgada Grande/);assert.equal(await p.evaluate(()=>localSoundCount),1);await p.evaluate(()=>loadOrders(true));assert.equal(await p.evaluate(()=>localSoundCount),1);console.log('OK navegador — ativação de áudio, aviso visual exato e um único som por evento');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
