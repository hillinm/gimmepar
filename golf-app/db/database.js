const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS leagues (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        course_name TEXT,
        course_location TEXT,
        front9par TEXT DEFAULT '[4,3,4,4,4,5,3,4,5]',
        back9par  TEXT DEFAULT '[4,3,4,4,4,5,3,4,5]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        player1 TEXT NOT NULL DEFAULT '',
        player2 TEXT NOT NULL DEFAULT '',
        handicap INTEGER NOT NULL DEFAULT 0,
        nine TEXT NOT NULL DEFAULT 'front' CHECK (nine IN ('front','back','all18')),
        sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rounds (
        id SERIAL PRIMARY KEY,
        league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        played_on DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS saved_courses (
        id SERIAL PRIMARY KEY,
        league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        location TEXT DEFAULT '',
        front9par TEXT DEFAULT '[4,3,4,4,4,5,3,4,5]',
        back9par  TEXT DEFAULT '[4,3,4,4,4,5,3,4,5]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS round_scores (
        id SERIAL PRIMARY KEY,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        nine TEXT NOT NULL DEFAULT 'front' CHECK (nine IN ('front','back','all18')),
        handicap_used INTEGER DEFAULT 0,
        hole_scores TEXT NOT NULL DEFAULT '[]',
        gross INTEGER DEFAULT 0,
        net INTEGER DEFAULT 0
      );
    `);
    // Migrate existing tables — safe to run every time
    await client.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS player3 TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS player4 TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT '2man'");
    console.log('✓ Database tables ready');
  } finally {
    client.release();
  }
}

async function query(text, params) {
  return pool.query(text, params);
}
async function getOne(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}
async function getAll(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

module.exports = { pool, init, query, getOne, getAll };
