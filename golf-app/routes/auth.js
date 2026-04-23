const express = require('express');
const bcrypt = require('bcryptjs');
const https = require('https');
const { getOne, getAll, query } = require('../db/database');
const router = express.Router();

function sendError(res, status, msg) {
  console.error('Auth error:', msg);
  return res.status(status).json({ error: msg });
}

function notifyNewLeague(leagueName, adminEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NOTIFY_EMAIL;
  if (!apiKey || !toEmail) return;
  const body = JSON.stringify({
    from: 'GimmePar <onboarding@resend.dev>',
    to: [toEmail],
    reply_to: adminEmail || undefined,
    subject: 'New GimmePar League: ' + leagueName,
    html: '<p>New league: <strong>' + leagueName + '</strong> | ' + (adminEmail||'no email') + '</p>'
  });
  const options = {
    hostname: 'api.resend.com', path: '/emails', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const req = https.request(options, () => {});
  req.on('error', () => {});
  req.write(body); req.end();
}

// ── LEAGUE REGISTER (creates league + league admin user) ──
router.post('/register', async (req, res) => {
  try {
    const { name, password, email } = req.body || {};
    if (!name || !password) return sendError(res, 400, 'Name and password required');
    if (String(password).length < 4) return sendError(res, 400, 'Password must be at least 4 characters');
    const adminEmail = String(email || '').trim().toLowerCase();

    const existing = await getOne('SELECT id FROM leagues WHERE name=$1', [String(name).trim()]);
    if (existing) return sendError(res, 409, 'League name already taken');

    const hash = bcrypt.hashSync(String(password), 10);
    const result = await query(
      'INSERT INTO leagues (name, password_hash, admin_email) VALUES ($1,$2,$3) RETURNING id',
      [String(name).trim(), hash, adminEmail]
    );
    const leagueId = result.rows[0].id;

    // Create a league admin user account if email provided
    if (adminEmail) {
      const existingUser = await getOne('SELECT id FROM users WHERE email=$1', [adminEmail]);
      if (!existingUser) {
        const userHash = bcrypt.hashSync(String(password), 10);
        await query(
          'INSERT INTO users (league_id, first_name, last_name, email, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [leagueId, 'League', 'Admin', adminEmail, userHash, 'leagueadmin', false]
        );
      }
    }

    req.session.userId = null;
    req.session.leagueId = leagueId;
    req.session.leagueName = String(name).trim();
    req.session.role = 'leagueadmin';
    req.session.save(err => {
      if (err) return sendError(res, 500, 'Session error: ' + err.message);
      notifyNewLeague(String(name).trim(), adminEmail);
      res.json({ success: true, leagueName: String(name).trim(), role: 'leagueadmin' });
    });
  } catch(e) { console.error(e); sendError(res, 500, 'Server error: ' + e.message); }
});

// ── UNIFIED LOGIN (handles all roles) ──
router.post('/login', async (req, res) => {
  try {
    const { name, password, type } = req.body || {};
    if (!name || !password) return sendError(res, 400, 'Email/name and password required');

    // Try user login first (players, leagueadmins, superadmin)
    if (type === 'user' || type === undefined) {
      const user = await getOne('SELECT * FROM users WHERE email=$1', [String(name).trim().toLowerCase()]);
      if (user && bcrypt.compareSync(String(password), user.password_hash)) {
        let leagueName = null;
        if (user.league_id) {
          const league = await getOne('SELECT name FROM leagues WHERE id=$1', [user.league_id]);
          leagueName = league?.name;
        }
        let teamInfo = null;
        if (user.team_id) {
          teamInfo = await getOne('SELECT * FROM teams WHERE id=$1', [user.team_id]);
        }
        req.session.userId = user.id;
        req.session.leagueId = user.league_id;
        req.session.leagueName = leagueName;
        req.session.role = user.role;
        req.session.teamId = user.team_id;
        return req.session.save(err => {
          if (err) return sendError(res, 500, 'Session error');
          res.json({
            success: true,
            role: user.role,
            leagueName,
            leagueId: user.league_id,
            userId: user.id,
            teamId: user.team_id,
            firstName: user.first_name,
            lastName: user.last_name,
            mustChangePassword: user.must_change_password,
            team: teamInfo
          });
        });
      }
    }

    // Try league login (legacy — league name + password)
    if (type === 'league' || type === undefined) {
      const league = await getOne('SELECT * FROM leagues WHERE name=$1', [String(name).trim()]);
      if (league && bcrypt.compareSync(String(password), league.password_hash)) {
        req.session.userId = null;
        req.session.leagueId = league.id;
        req.session.leagueName = league.name;
        req.session.role = 'leagueadmin';
        return req.session.save(err => {
          if (err) return sendError(res, 500, 'Session error');
          res.json({ success: true, role: 'leagueadmin', leagueName: league.name, leagueId: league.id });
        });
      }
    }

    return sendError(res, 401, 'Invalid credentials');
  } catch(e) { console.error(e); sendError(res, 500, 'Server error: ' + e.message); }
});

// ── CHANGE PASSWORD ──
router.post('/change-password', async (req, res) => {
  try {
    if (!req.session.userId) return sendError(res, 401, 'Not logged in');
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 4) return sendError(res, 400, 'Password must be at least 4 characters');
    const hash = bcrypt.hashSync(String(newPassword), 10);
    await query('UPDATE users SET password_hash=$1, must_change_password=FALSE WHERE id=$2', [hash, req.session.userId]);
    res.json({ success: true });
  } catch(e) { sendError(res, 500, 'Server error: ' + e.message); }
});

// ── LOGOUT ──
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── ME ──
router.get('/me', async (req, res) => {
  if (!req.session.userId && !req.session.leagueId) return res.status(401).json({ error: 'Not logged in' });
  try {
    const role = req.session.role || 'leagueadmin';

    if (role === 'superadmin') {
      return res.json({ role: 'superadmin', userId: req.session.userId });
    }

    if (role === 'player') {
      const user = await getOne('SELECT * FROM users WHERE id=$1', [req.session.userId]);
      if (!user) return res.status(401).json({ error: 'User not found' });
      const league = await getOne('SELECT id, name, course_name, course_location, front9par, back9par FROM leagues WHERE id=$1', [user.league_id]);
      const team = user.team_id ? await getOne('SELECT * FROM teams WHERE id=$1', [user.team_id]) : null;
      return res.json({
        role: 'player',
        userId: user.id,
        leagueId: user.league_id,
        leagueName: league?.name,
        firstName: user.first_name,
        lastName: user.last_name,
        teamId: user.team_id,
        team,
        mustChangePassword: user.must_change_password,
        course: league?.course_name ? {
          name: league.course_name, location: league.course_location,
          front9par: JSON.parse(league.front9par || '[4,3,4,4,4,5,3,4,5]'),
          back9par:  JSON.parse(league.back9par  || '[4,3,4,4,4,5,3,4,5]')
        } : null
      });
    }

    // leagueadmin
    const league = await getOne('SELECT id, name, course_name, course_location, front9par, back9par FROM leagues WHERE id=$1', [req.session.leagueId]);
    if (!league) return res.status(401).json({ error: 'League not found' });
    return res.json({
      role: 'leagueadmin',
      leagueId: league.id,
      leagueName: league.name,
      course: league.course_name ? {
        name: league.course_name, location: league.course_location,
        front9par: JSON.parse(league.front9par || '[4,3,4,4,4,5,3,4,5]'),
        back9par:  JSON.parse(league.back9par  || '[4,3,4,4,4,5,3,4,5]')
      } : null
    });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error: ' + e.message }); }
});

module.exports = router;
