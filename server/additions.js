import {Problem,assertOpen,quantityList,pricedItems,digest,guarded,orderGuard,additionGuard,inventoryGuard,stockStatements,insertItems,event,cents,snapshot,publicAddition,orderById} from './order-core.js';
const sum=items=>items.reduce((n,i)=>n+i.subtotalCents,0);
const changed=(a,b)=>a.some((i,n)=>i.productId!==b[n]?.productId||i.unitCents!==b[n]?.unitCents);
const conflict=()=>new Problem('O pedido, os preços ou o estoque mudaram. Atualize o resumo e tente novamente.',409,'CONFLICT');
async function find(db,order,id){const a=await db.prepare('SELECT * FROM order_additions WHERE id=? AND order_id=?').bind(String(id||''),order.id).first();if(!a)throw new Problem('Acréscimo não encontrado.',404);return a}
async function result(db,o,a,repeated=false){return {ok:true,repeated,addition:publicAddition(await find(db,o,a.id)),order:await snapshot(db,o.id)}}
export async function quoteAddition(db,o,body){
  const quantities=quantityList(body.items),key=String(body.clientKey||'');
  if(!/^[a-zA-Z0-9-]{24,80}$/.test(key))throw new Problem('Identificador de envio inválido.');
  const hash=await digest(JSON.stringify(quantities)),prior=await db.prepare('SELECT * FROM order_additions WHERE order_id=? AND client_key=?').bind(o.id,key).first();
  if(prior){if(prior.request_hash!==hash)throw new Problem('Identificador já usado para outros itens.',409,'IDEMPOTENCY');return result(db,o,prior,true)}
  assertOpen(o);const items=await pricedItems(db,quantities),id=crypto.randomUUID();
  try{await guarded(db,[orderGuard(o)],[db.prepare("INSERT INTO order_additions(id,order_id,client_key,request_hash,state,items_json,amount_cents) VALUES(?,?,?,?,'quoted',?,?)").bind(id,o.id,key,hash,JSON.stringify(items),sum(items))])}
  catch{const retry=await db.prepare('SELECT * FROM order_additions WHERE order_id=? AND client_key=?').bind(o.id,key).first();if(retry&&retry.request_hash===hash)return result(db,o,retry,true);throw conflict()}
  return result(db,o,{id});
}
async function reprice(db,o,a,items){
  try{await guarded(db,[orderGuard(o),additionGuard(a)],[
    db.prepare("UPDATE order_additions SET items_json=?,amount_cents=?,state='price_changed',reason='O preço mudou. Confirme o novo valor para continuar.',revision=revision+1,actor='Sistema',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(items),sum(items),a.id),
    db.prepare('UPDATE orders SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(o.id),
    event(db,o,'price_changed','Sistema',{...a,items_json:JSON.stringify(items),amount_cents:sum(items)},'Preço atualizado; aguardando aceite do cliente.')
  ])}catch{throw conflict()}
  throw new Problem('O preço dos adicionais mudou. Confira e aceite o novo valor.',409,'PRICE_CHANGED',await result(db,o,a));
}
async function apply(db,o,a,actor){
  const items=JSON.parse(a.items_json),after=cents(o.total)+a.amount_cents;
  try{await guarded(db,[orderGuard(o),additionGuard(a),inventoryGuard(items)],[
    ...stockStatements(db,items),...insertItems(db,o.id,items),
    db.prepare("UPDATE orders SET total=?,payment_status=CASE WHEN paid_amount_cents>=? THEN 'paid' ELSE 'pending' END,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(after/100,after,o.id),
    db.prepare("UPDATE order_additions SET state='applied',actor=?,reason='',total_before_cents=?,total_after_cents=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(actor,cents(o.total),after,a.id),
    event(db,o,'addition_applied',actor,a,'Itens acrescentados ao mesmo pedido.',after)
  ])}catch{const fresh=await find(db,o,a.id);if(fresh.state==='applied')return result(db,o,fresh,true);assertOpen(await orderById(db,o.id));await pricedItems(db,quantityList(items));throw conflict()}
  return result(db,o,a);
}
export async function submitAddition(db,o,body){
  const a=await find(db,o,body.additionId);
  if(['applied','pending'].includes(a.state))return result(db,o,a,true);
  if(a.state==='rejected')throw new Problem('Este acréscimo foi recusado. Faça uma nova seleção.',409,'REJECTED',await result(db,o,a));
  assertOpen(o);
  if(body.expectedOrderRevision!==undefined&&Number(body.expectedOrderRevision)!==o.revision)throw new Problem('O pedido foi atualizado. Confira novamente o resumo antes de confirmar.',409,'STALE_ORDER',await result(db,o,a));
  if(Number(body.expectedRevision)!==a.revision)throw new Problem('Confira a versão atualizada do acréscimo.',409,'STALE_QUOTE',await result(db,o,a));
  const old=JSON.parse(a.items_json),items=await pricedItems(db,quantityList(old),o.status==='new');
  if(changed(old,items))await reprice(db,o,a,items);
  if(o.status==='new')return apply(db,o,a,'Cliente');
  try{await guarded(db,[orderGuard(o),additionGuard(a)],[
    db.prepare("UPDATE order_additions SET state='pending',reason='',actor='Cliente',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(a.id),
    db.prepare('UPDATE orders SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(o.id),
    event(db,o,'addition_requested','Cliente',a,'Acréscimo aguardando aprovação; sem reserva de estoque.')
  ])}catch{const fresh=await find(db,o,a.id);if(['pending','applied'].includes(fresh.state))return result(db,o,fresh,true);throw conflict()}
  return result(db,o,a);
}
export async function decideAddition(db,o,body){
  const a=await find(db,o,body.additionId),approve=body.decision==='approve';
  if(!['approve','reject'].includes(body.decision))throw new Problem('Decisão inválida.');
  if(a.state===(approve?'applied':'rejected'))return result(db,o,a,true);
  assertOpen(o);
  if(approve&&a.state!=='pending')throw new Problem('Este acréscimo depende do aceite do cliente ou já foi decidido.',409,'NOT_PENDING',await result(db,o,a));
  if(!approve&&!['pending','price_changed'].includes(a.state))throw new Problem('Acréscimo já decidido.',409);
  if(Number(body.expectedRevision)!==a.revision)throw conflict();
  if(approve){const old=JSON.parse(a.items_json),items=await pricedItems(db,quantityList(old));if(changed(old,items))await reprice(db,o,a,items);return apply(db,o,a,'Administrador')}
  const reason=String(body.reason||'').trim().slice(0,240)||'Acréscimo recusado pela L&G Delícias.';
  try{await guarded(db,[orderGuard(o),additionGuard(a)],[
    db.prepare("UPDATE order_additions SET state='rejected',reason=?,actor='Administrador',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reason,a.id),
    db.prepare('UPDATE orders SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(o.id),
    event(db,o,'addition_rejected','Administrador',a,reason)
  ])}catch{throw conflict()}
  return result(db,o,a);
}
