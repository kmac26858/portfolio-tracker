import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "portfolio.db");

const db = new Database(DB_PATH);

// WAL mode: better concurrent read performance; foreign keys enforced
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS portfolios (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    investor_names TEXT    NOT NULL DEFAULT '[]',
    positions      TEXT    NOT NULL DEFAULT '[]',
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Activities table — manual BUY/SELL log, independent of positions
db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action     TEXT    NOT NULL CHECK(action IN ('BUY','SELL')),
    ticker     TEXT    NOT NULL COLLATE NOCASE,
    shares     REAL    NOT NULL,
    price      REAL    NOT NULL,
    date       TEXT    NOT NULL,
    brokerage  TEXT    NOT NULL DEFAULT '',
    owner      TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Snapshots table — one row per user per Monday date
db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date     TEXT    NOT NULL,
    value    REAL    NOT NULL,
    PRIMARY KEY (user_id, date)
  );
`);

// Safe migrations — add new asset columns if they don't exist yet
const existingCols = db.pragma("table_info(portfolios)").map((c) => c.name);
for (const col of ["crypto", "cash", "house"]) {
  if (!existingCols.includes(col)) {
    db.exec(`ALTER TABLE portfolios ADD COLUMN ${col} TEXT NOT NULL DEFAULT '[]'`);
  }
}

export default db;
