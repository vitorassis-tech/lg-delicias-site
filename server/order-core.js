// Shared Cloudflare Pages order rules. D1 batch transactions protect stock and money.
export const statuses=['new','preparing','ready','completed','cancelled'];
export const methods=['later','pix','cash','card'];
export const openStates=['new','preparing'];
export const cents=value=>Math.round(Number(value)*100);
export const money=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const clean=(value,max)=>String(value??'').trim().slice(0,max);
export const auth=(request,env)=>Boolean(env.ADMIN_KEY&&request.headers.get('x-admin-key')===env.ADMIN_KEY);
export const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'}});
export class Problem extends Error{constructor(message,status=400,code='INVALID',data={}){super(message);Object.assign(this,{status,code,data})}}
export function failure(e){if(e instanceof Problem)return json({error:e.message,code:e.code,...e.data},e.status);console.error('Order operation failed',String(e));return json({error:'Não foi possível concluir. Tente novamente; o mesmo envio não será duplicado.',code:'RETRY'},500)}
export async function bodyOf(request){const text=await request.text();if(text.length>20000)throw new Problem('Solicitação muito grande.',413);try{const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw 0;return body}catch{throw new Problem('Dados inválidos.')}}
export function secret(){return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('')}
export const validSecret=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const initialized=new WeakMap();
async function column(db,table,name,definition){const {results}=await db.prepare(`PRAGMA table_info(${table})`).all();if(results.some(c=>c.name===name))return;try{await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run()}catch(e){if(!String(e).toLowerCase().includes('duplicate column'))throw e}}
export async function setup(db){if(!initialized.has(db))initialized.set(db,migrate(db).catch(e=>{initialized.delete(db);throw e}));return initialized.get(db)}
async function migrate(db){
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL,price REAL NOT NULL,available INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'),
    db.prepare("CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,customer_name TEXT NOT NULL,customer_sector TEXT NOT NULL,customer_phone TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'new',total REAL NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare('CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,product_name TEXT NOT NULL,unit_price REAL NOT NULL,quantity INTEGER NOT NULL,subtotal REAL NOT NULL,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE)')
  ]);
  for(const [table,name,definition] of [
    ['products','stock','INTEGER DEFAULT NULL'],['products','low_stock_threshold','INTEGER NOT NULL DEFAULT 5'],
    ['orders','payment_status',"TEXT NOT NULL DEFAULT 'pending'"],['orders','payment_method',"TEXT NOT NULL DEFAULT 'later'"],['orders','paid_at','TEXT DEFAULT NULL'],['orders','stock_reverted','INTEGER NOT NULL DEFAULT 0'],
    ['orders','paid_amount_cents','INTEGER DEFAULT NULL'],['orders','access_hash','TEXT DEFAULT NULL'],['orders','creation_hash','TEXT DEFAULT NULL'],['orders','revision','INTEGER NOT NULL DEFAULT 0']
  ])await column(db,table,name,definition);
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS order_additions(id TEXT PRIMARY KEY,order_id INTEGER NOT NULL,client_key TEXT NOT NULL,request_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('quoted','pending','price_changed','applied','rejected')),items_json TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),revision INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',actor TEXT NOT NULL DEFAULT 'Cliente',total_before_cents INTEGER,total_after_cents INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(order_id,client_key),FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE)"),
    db.prepare("CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,addition_id TEXT,kind TEXT NOT NULL,actor TEXT NOT NULL,items_json TEXT NOT NULL DEFAULT '[]',amount_cents INTEGER NOT NULL DEFAULT 0,total_before_cents INTEGER,total_after_cents INTEGER,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE)"),
    db.prepare('CREATE TABLE IF NOT EXISTS order_payments(id TEXT PRIMARY KEY,order_id INTEGER NOT NULL,amount_cents INTEGER NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE)'),
    db.prepare('CREATE TABLE IF NOT EXISTS order_write_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1))'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_access ON orders(access_hash) WHERE access_hash IS NOT NULL'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_additions_order ON order_additions(order_id,state)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id,id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name)'),
    db.prepare("UPDATE orders SET paid_amount_cents=CASE WHEN payment_status='paid' THEN CAST(ROUND(total*100) AS INTEGER) ELSE 0 END WHERE paid_amount_cents IS NULL"),
    db.prepare("INSERT OR IGNORE INTO order_payments(id,order_id,amount_cents,actor,created_at) SELECT 'opening:'||id,id,paid_amount_cents,'Migração do pagamento registrado',COALESCE(paid_at,created_at) FROM orders WHERE paid_amount_cents>0 AND NOT EXISTS(SELECT 1 FROM order_payments p WHERE p.order_id=orders.id)")
  ]);
}
// A failed CHECK rolls back the complete transaction, never leaving partial stock changes.
export function guarded(db,checks,statements){const ids=checks.map(()=>crypto.randomUUID());return db.batch([...checks.map(([condition,values=[]],i)=>db.prepare(`INSERT INTO order_write_guards(id,valid) VALUES(?,CASE WHEN (${condition}) THEN 1 ELSE 0 END)`).bind(ids[i],...values)),...statements,...ids.map(id=>db.prepare('DELETE FROM order_write_guards WHERE id=?').bind(id))])}
export const orderGuard=o=>['EXISTS(SELECT 1 FROM orders WHERE id=? AND revision=? AND status=?)',[o.id,o.revision,o.status]];
export const additionGuard=a=>['EXISTS(SELECT 1 FROM order_additions WHERE id=? AND revision=? AND state=?)',[a.id,a.revision,a.state]];
export function inventoryGuard(items,checkPrice=true){return [`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN products p ON p.id=json_extract(j.value,'$.productId') WHERE p.id IS NULL OR p.available<>1 OR (p.stock IS NOT NULL AND p.stock<json_extract(j.value,'$.quantity')) ${checkPrice?"OR CAST(ROUND(p.price*100) AS INTEGER)<>json_extract(j.value,'$.unitCents')":''})`,[JSON.stringify(items)]]}
export function quantityList(items){if(!Array.isArray(items)||!items.length||items.length>40)throw new Problem('Selecione de 1 a 40 produtos.');const quantities=new Map();for(const i of items){const id=Number(i.productId),q=Number(i.quantity);if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(q)||q<1||q>50)throw new Problem('Quantidade inválida.');quantities.set(id,(quantities.get(id)||0)+q);if(quantities.get(id)>50)throw new Problem('Limite de 50 unidades por produto.')}return [...quantities].sort((a,b)=>a[0]-b[0]).map(([productId,quantity])=>({productId,quantity}))}
export async function pricedItems(db,quantities,checkStock=true){const {results}=await db.prepare('SELECT id,name,price,available,stock FROM products WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(quantities.map(i=>i.productId))).all();return quantities.map(i=>{const p=results.find(p=>Number(p.id)===i.productId);if(!p||!p.available)throw new Problem(`${p?.name||'Produto'} indisponível.`,409,'UNAVAILABLE');if(checkStock&&p.stock!==null&&Number(p.stock)<i.quantity)throw new Problem(`Estoque insuficiente para ${p.name}. Restam ${p.stock} unidade(s).`,409,'STOCK');const unitCents=cents(p.price);if(!Number.isSafeInteger(unitCents)||unitCents<0)throw new Problem('Preço inválido.',409);return {...i,name:p.name,unitCents,subtotalCents:unitCents*i.quantity}})}
export const stockStatements=(db,items,direction=-1)=>items.map(i=>db.prepare('UPDATE products SET stock=stock+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock IS NOT NULL').bind(direction*i.quantity,i.productId));
export const insertItems=(db,orderId,items)=>items.map(i=>db.prepare('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal) VALUES(?,?,?,?,?,?)').bind(orderId,i.productId,i.name,i.unitCents/100,i.quantity,i.subtotalCents/100));
export const event=(db,o,kind,actor,a=null,note='',after=null)=>db.prepare('INSERT INTO order_events(order_id,addition_id,kind,actor,items_json,amount_cents,total_before_cents,total_after_cents,note) VALUES(?,?,?,?,?,?,?,?,?)').bind(o.id,a?.id??null,kind,actor,a?.items_json??'[]',a?.amount_cents??0,cents(o.total),after??cents(o.total),note);
export async function orderById(db,id){const o=await db.prepare('SELECT * FROM orders WHERE id=?').bind(Number(id)).first();if(!o)throw new Problem('Pedido não encontrado.',404,'NOT_FOUND');return o}
export async function customerOrder(request,db){const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');if(!validSecret(token))throw new Problem('Use o link privado do seu pedido.',401,'UNAUTHORIZED');const o=await db.prepare('SELECT * FROM orders WHERE access_hash=?').bind(await digest(token)).first();if(!o)throw new Problem('Link do pedido inválido ou desativado.',404,'NOT_FOUND');return o}
export function assertOpen(order){if(!openStates.includes(order.status))throw new Problem('Este pedido não aceita mais acréscimos. Faça um novo pedido.',409,'CLOSED')}
export function publicAddition({client_key,request_hash,items_json,...safe}){return {...safe,items:JSON.parse(items_json)}}
export async function hydrate(db,orders){if(!orders.length)return [];const ids=JSON.stringify(orders.map(o=>o.id));const [items,additions,events]=await Promise.all([
  db.prepare('SELECT order_id,product_id,product_name,unit_price,SUM(quantity) quantity,ROUND(SUM(subtotal),2) subtotal FROM order_items WHERE order_id IN (SELECT value FROM json_each(?)) GROUP BY order_id,product_id,unit_price,product_name ORDER BY MIN(id)').bind(ids).all(),
  db.prepare('SELECT * FROM order_additions WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY created_at,id').bind(ids).all(),
  db.prepare('SELECT * FROM order_events WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC').bind(ids).all()
]);return orders.map(({access_hash,creation_hash,...o})=>({...o,total_cents:cents(o.total),paid_amount_cents:Number(o.paid_amount_cents||0),balance_cents:Math.max(0,cents(o.total)-Number(o.paid_amount_cents||0)),items:items.results.filter(i=>i.order_id===o.id),additions:additions.results.filter(a=>a.order_id===o.id).map(publicAddition),events:events.results.filter(e=>e.order_id===o.id).map(({items_json,...e})=>({...e,items:JSON.parse(items_json)}))}))}
export async function snapshot(db,id){return (await hydrate(db,[await orderById(db,id)]))[0]}
