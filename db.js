const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'app.db'));

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
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
`);

// Migration: add referral columns if they don't exist (for existing databases)
try {
  db.exec(`ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN referred_by INTEGER`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN bonus_generations INTEGER DEFAULT 0`);
} catch (e) { /* column already exists */ }

module.exports = db;
