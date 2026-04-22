const express = require('express');
const bcrypt = require('bcryptjs');
const { getOne, query } = require('../db/database');
const router = express.Router();

function sendError(res, status, msg) {
  console.error('Auth error:', msg);
  return res.status(status).json({ error: msg });
}

router.post('/register', async (req, res) => {
  try {
    const { name, password } = req.body || {};
    if (!name || !password) return sendError(res, 400, 'Name and password required');
    if (String(password).length < 4) return sendError(res, 400, 'Password must be at least 4 characters');
    const existing = await getOne('SELECT id FROM leagues WHERE name=$1', [String(name).trim()]);
    if (existing) return sendError(res, 409, 'League name already taken — try a different name');
    const hash = bcrypt.hashSync(String(password), 10);
    const result = await query('INSERT INTO leagues (name, password_hash) VALUES ($1,$2) RETURNING id', [String(name).trim(), hash]);
    req.session.leagueId = result.rows[0].id;
    req.session.leagueName = String(name).trim();
    req.session.save(err => {
      if (err) return sendError(res, 500, 'Session save failed: ' + err.message);
      res.json({ success: true, leagueName: String(name).trim() });
    });
  } catch(e) { console.error(e); sendError(res, 500, 'Server error: ' + e.message); }
});

router.post('/login', async (req, res) => {
  try {
    const { name, password } = req.body || {};
    if (!name || !password) return sendError(res, 400, 'Name and password required');
    const league = await getOne('SELECT * FROM leagues WHERE name=$1', [String(name).trim()]);
    if (!league) return sendError(res, 401, 'League not found — check the name or create a new league');
    if (!bcrypt.compareSync(String(password), league.password_hash)) return sendError(res, 401, 'Incorrect password');
    req.session.leagueId = league.id;
    req.session.leagueName = league.name;
    req.session.save(err => {
      if (err) return sendError(res, 500, 'Session save failed: ' + err.message);
      res.json({ success: true, leagueName: league.name });
    });
  } catch(e) { console.error(e); sendError(res, 500, 'Server error: ' + e.message); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/me', async (req, res) => {
  if (!req.session.leagueId) return res.status(401).json({ error: 'Not logged in' });
  try {
    const league = await getOne('SELECT id, name, course_name, course_location, front9par, back9par FROM leagues WHERE id=$1', [req.session.leagueId]);
    if (!league) return res.status(401).json({ error: 'League not found' });
    res.json({
      leagueId: league.id,
      leagueName: league.name,
      course: league.course_name ? {
        name: league.course_name,
        location: league.course_location,
        front9par: JSON.parse(league.front9par || '[4,3,4,4,4,5,3,4,5]'),
        back9par:  JSON.parse(league.back9par  || '[4,3,4,4,4,5,3,4,5]')
      } : null
    });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error: ' + e.message }); }
});

module.exports = router;
