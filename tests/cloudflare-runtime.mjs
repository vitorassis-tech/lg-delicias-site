// Actual local D1 binding provided by Miniflare/workerd; no cloud resources.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {setup,secret} from '../server/order-core.js';
import * as admin from '../functions/api/orders.js';
import * as customer from '../functions/api/customer-order.js';
const {Miniflare}=await (process.env.LG_MINIFLARE_MODULE?import(pathToFileURL(process.env.LG_MINIFLARE_MODULE)):import('miniflare'));
const mf=new Miniflare({modules:true,cf:false,script:'export default {fetch(){return new Response("local test")}}',d1Databases:['DB'],compatibilityDate:'2025-04-01'});
const timer=setTimeout(()=>{console.error('Timeout do runtime de teste.');process.exit(1)},45000);
try{
  const DB=await mf.getD1Database('DB'),env={DB,ADMIN_KEY:'local-test-only'};await setup(DB);
  await DB.prepare("INSERT INTO products(id,name,category,price,available,stock) VALUES(1,'Guaracamp 285 ml','Bebidas',2,1,30),(2,'Torta Salgada Grande','Tortas salgadas',13,1,30)").run();
  const call=async(mod,method,url,body,token)=>{const response=await mod['onRequest'+method[0]+method.slice(1).toLowerCase()]({request:new Request('http://localhost'+url,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{'x-admin-key':env.ADMIN_KEY})},...(body?{body:JSON.stringify(body)}:{})}),env});return {httpStatus:response.status,...await response.json()}};
  const create=()=>call(admin,'POST','/api/orders',{name:'Cliente fictício D1',sector:'Testes',items:[{productId:1,quantity:1},{productId:2,quantity:1}],accessToken:secret()});
  const quote=t=>call(customer,'POST','/api/customer-order?action=quote',{clientKey:crypto.randomUUID(),items:[{productId:2,quantity:1}]},t);
  const submit=(t,a)=>call(customer,'POST','/api/customer-order?action=submit',{additionId:a.id,expectedRevision:a.revision},t);
  const patch=(id,body)=>call(admin,'PATCH','/api/orders?id='+id,body);
  const first=await create();assert.equal(first.httpStatus,201);await patch(first.order.id,{paymentStatus:'paid'});
  const q=await quote(first.accessToken),s=await submit(first.accessToken,q.addition);assert.equal(s.order.total,28);assert.equal(s.order.paid_amount_cents,1500);assert.equal(s.order.balance_cents,1300);assert.equal(s.order.code,first.code);console.log('OK D1 real local — mesmo pedido, apenas diferença pendente');
  const replay=await submit(first.accessToken,q.addition);assert.equal(replay.order.total,28);assert.equal((await DB.prepare('SELECT stock FROM products WHERE id=2').first()).stock,28);console.log('OK D1 real local — idempotência de acréscimo');
  await patch(first.order.id,{status:'preparing'});const q2=await quote(first.accessToken),pending=await submit(first.accessToken,q2.addition);assert.equal(pending.order.total,28);assert.equal(pending.addition.state,'pending');
  const approved=await patch(first.order.id,{action:'addition',additionId:pending.addition.id,decision:'approve',expectedRevision:pending.addition.revision});assert.equal(approved.order.total,41);assert.equal(approved.order.balance_cents,2600);console.log('OK D1 real local — solicitação e aprovação');
  const other=await create();await patch(first.order.id,{status:'new'});await DB.prepare('UPDATE products SET stock=1 WHERE id=2').run();
  const qa=await quote(first.accessToken),qb=await quote(other.accessToken),race=await Promise.all([submit(first.accessToken,qa.addition),submit(other.accessToken,qb.addition)]);assert.equal(race.filter(r=>r.httpStatus===200).length,1);assert.equal((await DB.prepare('SELECT stock FROM products WHERE id=2').first()).stock,0);console.log('OK D1 real local — concorrência pela última unidade');
  const before=await DB.prepare('SELECT stock FROM products WHERE id=1').first();let rejected=false;
  try{await DB.batch([DB.prepare('UPDATE products SET stock=stock-1 WHERE id=1'),DB.prepare("INSERT INTO order_write_guards(id,valid) VALUES('test-rollback',0)")])}catch{rejected=true}
  assert.ok(rejected);assert.equal((await DB.prepare('SELECT stock FROM products WHERE id=1').first()).stock,before.stock);console.log('OK D1 real local — falha de CHECK desfaz toda a transação');
}finally{clearTimeout(timer);await mf.dispose()}
