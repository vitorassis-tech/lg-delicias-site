CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL,price REAL NOT NULL,available INTEGER NOT NULL DEFAULT 1 CHECK(available IN(0,1)),stock INTEGER DEFAULT NULL CHECK(stock IS NULL OR stock>=0),low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK(low_stock_threshold>=0),description TEXT NOT NULL DEFAULT '',featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN(0,1)),featured_order INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,customer_name TEXT NOT NULL,customer_sector TEXT NOT NULL,customer_phone TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'new',payment_status TEXT NOT NULL DEFAULT 'pending',payment_method TEXT NOT NULL DEFAULT 'later',paid_at TEXT DEFAULT NULL,stock_reverted INTEGER NOT NULL DEFAULT 0,total REAL NOT NULL,paid_amount_cents INTEGER DEFAULT NULL,access_hash TEXT DEFAULT NULL,creation_hash TEXT DEFAULT NULL,revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,product_name TEXT NOT NULL,unit_price REAL NOT NULL,quantity INTEGER NOT NULL,subtotal REAL NOT NULL,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status);

-- v24: para bancos novos. Bancos existentes são migrados automaticamente pelo servidor.
CREATE TABLE IF NOT EXISTS order_additions (
  id TEXT PRIMARY KEY, order_id INTEGER NOT NULL, client_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('quoted','pending','price_changed','applied','rejected')),
  items_json TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  revision INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'Cliente', total_before_cents INTEGER, total_after_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id,client_key), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, addition_id TEXT,
  kind TEXT NOT NULL, actor TEXT NOT NULL, items_json TEXT NOT NULL DEFAULT '[]',
  amount_cents INTEGER NOT NULL DEFAULT 0, total_before_cents INTEGER, total_after_cents INTEGER,
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_payments (
  id TEXT PRIMARY KEY, order_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
  actor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_write_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1));
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_access ON orders(access_hash) WHERE access_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_additions_order ON order_additions(order_id,state);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id,id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
