import {setup,json,auth,clean,money,statuses,methods,openStates,Problem,failure,bodyOf,secret,validSecret,digest,cents,quantityList,pricedItems,guarded,orderGuard,inventoryGuard,stockStatements,event,hydrate,snapshot,orderById} from './order-core.js';
import {decideAddition} from './additions.js';
import {notifyAdmin,notifyCustomer} from './notifications.js';
const concurrent=()=>new Problem('O pedido ou o estoque mudou. Atualize e tente novamente.',409,'CONFLICT');
export async function onRequestPost({request,env}){try{
  await setup(env.DB);
  const body=await bodyOf(request),name=clean(body.name,60),sector=clean(body.sector,60),phone=clean(body.phone,20),note=clean(body.note,180),paymentMethod=methods.includes(body.paymentMethod)?body.paymentMethod:'later';
  if(!name||!sector)throw new Problem('Preencha nome e setor.');
  const quantities=quantityList(body.items),token=body.accessToken===undefined?secret():body.accessToken;
  if(!validSecret(token))throw new Problem('Chave privada inválida.');
  const accessHash=await digest(token),creationHash=await digest(JSON.stringify({name,sector,phone,note,paymentMethod,quantities}));
  const repeat=async()=>{const prior=await env.DB.prepare('SELECT * FROM orders WHERE access_hash=?').bind(accessHash).first();if(!prior)return null;if(prior.creation_hash!==creationHash)throw new Problem('Este envio já criou um pedido. Abra o acompanhamento para adicionar itens.',409,'IDEMPOTENCY');return json({ok:true,repeated:true,code:prior.code,total:prior.total,accessToken:token,order:await snapshot(env.DB,prior.id)})};
  const prior=await repeat();if(prior)return prior;
  const items=await pricedItems(env.DB,quantities),amount=items.reduce((n,i)=>n+i.subtotalCents,0),code='LG-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
  const statements=[env.DB.prepare("INSERT INTO orders(code,customer_name,customer_sector,customer_phone,note,status,payment_status,payment_method,total,paid_amount_cents,access_hash,creation_hash) VALUES(?,?,?,?,?,'new','pending',?,?,0,?,?)").bind(code,name,sector,phone,note,paymentMethod,amount/100,accessHash,creationHash),...stockStatements(env.DB,items)];
  for(const i of items)statements.push(env.DB.prepare('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal) VALUES((SELECT id FROM orders WHERE code=?),?,?,?,?,?)').bind(code,i.productId,i.name,i.unitCents/100,i.quantity,i.subtotalCents/100));
  statements.push(env.DB.prepare("INSERT INTO order_events(order_id,kind,actor,items_json,amount_cents,total_before_cents,total_after_cents) VALUES((SELECT id FROM orders WHERE code=?),'created','Cliente',?,?,0,?)").bind(code,JSON.stringify(items),amount,amount));
  try{await guarded(env.DB,[inventoryGuard(items)],statements)}catch{const replay=await repeat();if(replay)return replay;await pricedItems(env.DB,quantities);throw concurrent()}
  const o=await env.DB.prepare('SELECT * FROM orders WHERE code=?').bind(code).first(),adminNotification=await notifyAdmin(env,o);
  return json({ok:true,code,total:amount/100,accessToken:token,order:await snapshot(env.DB,o.id),adminNotification},201);
}catch(e){return failure(e)}}
export async function onRequestGet({request,env}){
  if(!auth(request,env))return json({error:'Não autorizado'},401);
  try{await setup(env.DB);const params=new URL(request.url).searchParams,history=params.get('history')==='1',finance=params.get('finance')==='1',where=[],bindings=[];
    if(params.get('updates')==='1'){
      if(!params.has('after')){const row=await env.DB.prepare('SELECT COALESCE(MAX(id),0) cursor FROM order_events').first();return json({events:[],cursor:row.cursor})}
      const after=Number(params.get('after'));if(!Number.isSafeInteger(after)||after<0)throw new Problem('Marcador inválido.');
      const {results}=await env.DB.prepare('SELECT e.*,o.code,o.customer_name FROM order_events e JOIN orders o ON o.id=e.order_id WHERE e.id>? ORDER BY e.id LIMIT 200').bind(after).all();
      return json({events:results.map(({items_json,...e})=>({...e,items:JSON.parse(items_json)})),cursor:results.at(-1)?.id??after,more:results.length===200});
    }
    if(history||finance){for(const [param,operator] of [['from','>='],['to','<=']]){const date=params.get(param);if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)){where.push(`date(created_at,'-3 hours')${operator}date(?)`);bindings.push(date)}}const q=clean(params.get('q'),80),status=params.get('status'),payment=params.get('payment');if(q){where.push('(customer_name LIKE ? OR code LIKE ? OR customer_phone LIKE ?)');bindings.push('%'+q+'%','%'+q+'%','%'+q+'%')}if(statuses.includes(status)){where.push('status=?');bindings.push(status)}if(['pending','paid'].includes(payment)){where.push('payment_status=?');bindings.push(payment)}}
    const clause=where.length?' WHERE '+where.join(' AND '):'',limit=history||finance?500:200;
    const {results:orders}=await env.DB.prepare(`SELECT * FROM orders${clause} ORDER BY ${history||finance?'created_at':'updated_at'} DESC,id DESC LIMIT ${limit}`).bind(...bindings).all(),populated=await hydrate(env.DB,orders);
    if(!history&&!finance)return json(populated);
    const s=await env.DB.prepare(`SELECT COUNT(*) count,COALESCE(SUM(CASE WHEN status<>'cancelled' THEN CAST(ROUND(total*100) AS INTEGER) ELSE 0 END),0) total_cents,COALESCE(SUM(CASE WHEN status<>'cancelled' THEN paid_amount_cents ELSE 0 END),0) paid_cents,SUM(CASE WHEN status<>'cancelled' THEN 1 ELSE 0 END) valid_count,COUNT(DISTINCT CASE WHEN status<>'cancelled' THEN lower(trim(customer_name)) END) customers FROM orders${clause}`).bind(...bindings).first();
    return json({orders:populated,summary:{count:s.count,revenue:s.total_cents/100,average:s.valid_count?s.total_cents/100/s.valid_count:0,paid:s.paid_cents/100,pending:(s.total_cents-s.paid_cents)/100,customers:s.customers}});
  }catch(e){return failure(e)}
}
export async function onRequestPatch({request,env}){
  if(!auth(request,env))return json({error:'Não autorizado'},401);
  try{await setup(env.DB);const id=Number(new URL(request.url).searchParams.get('id')),body=await bodyOf(request);if(!Number.isSafeInteger(id)||id<1)throw new Problem('Pedido inválido.');const o=await orderById(env.DB,id);
    if(body.action==='addition')return json(await decideAddition(env.DB,o,body));
    if(body.action==='access'){const token=secret();try{await guarded(env.DB,[orderGuard(o)],[env.DB.prepare('UPDATE orders SET access_hash=?,revision=revision+1 WHERE id=?').bind(await digest(token),id),event(env.DB,o,'access_issued','Administrador',null,'Novo link privado emitido; links anteriores desativados.')])}catch{throw concurrent()}return json({ok:true,accessToken:token,code:o.code})}
    if(body.expectedRevision!==undefined&&Number(body.expectedRevision)!==o.revision)throw concurrent();
    const status=body.status??o.status,method=body.paymentMethod??o.payment_method;
    if(!statuses.includes(status)||!methods.includes(method)||(body.paymentStatus!==undefined&&!['paid','pending'].includes(body.paymentStatus)))throw new Problem('Dados inválidos.');
    const full=await snapshot(env.DB,id),checks=[orderGuard(o)],statements=[];let reverted=o.stock_reverted,paid=o.paid_amount_cents,paidAt=o.paid_at;
    const quantities=[...full.items.reduce((map,i)=>map.set(i.product_id,(map.get(i.product_id)||0)+i.quantity),new Map())].map(([productId,quantity])=>({productId,quantity}));
    if(status==='cancelled'&&o.status!=='cancelled'&&!reverted){statements.push(...stockStatements(env.DB,quantities,1));reverted=1}
    if(status!=='cancelled'&&o.status==='cancelled'&&reverted){checks.push(inventoryGuard(quantities,false));statements.push(...stockStatements(env.DB,quantities));reverted=0}
    if(body.paymentStatus==='paid'){paid=cents(o.total);paidAt=paidAt||new Date().toISOString()}
    if(body.paymentStatus==='pending'&&o.payment_status==='paid'){if(!body.resetPayment)throw new Problem('Confirme o estorno do pagamento antes de marcar como pendente.',409,'CONFIRM_REVERSAL');paid=0;paidAt=null}
    const paymentStatus=paid>=cents(o.total)?'paid':'pending';
    if(paid!==o.paid_amount_cents){statements.push(env.DB.prepare("INSERT INTO order_payments(id,order_id,amount_cents,actor) VALUES(?,?,?,'Administrador')").bind(crypto.randomUUID(),id,paid-o.paid_amount_cents),event(env.DB,o,'payment','Administrador',null,`${paid>o.paid_amount_cents?'Recebido':'Estornado'}: ${money(Math.abs(paid-o.paid_amount_cents)/100)}.`))}
    if(!openStates.includes(status)){const reason='O pedido ficou pronto ou foi encerrado. Faça um novo pedido para outros itens.';statements.push(env.DB.prepare("INSERT INTO order_events(order_id,addition_id,kind,actor,items_json,amount_cents,total_before_cents,total_after_cents,note) SELECT order_id,id,'addition_rejected','Administrador',items_json,amount_cents,?,?,? FROM order_additions WHERE order_id=? AND state IN ('pending','price_changed')").bind(cents(o.total),cents(o.total),reason,id),env.DB.prepare("UPDATE order_additions SET state='rejected',reason=?,actor='Administrador',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND state IN ('quoted','pending','price_changed')").bind(reason,id))}
    if(status!==o.status)statements.push(event(env.DB,o,'status','Administrador',null,`Status: ${o.status} → ${status}.`));
    statements.push(env.DB.prepare('UPDATE orders SET status=?,payment_status=?,payment_method=?,paid_at=?,paid_amount_cents=?,stock_reverted=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,paymentStatus,method,paidAt,paid,reverted,id));
    try{await guarded(env.DB,checks,statements)}catch{throw concurrent()}
    const updated=await orderById(env.DB,id),notification=status==='preparing'&&o.status!=='preparing'?await notifyCustomer(env,updated):{mode:'none'};
    return json({ok:true,notification,order:await snapshot(env.DB,id)});
  }catch(e){return failure(e)}
}
export async function onRequestDelete({request,env}){
  if(!auth(request,env))return json({error:'Não autorizado'},401);
  try{await setup(env.DB);const id=Number(new URL(request.url).searchParams.get('id'));if(!Number.isSafeInteger(id)||id<1)throw new Problem('Pedido inválido.');const o=await orderById(env.DB,id),full=await snapshot(env.DB,id),statements=[];
    if(o.status!=='cancelled'&&!o.stock_reverted)statements.push(...stockStatements(env.DB,full.items.map(i=>({productId:i.product_id,quantity:i.quantity})),1));
    for(const table of ['order_payments','order_events','order_additions','order_items'])statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE order_id=?`).bind(id));
    statements.push(env.DB.prepare('DELETE FROM orders WHERE id=?').bind(id));try{await guarded(env.DB,[orderGuard(o)],statements)}catch{throw concurrent()}return json({ok:true});
  }catch(e){return failure(e)}
}
