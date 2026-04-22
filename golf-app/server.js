const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Check required env vars immediately ──
if (!process.env.DATABASE_URL) {
  console.error('❌ ERROR: DATABASE_URL environment variable is not set.');
  console.error('   Go to Render → your service → Environment → Add DATABASE_URL');
  console.error('   Value should be the Internal Database URL from your Render PostgreSQL instance.');
  process.exit(1);
}

const db = require('./db/database');

if (isProd) app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'gimmepar-secret-change-me',
  resave: false,
  saveUninitialized: false,
  proxy: isProd,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    httpOnly: true
  }
}));

// ── Health check endpoint ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: !!process.env.DATABASE_URL, env: isProd ? 'production' : 'development' });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/league', require('./routes/league'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Init DB then start server
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`⛳ GimmePar running on port ${PORT} [${isProd ? 'production' : 'development'}]`);
    console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✓ set' : '✗ MISSING'}`);
    console.log(`   SESSION_SECRET: ${process.env.SESSION_SECRET ? '✓ set' : '⚠ using default (change in production)'}`);
  });
}).catch(err => {
  console.error('❌ Failed to connect to database:', err.message);
  console.error('   Make sure DATABASE_URL is correct in your Render environment variables.');
  process.exit(1);
});
