const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
let sqliteDb = null;
let isPostgres = false;

if (DATABASE_URL) {
  // PostgreSQL mode
  const { Pool } = require('pg');
  isPostgres = true;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  });
} else {
  // SQLite fallback for local development
  const Database = require('better-sqlite3');
  sqliteDb = new Database(path.join(__dirname, 'app.db'));
  sqliteDb.pragma('journal_mode = WAL');
}

// --- Helper: convert ? placeholders to $1, $2, ... (only used internally for SQLite compat) ---
// The public API expects $1, $2 style params for Postgres.
// For SQLite, we convert $1, $2 back to ? placeholders.
function pgToSqliteSQL(sql) {
  let i = 0;
  return sql.replace(/\$\d+/g, () => '?');
}

// --- PostgreSQL helpers ---

async function pgRun(sql, ...params) {
  // Auto-add RETURNING id for INSERT statements that don't already have RETURNING
  let querySql = sql;
  if (/^\s*INSERT\s/i.test(sql) && !/RETURNING/i.test(sql)) {
    querySql = sql.replace(/;?\s*$/, ' RETURNING id');
  }
  const result = await pool.query(querySql, params);
  return {
    changes: result.rowCount,
    lastID: result.rows && result.rows[0] ? result.rows[0].id : null,
  };
}

async function pgGet(sql, ...params) {
  const result = await pool.query(sql, params);
  return result.rows[0] || undefined;
}

async function pgAll(sql, ...params) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function pgExec(sql) {
  await pool.query(sql);
}

// --- SQLite helpers (async wrappers around sync API) ---

async function sqliteRun(sql, ...params) {
  // Strip RETURNING clause which SQLite doesn't support
  let convertedSql = pgToSqliteSQL(sql);
  convertedSql = convertedSql.replace(/\s+RETURNING\s+\w+/gi, '');
  const result = sqliteDb.prepare(convertedSql).run(...params);
  return {
    changes: result.changes,
    lastID: result.lastInsertRowid,
  };
}

async function sqliteGet(sql, ...params) {
  const convertedSql = pgToSqliteSQL(sql);
  return sqliteDb.prepare(convertedSql).get(...params) || undefined;
}

async function sqliteAll(sql, ...params) {
  const convertedSql = pgToSqliteSQL(sql);
  return sqliteDb.prepare(convertedSql).all(...params);
}

async function sqliteExec(sql) {
  sqliteDb.exec(sql);
}

// --- Table creation ---

const PG_TABLES = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    generations_used INTEGER DEFAULT 0,
    generations_limit INTEGER DEFAULT 5,
    referral_code TEXT UNIQUE,
    referred_by INTEGER,
    bonus_generations INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS generations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS blog_posts (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    meta_description TEXT,
    keywords TEXT,
    published INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS email_subscribers (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    subscribed_at TIMESTAMP DEFAULT NOW(),
    last_email_sent TIMESTAMP,
    emails_sent_count INTEGER DEFAULT 0,
    converted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS marketing_queue (
    id SERIAL PRIMARY KEY,
    platform TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content TEXT NOT NULL,
    blog_post_id INTEGER,
    status TEXT DEFAULT 'pending',
    parent_id INTEGER,
    scheduled_for TIMESTAMP,
    posted_at TIMESTAMP,
    external_id TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS marketing_videos (
    id SERIAL PRIMARY KEY,
    template TEXT NOT NULL,
    title TEXT NOT NULL,
    script TEXT,
    filename TEXT,
    duration_seconds INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
  );
`;

const SQLITE_TABLES = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    generations_used INTEGER DEFAULT 0,
    generations_limit INTEGER DEFAULT 5,
    referral_code TEXT UNIQUE,
    referred_by INTEGER,
    bonus_generations INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS blog_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    meta_description TEXT,
    keywords TEXT,
    published INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS email_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_email_sent DATETIME,
    emails_sent_count INTEGER DEFAULT 0,
    converted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS marketing_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content TEXT NOT NULL,
    blog_post_id INTEGER,
    status TEXT DEFAULT 'pending',
    parent_id INTEGER,
    scheduled_for DATETIME,
    posted_at DATETIME,
    external_id TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS marketing_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template TEXT NOT NULL,
    title TEXT NOT NULL,
    script TEXT,
    filename TEXT,
    duration_seconds INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

async function initTables() {
  if (isPostgres) {
    await pool.query(PG_TABLES);
    // Migration: add referral columns if they don't exist
    const cols = ['referral_code TEXT UNIQUE', 'referred_by INTEGER', 'bonus_generations INTEGER DEFAULT 0'];
    for (const col of cols) {
      const colName = col.split(' ')[0];
      try {
        await pool.query(`ALTER TABLE users ADD COLUMN ${col}`);
      } catch (e) {
        // column already exists — ignore
      }
    }
  } else {
    sqliteDb.exec(SQLITE_TABLES);
    // Migration: add referral columns if they don't exist
    try { sqliteDb.exec('ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE'); } catch (e) { /* exists */ }
    try { sqliteDb.exec('ALTER TABLE users ADD COLUMN referred_by INTEGER'); } catch (e) { /* exists */ }
    try { sqliteDb.exec('ALTER TABLE users ADD COLUMN bonus_generations INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
  }
}

// --- Public API ---

const db = {
  run: isPostgres ? pgRun : sqliteRun,
  get: isPostgres ? pgGet : sqliteGet,
  all: isPostgres ? pgAll : sqliteAll,
  exec: isPostgres ? pgExec : sqliteExec,
  initTables,
  isPostgres,
};

module.exports = db;
