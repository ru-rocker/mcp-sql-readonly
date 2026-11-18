# mcp-sql-readonly

MCP server (stdio) untuk akses **read-only** ke **PostgreSQL** atau **Oracle**.
Database dipilih lewat env `DB_TYPE` (`postgres` default, atau `oracle`).

Tools:
- `query` — jalankan satu statement SQL read-only (maks `MAX_ROWS` baris, default 1000)
- `list_tables` — daftar tabel/view
- `describe_table` — kolom sebuah tabel

## File

- `index.js` — server MCP (stdio), koneksi dari env (lihat Setup)
- `test.mjs` — smoke test (`npm test`)
- `docker-compose.yml` + `seed.sql` — Postgres lokal dengan data contoh
- `seed-oracle.sql` — data contoh yang sama untuk Oracle (service `oracle` di docker-compose)
- `README.md` — dokumen ini

Server ditulis dalam JavaScript biasa (bukan TypeScript) supaya tidak perlu proses build.
Fitur tulis data dan transport HTTP sengaja tidak dibuat.

## Cara read-only dijaga

### PostgreSQL

- Setiap query dijalankan dalam `BEGIN TRANSACTION READ ONLY`, lalu selalu di-rollback.
- Beberapa perintah sekaligus ditolak, jadi trik seperti `COMMIT; DELETE ...` tidak lolos (dibuktikan di test).
- Batas waktu per query 30 detik (bisa diubah lewat `STATEMENT_TIMEOUT_MS`).
- Untuk perlindungan tambahan, sebaiknya `DATABASE_URL` memakai user database yang hanya punya hak `SELECT`:

```sql
CREATE ROLE mcp_reader LOGIN PASSWORD 'ganti_ini';
GRANT CONNECT ON DATABASE mydb TO mcp_reader;
GRANT USAGE ON SCHEMA public TO mcp_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_reader;
```

### Oracle

Di Oracle, perintah DDL (`DROP`, `CREATE`, `TRUNCATE`, ...) otomatis commit dan **lolos** dari
`SET TRANSACTION READ ONLY`. Karena itu penjagaannya:

- Hanya query yang diawali `SELECT` atau `WITH` yang diterima; `WITH FUNCTION/PROCEDURE` ditolak.
- Query dijalankan dalam `SET TRANSACTION READ ONLY`, lalu selalu di-rollback.
- Satu panggilan hanya bisa menjalankan satu statement, jadi `SELECT ...; DROP ...` gagal. Titik koma di akhir dibuang otomatis.
- Batas waktu per query sama (`STATEMENT_TIMEOUT_MS`).
- **Sangat disarankan** memakai user yang hanya punya hak `SELECT`, karena filter keyword tidak bisa melihat
  penulisan data yang tersembunyi di dalam fungsi PL/SQL yang sudah ada. Contoh (Oracle 23ai):

```sql
CREATE USER mcp_reader IDENTIFIED BY ganti_ini;
GRANT CREATE SESSION TO mcp_reader;
GRANT SELECT ANY TABLE ON SCHEMA app TO mcp_reader;  -- Oracle 19c: GRANT SELECT ON app.<tabel> per tabel
```

## Setup

```bash
npm install
```

Env:
- `DB_TYPE` (opsional): `postgres` (default) atau `oracle`
- PostgreSQL:
  - `DATABASE_URL` (wajib), mis. `postgres://user:pass@localhost:5432/mydb`
- Oracle (driver `oracledb` mode thin, **tidak** perlu Oracle Instant Client):
  - `ORACLE_USER` (wajib)
  - `ORACLE_PASSWORD` (wajib)
  - `ORACLE_CONNECT_STRING` (wajib), mis. `localhost:1521/FREEPDB1` (format `host:port/service_name`)
- `MAX_ROWS` (opsional, default 1000)
- `STATEMENT_TIMEOUT_MS` (opsional, default 30000)

Ganti `/ABSOLUTE/PATH/mcp-sql-readonly` di bawah dengan path folder ini.

## Claude Desktop

### 1. Daftarkan server

Buka Claude Desktop → **Settings → Developer → Edit Config**
(file `~/Library/Application Support/Claude/claude_desktop_config.json`), lalu isi:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "/PATH/LENGKAP/KE/node",
      "args": ["/ABSOLUTE/PATH/mcp-sql-readonly/index.js"],
      "env": { "DATABASE_URL": "postgres://postgres:postgres@localhost:5433/shop" }
    }
  }
}
```

- `command`: isi dengan hasil `which node`. Path lengkap wajib kalau Node dipasang lewat nvm,
  karena Claude Desktop tidak memuat nvm sehingga `node` saja tidak ditemukan.
- Kalau file sudah berisi server lain, cukup tambahkan blok `"postgres"` di dalam `mcpServers`.

Untuk **Oracle**, tambahkan server kedua dengan `DB_TYPE=oracle`. Postgres dan Oracle bisa aktif bersamaan:

```json
{
  "mcpServers": {
    "postgres": { "...": "seperti di atas" },
    "oracle": {
      "command": "/PATH/LENGKAP/KE/node",
      "args": ["/ABSOLUTE/PATH/mcp-sql-readonly/index.js"],
      "env": {
        "DB_TYPE": "oracle",
        "ORACLE_USER": "mcp_reader",
        "ORACLE_PASSWORD": "mcp_reader",
        "ORACLE_CONNECT_STRING": "localhost:1521/FREEPDB1"
      }
    }
  }
}
```

Log server Oracle ada di `~/Library/Logs/Claude/mcp-server-oracle.log`.

### 2. Restart penuh

Tutup dengan **Cmd+Q**, lalu buka lagi. Menutup jendelanya saja tidak cukup.

### 3. Cek server aktif

Di chat baru, klik ikon tools atau **"+" → Connectors** di kotak input.
Harus ada `postgres` dengan 3 tools: `query`, `list_tables`, `describe_table`.

Kalau ada error: lihat **Settings → Developer**, atau log lengkap di
`~/Library/Logs/Claude/mcp-server-postgres.log`.

### 4. Bertanya

Pastikan container Postgres jalan (`docker compose up -d`), lalu tanya dengan bahasa biasa, misalnya:

- "Di database postgres, tabel apa saja yang ada?"
- "Siapa customer dengan total belanja terbesar?"

Claude memutuskan sendiri kapan memanggil tool. Saat pertama kali muncul pop-up izin:
pilih **Allow once** atau **Always allow**. SQL yang dijalankan bisa dilihat dengan membuka blok tool call di chat.

Kalau Claude tidak memanggil tool, sebut sumber datanya dengan jelas, misalnya
"cek di database postgres ..." atau "pakai tool query ...".

## Gemini CLI

`~/.gemini/settings.json` (atau `.gemini/settings.json` di project):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/mcp-sql-readonly/index.js"],
      "env": { "DATABASE_URL": "postgres://user:pass@localhost:5432/mydb" }
    }
  }
}
```

Untuk Oracle di Gemini CLI, tambahkan blok `"oracle"` dengan `env` yang sama seperti contoh Claude Desktop.

## Tools AI lain

Client MCP lain (Cursor, Windsurf, Cline, VS Code, dll.) memakai format serupa: transport **stdio**, command `node`, args path ke `index.js`, env sesuai database (lihat Setup).

## Cara AI menghubungkan pertanyaan dengan tabel

Server ini **tidak** menerjemahkan pertanyaan ke SQL. Tool `query` hanya menerima SQL;
mengirim kalimat seperti "berapa ..." langsung ke `query` akan error `syntax error at or near "berapa"`.
Pertanyaan bahasa biasa diajukan ke AI client (Claude Desktop, Gemini CLI), dan AI-nya yang menulis SQL:

1. Memanggil `list_tables` → menebak tabel yang relevan dari namanya.
2. Memanggil `describe_table` → melihat kolom dan relasi (mis. `orders.customer_id` → `customers.id`).
3. Menyusun SQL lalu memanggil `query`.
4. Kalau error, membaca pesan error, memperbaiki SQL, dan mencoba lagi.

Jadi akurasinya bergantung pada **nama tabel dan kolom**. Nama yang samar (`tbl_x1`) atau istilah bisnis
khusus (mis. "omzet" = hanya order `paid`/`shipped`) bisa membuat AI salah tebak. Untuk membantu,
jelaskan istilah bisnis di prompt, atau tambahkan `COMMENT ON TABLE/COLUMN` di database.

## Tes di local: PostgreSQL (Docker)

`docker-compose.yml` menjalankan `postgres:16-alpine` di port **5433** (agar tidak bentrok dengan Postgres lain di 5432)
dan otomatis mengisi data contoh dari `seed.sql` (toko online: `customers`, `products`, `orders`, `order_items`).

### 1. Jalankan Postgres + data contoh

```bash
docker compose up -d
```

Cek datanya:

```bash
docker compose exec postgres psql -U postgres -d shop -c "SELECT * FROM customers"
```

> `seed.sql` hanya dijalankan saat container pertama kali dibuat. Untuk reset data:
> `docker compose down -v && docker compose up -d`

### 2. Smoke test otomatis

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/shop npm test
```

Output yang diharapkan: `all tests passed`. Test ini memastikan tools berfungsi, `DELETE` ditolak,
dan trik `COMMIT; DELETE ...` tidak bisa menembus mode read-only.

### 3. Coba manual lewat MCP Inspector (UI di browser)

```bash
npx @modelcontextprotocol/inspector -e DATABASE_URL=postgres://postgres:postgres@localhost:5433/shop node index.js
```

> Inspector tidak meneruskan env dari shell ke server, jadi `DATABASE_URL` wajib lewat flag `-e`
> (atau isi di panel **Environment Variables** di UI Inspector sebelum klik Connect).
> Kalau tidak, server keluar dengan `DATABASE_URL is not set`.

Buka URL yang muncul, klik **Connect** → tab **Tools** → pilih tool → **Run Tool**. Contoh input:

- `list_tables` — tanpa argumen
- `describe_table` — `table`: `orders`
- `query` — `sql`:
  ```sql
  SELECT c.name, sum(oi.qty * oi.unit_price) AS total
  FROM customers c
  JOIN orders o ON o.customer_id = c.id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY c.name ORDER BY total DESC
  ```
  Hasil: Budi Santoso 495000, Rudi Hartono 270000, Dewi Lestari 205000, Siti Aminah 195000.
- `query` — `sql`: `DELETE FROM customers` → harus error `cannot execute DELETE in a read-only transaction`.

### 4. Coba dari Claude Desktop / Gemini CLI

Pakai config di atas dengan `"DATABASE_URL": "postgres://postgres:postgres@localhost:5433/shop"`,
restart aplikasinya, lalu tanya misalnya:

- "Tabel apa saja yang ada di database?"
- "Siapa customer dengan total belanja terbesar (abaikan order cancelled)?"
- "Produk mana yang stoknya di bawah 30?"

### Matikan

```bash
docker compose down
```

## Tes di local: Oracle (Docker)

Service `oracle` memakai image `gvenzl/oracle-free:slim` (Oracle 23ai Free, sekitar 1-2 GB) di port **1521**.
Service ini punya profile `oracle`, jadi tidak ikut jalan di `docker compose up` biasa.
Saat pertama kali dibuat, `seed-oracle.sql` membuat schema `APP` berisi data contoh yang sama dengan Postgres,
plus user baca-saja `mcp_reader` (password `mcp_reader`).

### 1. Jalankan Oracle + data contoh

```bash
docker compose --profile oracle up -d oracle
```

Start pertama butuh sekitar 1-3 menit. Tunggu sampai log menampilkan `DATABASE IS READY TO USE!`:

```bash
docker compose logs -f oracle
```

Cek datanya:

```bash
docker compose exec oracle bash -c "echo 'SELECT name, city FROM app.customers;' | sqlplus -s mcp_reader/mcp_reader@localhost/FREEPDB1"
```

> Untuk reset data: `docker compose --profile oracle down -v && docker compose --profile oracle up -d oracle`

### 2. Smoke test otomatis

```bash
DB_TYPE=oracle ORACLE_USER=mcp_reader ORACLE_PASSWORD=mcp_reader ORACLE_CONNECT_STRING=localhost:1521/FREEPDB1 npm test
```

Output yang diharapkan: `all tests passed (oracle)`.

### 3. Coba manual lewat MCP Inspector

```bash
npx @modelcontextprotocol/inspector -e DB_TYPE=oracle -e ORACLE_USER=mcp_reader -e ORACLE_PASSWORD=mcp_reader -e ORACLE_CONNECT_STRING=localhost:1521/FREEPDB1 node index.js
```

Contoh `query` (tabel ada di schema `app`, jadi pakai prefix `app.`):

```sql
SELECT c.name, SUM(oi.qty * oi.unit_price) AS total
FROM app.customers c
JOIN app.orders o ON o.customer_id = c.id
JOIN app.order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY c.name ORDER BY total DESC
```

Hasilnya sama dengan Postgres. Nama kolom di hasil Oracle berhuruf besar (`NAME`, `TOTAL`).

### Matikan

```bash
docker compose --profile oracle down
```
