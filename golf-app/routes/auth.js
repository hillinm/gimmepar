const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const router = express.Router();

// Register a new league
router.post('/register', (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const existing = db.prepare('SELECT id FROM leagues WHERE name = ?').get(name.trim());
  if (existing) return res.status(409).json({ error: 'League name already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO leagues (name, password_hash) VALUES (?, ?)').run(name.trim(), hash);

  req.session.leagueId = result.lastInsertRowid;
  req.session.leagueName = name.trim();
  res.json({ success: true, leagueName: name.trim() });
});

// Login
router.post('/login', (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' });

  const league = db.prepare('SELECT * FROM leagues WHERE name = ?').get(name.trim());
  if (!league) return res.status(401).json({ error: 'League not found' });

  if (!bcrypt.compareSync(password, league.password_hash))
    return res.status(401).json({ error: 'Incorrect password' });

  req.session.leagueId = league.id;
  req.session.leagueName = league.name;
  res.json({ success: true, leagueName: league.name });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check session
router.get('/me', (req, res) => {
  if (!req.session.leagueId) return res.status(401).json({ error: 'Not logged in' });
  const league = db.prepare('SELECT id, name, course_name, course_location, front9par, back9par FROM leagues WHERE id = ?').get(req.session.leagueId);
  if (!league) return res.status(401).json({ error: 'League not found' });
  res.json({
    leagueId: league.id,
    leagueName: league.name,
    course: league.course_name ? {
      name: league.course_name,
      location: league.course_location,
      front9par: JSON.parse(league.front9par),
      back9par: JSON.parse(league.back9par)
    } : null
  });
});

module.exports = router;
