const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Ensure data dir
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Trust Render's proxy so secure cookies work over HTTPS
if (isProd) app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions stored in SQLite
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'gimmepar-secret-change-me',
  resave: false,
  saveUninitialized: false,
  proxy: isProd,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: isProd,       // HTTPS only in production
    sameSite: isProd ? 'none' : 'lax',  // 'none' needed for cross-origin on Render
    httpOnly: true
  }
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/league', require('./routes/league'));

// Serve the SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`⛳ GimmePar running on http://localhost:${PORT} [${isProd ? 'production' : 'development'}]`);
});
