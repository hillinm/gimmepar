const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) {
  console.error('❌ ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const db = require('./db/database');

if (isProd) app.set('trust proxy', 1);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: true });
  } catch(e) {
    res.json({ status: 'error', db: false, error: e.message });
  }
});

function setupSession(store) {
  app.use(session({
    store,
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

  app.use('/api/auth',  require('./routes/auth'));
  app.use('/api/league', require('./routes/league'));
  app.use('/api/admin', require('./routes/admin'));

  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  db.init().then(() => {
    app.listen(PORT, () => {
      console.log('⛳ GimmePar running on port ' + PORT + ' [' + (isProd ? 'production' : 'development') + ']');
    });
  }).catch(err => {
    console.error('❌ DB init failed:', err.message);
    process.exit(1);
  });
}

try {
  const pgSession = require('connect-pg-simple')(session);
  const pgStore = new pgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: true });
  pgStore.on('error', err => console.error('Session store error:', err.message));
  setupSession(pgStore);
} catch(e) {
  console.warn('pg session store failed, using memory:', e.message);
  setupSession(new session.MemoryStore());
}
