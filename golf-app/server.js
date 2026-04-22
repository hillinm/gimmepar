const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

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

app.use('/api/auth', require('./routes/auth'));
app.use('/api/league', require('./routes/league'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Init DB then start server
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`⛳ GimmePar running on http://localhost:${PORT} [${isProd ? 'production' : 'development'}]`);
  });
}).catch(err => {
  console.error('Failed to connect to database:', err.message);
  process.exit(1);
});
