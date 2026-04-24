const express = require('express');
const bcrypt = require('bcryptjs');
const { getOne, getAll, query } = require('../db/database');
const router = express.Router();

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.role || !roles.includes(req.session.role)) {
      console.log('requireRole DENIED - session role:', req.session.role, '| required:', roles);
      return res.status(403).json({ error: 'Forbidden - role ' + (req.session.role||'none') + ' not in ' + roles.join(',') });
    }
    next();
  };
}

// Debug endpoint - check session state
router.get('/session-check', (req, res) => {
  res.json({
    role: req.session.role || null,
    userId: req.session.userId || null,
    leagueId: req.session.leagueId || null,
    hasSession: !!req.session.id
  });
});

// ── SUPER ADMIN: list all leagues ──
router.get('/leagues', requireRole('superadmin'), async (req, res) => {
  try {
    const leagues = await getAll('SELECT id, name, admin_email, created_at FROM leagues ORDER BY created_at DESC', []);
    res.json(leagues);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SUPER ADMIN: list all users ──
router.get('/users', requireRole('superadmin'), async (req, res) => {
  try {
    const users = await getAll(
      'SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.must_change_password, u.league_id, l.name as league_name FROM users u LEFT JOIN leagues l ON l.id=u.league_id ORDER BY l.name, u.last_name',
      []
    );
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SUPER ADMIN / LEAGUE ADMIN: reset user password ──
router.post('/users/:id/reset-password', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password too short' });
    // League admin can only reset users in their league
    if (req.session.role === 'leagueadmin') {
      const user = await getOne('SELECT id FROM users WHERE id=$1 AND league_id=$2', [req.params.id, req.session.leagueId]);
      if (!user) return res.status(403).json({ error: 'Not your user' });
    }
    const hash = bcrypt.hashSync(String(newPassword), 10);
    await query('UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2', [hash, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEAGUE ADMIN: upload players from CSV data ──
router.post('/players/upload', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const { players, leagueId } = req.body || {};
    const targetLeague = req.session.role === 'superadmin' ? leagueId : req.session.leagueId;
    if (!targetLeague) return res.status(400).json({ error: 'No league specified' });
    if (!players || !players.length) return res.status(400).json({ error: 'No players provided' });

    const results = { created: 0, updated: 0, errors: [] };

    for (const p of players) {
      const email = String(p.email || '').trim().toLowerCase();
      const firstName = String(p.first_name || p.firstName || '').trim();
      const lastName  = String(p.last_name  || p.lastName  || '').trim();
      if (!email || !email.includes('@')) { results.errors.push('Invalid email: ' + email); continue; }
      if (!firstName || !lastName) { results.errors.push('Missing name for: ' + email); continue; }

      // Default password = last name + last 4 of email before @, capitalized
      const defaultPass = lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase() + '2026';
      const hash = bcrypt.hashSync(defaultPass, 10);

      const existing = await getOne('SELECT id FROM users WHERE email=$1', [email]);
      if (existing) {
        await query('UPDATE users SET first_name=$1, last_name=$2, league_id=$3 WHERE id=$4',
          [firstName, lastName, targetLeague, existing.id]);
        results.updated++;
      } else {
        await query(
          'INSERT INTO users (league_id, first_name, last_name, email, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [targetLeague, firstName, lastName, email, hash, 'player', true]
        );
        results.created++;
      }
    }
    res.json({ success: true, ...results, defaultPasswordNote: 'Default password: LastName2026 (e.g. Smith2026)' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEAGUE ADMIN: list players in league ──
router.get('/players', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const leagueId = req.session.role === 'superadmin'
      ? (req.query.leagueId || null)
      : req.session.leagueId;
    const users = await getAll(
      'SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.must_change_password, u.team_id, t.player1, t.player2 FROM users u LEFT JOIN teams t ON t.id=u.team_id WHERE u.league_id=$1 ORDER BY u.last_name',
      [leagueId]
    );
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEAGUE ADMIN: assign player to team ──
router.put('/players/:id/team', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const { teamId } = req.body || {};
    // Verify player is in league
    const leagueId = req.session.role === 'superadmin' ? undefined : req.session.leagueId;
    const whereClause = leagueId ? 'id=$1 AND league_id=$2' : 'id=$1';
    const params = leagueId ? [req.params.id, leagueId] : [req.params.id];
    const user = await getOne('SELECT id FROM users WHERE ' + whereClause, params);
    if (!user) return res.status(403).json({ error: 'Not your player' });
    await query('UPDATE users SET team_id=$1 WHERE id=$2', [teamId || null, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEAGUE ADMIN: delete player ──
router.delete('/players/:id', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const leagueId = req.session.role === 'leagueadmin' ? req.session.leagueId : null;
    if (leagueId) {
      const user = await getOne('SELECT id FROM users WHERE id=$1 AND league_id=$2', [req.params.id, leagueId]);
      if (!user) return res.status(403).json({ error: 'Not your player' });
    }
    await query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

// ── SUPER ADMIN: reset league password ──
router.post('/leagues/:id/reset-password', requireRole('superadmin'), async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password too short' });
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(String(newPassword), 10);
    await query('UPDATE leagues SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SUPER ADMIN: delete league ──
router.delete('/leagues/:id', requireRole('superadmin'), async (req, res) => {
  try {
    // Delete cascade handles teams, rounds, scores, users
    await query('DELETE FROM leagues WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Super admin: get league info (course, settings)
router.get('/league/:id', requireRole('superadmin'), async (req, res) => {
  try {
    const league = await getOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league) return res.status(404).json({ error: 'Not found' });
    res.json({
      id: league.id,
      name: league.name,
      course: league.course_name ? {
        name: league.course_name,
        location: league.course_location,
        front9par: JSON.parse(league.front9par || '[4,3,4,4,4,5,3,4,5]'),
        back9par:  JSON.parse(league.back9par  || '[4,3,4,4,4,5,3,4,5]')
      } : null
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Update player info (name + email) ──
router.put('/players/:id/info', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const { first_name, last_name, email } = req.body || {};
    if (!first_name || !last_name || !email) return res.status(400).json({ error: 'Name and email required' });
    // Verify player is in league
    if (req.session.role === 'leagueadmin') {
      const user = await getOne('SELECT id FROM users WHERE id=$1 AND league_id=$2', [req.params.id, req.session.leagueId]);
      if (!user) return res.status(403).json({ error: 'Not your player' });
    }
    // Check email not taken by someone else
    const existing = await getOne('SELECT id FROM users WHERE email=$1 AND id!=$2', [email.toLowerCase().trim(), req.params.id]);
    if (existing) return res.status(409).json({ error: 'Email already in use by another account' });
    await query('UPDATE users SET first_name=$1, last_name=$2, email=$3 WHERE id=$4',
      [first_name.trim(), last_name.trim(), email.toLowerCase().trim(), req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Send password reset email ──
router.post('/users/:id/send-reset', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    console.log('send-reset called for user:', req.params.id, '| RESEND_FROM:', process.env.RESEND_FROM || 'not set', '| RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'set' : 'NOT SET');
    const bcrypt = require('bcryptjs');
    const https  = require('https');
    const user = await getOne('SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (req.session.role === 'leagueadmin') {
      if (user.league_id !== req.session.leagueId) return res.status(403).json({ error: 'Not your player' });
    }
    // Generate a temp password: FirstLastNNNN
    const temp = user.first_name.charAt(0).toUpperCase() + user.last_name.toLowerCase() + Math.floor(1000+Math.random()*9000);
    const hash = bcrypt.hashSync(temp, 10);
    await query('UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2', [hash, user.id]);

    // Send email via Resend
    const apiKey = process.env.RESEND_API_KEY;
    const appUrl = process.env.APP_URL || 'https://gimmepar.com';
    if (!apiKey) return res.json({ success: true, note: 'Email not sent - RESEND_API_KEY not set. Temp password: ' + temp });

    const body = JSON.stringify({
      from: process.env.RESEND_FROM || 'GimmePar <onboarding@resend.dev>',
      to: [user.email],
      subject: 'GimmePar - Your Password Has Been Reset',
      html: [
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">',
        '<h2 style="color:#1a2e1a;">⛳ GimmePar Password Reset</h2>',
        '<p>Hi ' + user.first_name + ',</p>',
        '<p>Your league coordinator has reset your GimmePar password.</p>',
        '<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8f8f8;border-radius:8px;">',
        '<tr><td style="padding:12px;">Email</td><td style="padding:12px;font-weight:bold;">' + user.email + '</td></tr>',
        '<tr><td style="padding:12px;">Temporary Password</td><td style="padding:12px;font-weight:bold;font-size:18px;">' + temp + '</td></tr>',
        '</table>',
        '<p><a href="' + appUrl + '" style="background:#4a8c3f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Log In to GimmePar</a></p>',
        '<p style="color:#888;font-size:12px;">You will be asked to set a new password when you log in.</p>',
        '</div>'
      ].join('')
    });

    const options = {
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const emailReq = https.request(options, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => console.log('Reset email to', user.email, 'status:', r.statusCode, d));
    });
    emailReq.on('error', e => console.warn('Reset email failed:', e.message));
    emailReq.write(body); emailReq.end();

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADD USER TO LEAGUE ──
router.post('/users/:id/add-league', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const { league_id, role } = req.body || {};
    if (!league_id) return res.status(400).json({ error: 'league_id required' });
    await query(
      `INSERT INTO user_leagues (user_id, league_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, league_id) DO UPDATE SET role=$3`,
      [req.params.id, league_id, role || 'player']
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MULTI-LEAGUE: Link existing user to this league ──
router.post('/players/link', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const { email, team_id } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await getOne('SELECT id, first_name, last_name FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (!user) return res.status(404).json({ error: 'No user found with that email. They must be registered in another league first.' });
    const leagueId = req.session.leagueId;
    // Insert into user_leagues
    await query(
      `INSERT INTO user_leagues (user_id, league_id, team_id, role)
       VALUES ($1,$2,$3,'player')
       ON CONFLICT (user_id, league_id) DO UPDATE SET team_id=$3`,
      [user.id, leagueId, team_id || null]
    );
    res.json({ success: true, name: user.first_name + ' ' + user.last_name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MULTI-LEAGUE: Search users by email to link ──
router.get('/users/search', requireRole('superadmin','leagueadmin'), async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q || q.length < 3) return res.json([]);
    const users = await getAll(
      `SELECT id, first_name, last_name, email FROM users
       WHERE (LOWER(email) LIKE $1 OR LOWER(first_name||' '||last_name) LIKE $1)
       AND role != 'superadmin'
       LIMIT 10`,
      ['%' + q + '%']
    );
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
