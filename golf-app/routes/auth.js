const express = require('express');
const bcrypt = require('bcryptjs');
const { getOne, query } = require('../db/database');
const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    const existing = await getOne('SELECT id FROM leagues WHERE name=$1', [name.trim()]);
    if (existing) return res.status(409).json({ error: 'League name already taken' });
    const hash = bcrypt.hashSync(password, 10);
    const result = await query('INSERT INTO leagues (name, password_hash) VALUES ($1,$2) RETURNING id', [name.trim(), hash]);
    req.session.leagueId = result.rows[0].id;
    req.session.leagueName = name.trim();
    res.json({ success: true, leagueName: name.trim() });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
    const league = await getOne('SELECT * FROM leagues WHERE name=$1', [name.trim()]);
    if (!league) return res.status(401).json({ error: 'League not found' });
    if (!bcrypt.compareSync(password, league.password_hash))
      return res.status(401).json({ error: 'Incorrect password' });
    req.session.leagueId = league.id;
    req.session.leagueName = league.name;
    res.json({ success: true, leagueName: league.name });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/me', async (req, res) => {
  if (!req.session.leagueId) return res.status(401).json({ error: 'Not logged in' });
  try {
    const league = await getOne(
      'SELECT id, name, course_name, course_location, front9par, back9par FROM leagues WHERE id=$1',
      [req.session.leagueId]
    );
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
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
