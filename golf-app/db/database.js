const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/golf.db');

// Ensure data directory exists
const fs = require('fs');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    course_name TEXT,
    course_location TEXT,
    front9par TEXT DEFAULT '[4,3,4,4,4,5,3,4,5]',
    back9par  TEXT DEFAULT '[4,3,4,4,4,5,3,4,5]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    player1 TEXT NOT NULL DEFAULT '',
    player2 TEXT NOT NULL DEFAULT '',
    handicap INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    played_on DATE NOT NULL DEFAULT (date('now')),
    notes TEXT,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS round_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    nine TEXT NOT NULL DEFAULT 'front',
    handicap_used INTEGER DEFAULT 0,
    hole_scores TEXT NOT NULL DEFAULT '[]',
    gross INTEGER DEFAULT 0,
    net INTEGER DEFAULT 0,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );
`);

module.exports = db;
