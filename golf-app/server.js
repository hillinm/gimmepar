const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) {
  console.error('❌ ERROR: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const db = require('./db/database');

if (isProd) app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── API routes FIRST before static files ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: !!process.env.DATABASE_URL, env: isProd ? 'production' : 'development' });
});

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
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    httpOnly: true
  }
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/league', require('./routes/league'));

// ── Static files and SPA catch-all AFTER API routes ──
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`⛳ GimmePar running on port ${PORT} [${isProd ? 'production' : 'development'}]`);
    console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✓ set' : '✗ MISSING'}`);
    console.log(`   SESSION_SECRET: ${process.env.SESSION_SECRET ? '✓ set' : '⚠ using default'}`);
  });
}).catch(err => {
  console.error('❌ Failed to connect to database:', err.message);
  process.exit(1);
});
