-- Sample data: toko online sederhana
CREATE TABLE customers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  city text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  stock int NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  customer_id int NOT NULL REFERENCES customers(id),
  status text NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled')),
  ordered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id int NOT NULL REFERENCES orders(id),
  product_id int NOT NULL REFERENCES products(id),
  qty int NOT NULL CHECK (qty > 0),
  unit_price numeric(12,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

INSERT INTO customers (name, email, city, created_at) VALUES
  ('Budi Santoso',  'budi@example.com',  'Jakarta',   '2026-01-05'),
  ('Siti Aminah',   'siti@example.com',  'Bandung',   '2026-02-11'),
  ('Andi Wijaya',   'andi@example.com',  'Surabaya',  '2026-03-20'),
  ('Dewi Lestari',  'dewi@example.com',  'Yogyakarta','2026-04-02'),
  ('Rudi Hartono',  'rudi@example.com',  'Medan',     '2026-05-15');

INSERT INTO products (name, category, price, stock) VALUES
  ('Kopi Arabika 250g',   'Minuman',    85000, 40),
  ('Teh Hijau 100g',      'Minuman',    45000, 60),
  ('Keripik Singkong',    'Makanan',    15000, 200),
  ('Sambal Bawang',       'Makanan',    30000, 80),
  ('Tumbler Stainless',   'Peralatan', 120000, 25),
  ('French Press 600ml',  'Peralatan', 250000, 10);

INSERT INTO orders (customer_id, status, ordered_at) VALUES
  (1, 'paid',      '2026-06-01'),
  (1, 'shipped',   '2026-07-12'),
  (2, 'paid',      '2026-07-15'),
  (3, 'cancelled', '2026-08-03'),
  (4, 'pending',   '2026-09-09'),
  (5, 'shipped',   '2026-10-21');

INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES
  (1, 1, 2,  85000), (1, 3, 5,  15000),
  (2, 6, 1, 250000),
  (3, 2, 3,  45000), (3, 4, 2,  30000),
  (4, 5, 1, 120000),
  (5, 1, 1,  85000), (5, 5, 1, 120000),
  (6, 3, 10, 15000), (6, 4, 4,  30000);
