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

export default db;
