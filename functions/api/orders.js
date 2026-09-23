const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const auth=(request,env)=>env.ADMIN_KEY&&request.headers.get('x-admin-key')===env.ADMIN_KEY;
const clean=(value,max)=>String(value||'').trim().slice(0,max);
const money=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const orderStatuses=['new','preparing','ready','completed','cancelled'];
const paymentStatuses=['pending','paid'];
const paymentMethods=['later','pix','cash','card'];

async function ensureColumn(db,table,name,definition){const {results}=await db.prepare(`PRAGMA table_info(${table})`).all();if(results.some(column=>column.name===name))return;try{await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run()}catch(error){if(!String(error).toLowerCase().includes('duplicate column'))throw error}}
async function setup(db){
  await db.prepare('CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL,price REAL NOT NULL,available INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,customer_name TEXT NOT NULL,customer_sector TEXT NOT NULL,customer_phone TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'new',total REAL NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare('CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,product_name TEXT NOT NULL,unit_price REAL NOT NULL,quantity INTEGER NOT NULL,subtotal REAL NOT NULL,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE)')
  ]);
  await ensureColumn(db,'products','stock','INTEGER DEFAULT NULL');
  await ensureColumn(db,'products','low_stock_threshold','INTEGER NOT NULL DEFAULT 5');
  await ensureColumn(db,'orders','payment_status',"TEXT NOT NULL DEFAULT 'pending'");
  await ensureColumn(db,'orders','payment_method',"TEXT NOT NULL DEFAULT 'later'");
  await ensureColumn(db,'orders','paid_at','TEXT DEFAULT NULL');
  await ensureColumn(db,'orders','stock_reverted','INTEGER NOT NULL DEFAULT 0');
  await db.batch([
    db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)')
  ]);
}

function customerConfirmation(order){return `Olá, ${order.customer_name}! ✅ Seu pedido ${order.code} foi confirmado pela L&G Delícias. Total: ${money(order.total)}. Avisaremos quando estiver pronto para retirada.`}
async function sendTemplate(env,to,templateName,parameters){try{const response=await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{authorization:`Bearer ${env.WHATSAPP_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:templateName,language:{code:'pt_BR'},components:[{type:'body',parameters:parameters.map(text=>({type:'text',text:String(text)}))}]}})});return response.ok}catch{return false}}
async function notifyCustomer(env,order){const digits=String(order.customer_phone||'').replace(/\D/g,''),phone=digits?(digits.startsWith('55')?digits:'55'+digits):'';if(!phone)return {mode:'none',reason:'Cliente sem telefone cadastrado.'};const message=customerConfirmation(order);if(!env.WHATSAPP_TOKEN||!env.WHATSAPP_PHONE_NUMBER_ID||!env.WHATSAPP_TEMPLATE_NAME)return {mode:'manual',phone,message};const sent=await sendTemplate(env,phone,env.WHATSAPP_TEMPLATE_NAME,[order.customer_name,order.code,money(order.total)]);return sent?{mode:'automatic',sent:true}:{mode:'manual',phone,message,reason:'API do WhatsApp não aceitou o envio.'}}
async function notifyAdmin(env,order){const digits=String(env.WHATSAPP_ADMIN_PHONE||'').replace(/\D/g,''),phone=digits?(digits.startsWith('55')?digits:'55'+digits):'';if(!phone||!env.WHATSAPP_TOKEN||!env.WHATSAPP_PHONE_NUMBER_ID||!env.WHATSAPP_ADMIN_TEMPLATE_NAME)return {sent:false,mode:'browser'};const sent=await sendTemplate(env,phone,env.WHATSAPP_ADMIN_TEMPLATE_NAME,[order.code,order.customer_name,money(order.total)]);return {sent,mode:sent?'whatsapp':'browser'}}

async function getItems(db,orderIds){if(!orderIds.length)return [];const placeholders=orderIds.map(()=>'?').join(',');const {results}=await db.prepare(`SELECT order_id,product_id,product_name,unit_price,quantity,subtotal FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`).bind(...orderIds).all();return results}
function populateOrders(orders,items){const grouped=new Map();for(const item of items){if(!grouped.has(item.order_id))grouped.set(item.order_id,[]);grouped.get(item.order_id).push(item)}return orders.map(order=>({...order,items:grouped.get(order.id)||[]}))}

export async function onRequestPost({request,env}){
  try{
    await setup(env.DB);
    const body=await request.json(),name=clean(body.name,60),sector=clean(body.sector,60),phone=clean(body.phone,20),note=clean(body.note,180),paymentMethod=paymentMethods.includes(body.paymentMethod)?body.paymentMethod:'later';
    if(!name||!sector||!Array.isArray(body.items)||!body.items.length||body.items.length>40)return json({error:'Dados do pedido inválidos.'},400);
    const requested=new Map();
    for(const item of body.items){const id=Number(item.productId),quantity=Number(item.quantity);if(!Number.isInteger(id)||!Number.isInteger(quantity)||quantity<1||quantity>50)return json({error:'Item inválido no pedido.'},400);requested.set(id,(requested.get(id)||0)+quantity)}
    const ids=[...requested.keys()],placeholders=ids.map(()=>'?').join(','),{results:rows}=await env.DB.prepare(`SELECT id,name,price,available,stock FROM products WHERE id IN (${placeholders})`).bind(...ids).all(),products=new Map(rows.map(product=>[Number(product.id),product]));
    let total=0;const items=[];
    for(const [id,quantity] of requested){const product=products.get(id);if(!product||!product.available)return json({error:'Um produto do pedido está indisponível. Atualize o cardápio.'},409);if(product.stock!==null&&Number(product.stock)<quantity)return json({error:`Estoque insuficiente para ${product.name}. Restam ${product.stock} unidade(s).`},409);const subtotal=Number(product.price)*quantity;total+=subtotal;items.push({id,name:product.name,price:Number(product.price),quantity,subtotal})}
    const code='LG-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,4).toUpperCase(),stockValues=items.map(()=>'(?,?)').join(','),stockBindings=items.flatMap(item=>[item.id,item.quantity]);
    const statements=[env.DB.prepare(`WITH requested(id,qty) AS (VALUES ${stockValues}) INSERT INTO orders(code,customer_name,customer_sector,customer_phone,note,status,payment_status,payment_method,total) SELECT ?,?,?,?,?,'new','pending',?,? WHERE NOT EXISTS(SELECT 1 FROM requested r LEFT JOIN products p ON p.id=r.id WHERE p.id IS NULL OR p.available=0 OR (p.stock IS NOT NULL AND p.stock<r.qty))`).bind(...stockBindings,code,name,sector,phone,note,paymentMethod,total)];
    for(const item of items){statements.push(env.DB.prepare('UPDATE products SET stock=stock-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock IS NOT NULL').bind(item.quantity,item.id));statements.push(env.DB.prepare('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal) VALUES((SELECT id FROM orders WHERE code=?),?,?,?,?,?)').bind(code,item.id,item.name,item.price,item.quantity,item.subtotal))}
    try{await env.DB.batch(statements)}catch{return json({error:'O estoque mudou enquanto o pedido era finalizado. Atualize o cardápio e tente novamente.'},409)}
    const order=await env.DB.prepare('SELECT * FROM orders WHERE code=?').bind(code).first();
    const adminNotification=await notifyAdmin(env,order);
    return json({ok:true,code,total,adminNotification},201);
  }catch(error){return json({error:'Não foi possível registrar o pedido.',detail:String(error)},500)}
}

export async function onRequestGet({request,env}){
  if(!auth(request,env))return json({error:'Não autorizado'},401);
  try{
    await setup(env.DB);
    const params=new URL(request.url).searchParams,history=params.get('history')==='1',finance=params.get('finance')==='1',where=[],bindings=[];
    if(history||finance){const from=params.get('from'),to=params.get('to'),q=clean(params.get('q'),80),status=params.get('status'),payment=params.get('payment');if(from&&/^\d{4}-\d{2}-\d{2}$/.test(from)){where.push("date(created_at,'-3 hours')>=date(?)");bindings.push(from)}if(to&&/^\d{4}-\d{2}-\d{2}$/.test(to)){where.push("date(created_at,'-3 hours')<=date(?)");bindings.push(to)}if(q){where.push('(customer_name LIKE ? OR code LIKE ? OR customer_phone LIKE ?)');bindings.push('%'+q+'%','%'+q+'%','%'+q+'%')}if(orderStatuses.includes(status)){where.push('status=?');bindings.push(status)}if(paymentStatuses.includes(payment)){where.push('payment_status=?');bindings.push(payment)}}
    const clause=where.length?' WHERE '+where.join(' AND '):'',limit=history||finance?500:200,{results:orders}=await env.DB.prepare(`SELECT * FROM orders${clause} ORDER BY created_at DESC,id DESC LIMIT ${limit}`).bind(...bindings).all(),items=await getItems(env.DB,orders.map(order=>order.id)),populated=populateOrders(orders,items);
    if(!history&&!finance)return json(populated);
    const valid=orders.filter(order=>order.status!=='cancelled'),total=valid.reduce((sum,order)=>sum+Number(order.total),0),paid=valid.filter(order=>order.payment_status==='paid').reduce((sum,order)=>sum+Number(order.total),0),pending=valid.filter(order=>order.payment_status!=='paid').reduce((sum,order)=>sum+Number(order.total),0),customers=new Set(valid.map(order=>order.customer_name.trim().toLocaleLowerCase('pt-BR'))).size;
    return json({orders:populated,summary:{count:orders.length,revenue:total,average:valid.length?total/valid.length:0,paid,pending,customers}});
  }catch(error){return json({error:'Não foi possível carregar os pedidos.',detail:String(error)},500)}
}

export async function onRequestPatch({request,env}){
  if(!auth(request,env))return json({error:'Não autorizado'},401);
  try{
    await setup(env.DB);
    const id=Number(new URL(request.url).searchParams.get('id')),body=await request.json();if(!Number.isInteger(id)||id<1)return json({error:'Pedido inválido.'},400);
    const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();if(!order)return json({error:'Pedido não encontrado.'},404);
    const status=body.status===undefined?order.status:body.status,paymentStatus=body.paymentStatus===undefined?order.payment_status:body.paymentStatus,paymentMethod=body.paymentMethod===undefined?order.payment_method:body.paymentMethod;
    if(!orderStatuses.includes(status)||!paymentStatuses.includes(paymentStatus)||!paymentMethods.includes(paymentMethod))return json({error:'Dados inválidos.'},400);
    const items=await getItems(env.DB,[id]),statements=[];let stockReverted=Number(order.stock_reverted||0);
    if(status==='cancelled'&&order.status!=='cancelled'&&!stockReverted){for(const item of items)statements.push(env.DB.prepare('UPDATE products SET stock=stock+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock IS NOT NULL').bind(item.quantity,item.product_id));stockReverted=1}
    if(status!=='cancelled'&&order.status==='cancelled'&&stockReverted){for(const item of items){const product=await env.DB.prepare('SELECT name,available,stock FROM products WHERE id=?').bind(item.product_id).first();if(!product||!product.available||(product.stock!==null&&Number(product.stock)<Number(item.quantity)))return json({error:`Não há estoque para reabrir o pedido (${item.product_name}).`},409);statements.push(env.DB.prepare('UPDATE products SET stock=stock-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock IS NOT NULL').bind(item.quantity,item.product_id))}stockReverted=0}
    const paidAt=paymentStatus==='paid'?(order.paid_at||new Date().toISOString()):null;
    statements.push(env.DB.prepare('UPDATE orders SET status=?,payment_status=?,payment_method=?,paid_at=?,stock_reverted=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,paymentStatus,paymentMethod,paidAt,stockReverted,id));
    await env.DB.batch(statements);
    const notification=status==='preparing'&&order.status!=='preparing'?await notifyCustomer(env,order):{mode:'none'};
    return json({ok:true,notification});
  }catch(error){return json({error:'Não foi possível atualizar o pedido.',detail:String(error)},500)}
}

export async function onRequestDelete({request,env}){
  if(!auth(request,env))return json({error:'Não autorizado'},401);
  try{await setup(env.DB);const id=Number(new URL(request.url).searchParams.get('id'));if(!Number.isInteger(id)||id<1)return json({error:'Pedido inválido.'},400);const order=await env.DB.prepare('SELECT id,status,stock_reverted FROM orders WHERE id=?').bind(id).first();if(!order)return json({error:'Pedido não encontrado.'},404);const items=await getItems(env.DB,[id]),statements=[];if(order.status!=='cancelled'&&!Number(order.stock_reverted||0))for(const item of items)statements.push(env.DB.prepare('UPDATE products SET stock=stock+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock IS NOT NULL').bind(item.quantity,item.product_id));statements.push(env.DB.prepare('DELETE FROM order_items WHERE order_id=?').bind(id),env.DB.prepare('DELETE FROM orders WHERE id=?').bind(id));await env.DB.batch(statements);return json({ok:true})}catch(error){return json({error:'Não foi possível excluir o pedido.',detail:String(error)},500)}
}
