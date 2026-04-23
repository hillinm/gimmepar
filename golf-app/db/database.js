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
        admin_email TEXT DEFAULT '',
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
        nine TEXT NOT NULL DEFAULT 'front',
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
        team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player',
        must_change_password BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rounds (
        id SERIAL PRIMARY KEY,
        league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        played_on DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS round_scores (
        id SERIAL PRIMARY KEY,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        nine TEXT NOT NULL DEFAULT 'front',
        handicap_used INTEGER DEFAULT 0,
        hole_scores TEXT NOT NULL DEFAULT '[]',
        gross INTEGER DEFAULT 0,
        net INTEGER DEFAULT 0
      );
    `);

    // Safe migrations
    await client.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS nine TEXT NOT NULL DEFAULT 'front'");
    await client.query("ALTER TABLE leagues ADD COLUMN IF NOT EXISTS admin_email TEXT DEFAULT ''");

    // Create super admin if not exists
    const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'mark.hillin@gmail.com';
    const adminPass  = process.env.SUPER_ADMIN_PASSWORD || 'GimmePar2026!';
    const bcrypt = require('bcryptjs');
    const existing = await client.query('SELECT id FROM users WHERE role=$1', ['superadmin']);
    if (existing.rows.length === 0) {
      const hash = bcrypt.hashSync(adminPass, 10);
      await client.query(
        "INSERT INTO users (first_name, last_name, email, password_hash, role, must_change_password, league_id) VALUES ($1,$2,$3,$4,$5,$6,NULL)",
        ['Super', 'Admin', adminEmail, hash, 'superadmin', false]
      );
      console.log('✓ Super admin created:', adminEmail);
    }

    console.log('✓ Database tables ready');
  } finally {
    client.release();
  }
}

async function query(text, params) { return pool.query(text, params); }
async function getOne(text, params) { const r = await pool.query(text, params); return r.rows[0] || null; }
async function getAll(text, params) { const r = await pool.query(text, params); return r.rows; }

module.exports = { pool, init, query, getOne, getAll };
