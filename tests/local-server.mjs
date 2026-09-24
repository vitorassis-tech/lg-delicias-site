// LOCAL ONLY: disposable database and no WhatsApp/provider credentials.
// This file is not a Pages Function and binds only to the loopback interface.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {testDB} from './d1-test-db.mjs';
import {setup} from '../server/order-core.js';
import * as orders from '../functions/api/orders.js';
import * as customer from '../functions/api/customer-order.js';
import * as products from '../functions/api/products.js';
const root=fileURLToPath(new URL('../',import.meta.url)),db=testDB();
export const env={DB:db.DB,ADMIN_KEY:'local-test-only'};
await setup(db.DB);
await products.onRequestGet({request:new Request('http://localhost/api/products'),env});
db.sqlite.exec('UPDATE products SET stock=30');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml'};
export const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  const mod={'/api/orders':orders,'/api/customer-order':customer,'/api/products':products}[url.pathname];
  if(mod){let body='';for await(const chunk of req)body+=chunk;const method=req.method,handler=mod['onRequest'+method[0]+method.slice(1).toLowerCase()];if(!handler){res.writeHead(405);return res.end()}
    const request=new Request(url,{method,headers:req.headers,...(body?{body}:{})}),response=await handler({request,env});res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(await response.text());
  }
  // Test-only controls, not shipped in functions/ and never used with live data.
  if(url.pathname==='/__test/stock'&&req.method==='POST'){const id=Number(url.searchParams.get('id')),stock=Number(url.searchParams.get('value'));db.sqlite.prepare('UPDATE products SET stock=? WHERE id=?').run(stock,id);res.writeHead(200);return res.end('{}')}
  if(url.pathname==='/__test/price'&&req.method==='POST'){const id=Number(url.searchParams.get('id')),price=Number(url.searchParams.get('value'));db.sqlite.prepare('UPDATE products SET price=? WHERE id=?').run(price,id);res.writeHead(200);return res.end('{}')}
  if(url.pathname==='/__test/reset'&&req.method==='POST'){db.sqlite.exec('DELETE FROM order_payments; DELETE FROM order_events; DELETE FROM order_additions; DELETE FROM order_items; DELETE FROM orders; UPDATE products SET stock=30; UPDATE products SET price=13 WHERE id=9;');res.writeHead(200);return res.end('{}')}
  const target=path.resolve(root,'.'+decodeURIComponent(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));
  if(!target.startsWith(root)||url.pathname.includes('..')){res.writeHead(403);return res.end()}
  const data=await fs.readFile(target);res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
}catch(e){res.writeHead(404);res.end('Not found')}});
if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(Number(process.env.LG_TEST_PORT||4173),'127.0.0.1',()=>console.log('Ambiente de testes: http://127.0.0.1:'+server.address().port));
