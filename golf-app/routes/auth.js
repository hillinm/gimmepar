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
        // Superadmin — no league selection needed
        if (user.role === 'superadmin') {
          req.session.userId = user.id;
          req.session.role = 'superadmin';
          return req.session.save(err => {
            if (err) return sendError(res, 500, 'Session error');
            res.json({ success: true, role: 'superadmin', userId: user.id, firstName: user.first_name, lastName: user.last_name });
          });
        }

        // Get all leagues this user belongs to (from user_leagues junction + legacy league_id)
        const userLeagues = await getAll(
          `SELECT ul.league_id, ul.team_id, ul.role, l.name as league_name
           FROM user_leagues ul
           JOIN leagues l ON l.id = ul.league_id
           WHERE ul.user_id = $1
           ORDER BY l.name`,
          [user.id]
        );

        // Also check legacy league_id on users table
        if (user.league_id && !userLeagues.find(ul => ul.league_id === user.league_id)) {
          const league = await getOne('SELECT id, name FROM leagues WHERE id=$1', [user.league_id]);
          if (league) userLeagues.push({ league_id: league.id, team_id: user.team_id, role: user.role, league_name: league.name });
        }

        // If user belongs to multiple leagues, return list for them to choose
        if (userLeagues.length > 1 && !req.body.leagueId) {
          return res.json({
            success: true,
            multiLeague: true,
            userId: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            leagues: userLeagues.map(ul => ({ id: ul.league_id, name: ul.league_name, role: ul.role }))
          });
        }

        // Single league or specific league chosen
        const chosenLeague = req.body.leagueId
          ? userLeagues.find(ul => ul.league_id == req.body.leagueId) || userLeagues[0]
          : userLeagues[0] || { league_id: user.league_id, team_id: user.team_id, role: user.role };

        if (!chosenLeague) return sendError(res, 401, 'User not assigned to any league');

        const leagueRow = await getOne('SELECT name FROM leagues WHERE id=$1', [chosenLeague.league_id]);
        const leagueName = leagueRow?.name;
        const teamId = chosenLeague.team_id || user.team_id;
        const role = chosenLeague.role || user.role;
        let teamInfo = null;
        if (teamId) teamInfo = await getOne('SELECT * FROM teams WHERE id=$1', [teamId]);

        req.session.userId   = user.id;
        req.session.leagueId = chosenLeague.league_id;
        req.session.leagueName = leagueName;
        req.session.role     = role;
        req.session.teamId   = teamId;
        if (req.body.rememberMe) {
          req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        } else {
          req.session.cookie.maxAge = null;
        }
        return req.session.save(err => {
          if (err) return sendError(res, 500, 'Session error');
          res.json({
            success: true,
            role,
            leagueName,
            leagueId: chosenLeague.league_id,
            userId: user.id,
            teamId,
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

// ── FORGOT PASSWORD ──
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await getOne('SELECT * FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true });

    const bcrypt = require('bcryptjs');
    const https  = require('https');

    // Generate temp password
    const temp = user.first_name.charAt(0).toUpperCase() + user.last_name.toLowerCase() + Math.floor(1000 + Math.random() * 9000);
    const hash = bcrypt.hashSync(temp, 10);
    await query('UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2', [hash, user.id]);

    const apiKey = process.env.RESEND_API_KEY;
    const appUrl = process.env.APP_URL || 'https://gimmepar.com';
    if (!apiKey) return res.json({ success: true });

    const html = [
      '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">',
      '<div style="background:#1a2e1a;padding:16px 24px;border-radius:8px 8px 0 0;">',
      '<span style="color:#c9a84c;font-size:20px;font-weight:700;letter-spacing:2px;">⛳ GimmePar</span>',
      '</div>',
      '<div style="border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px;">',
      '<h2 style="color:#1a2e1a;margin-top:0;">Password Reset</h2>',
      '<p>Hi ' + user.first_name + ',</p>',
      '<p>We received a request to reset your GimmePar password. Here is your temporary password:</p>',
      '<div style="background:#f4f4f4;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">',
      '<span style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#1a2e1a;">' + temp + '</span>',
      '</div>',
      '<p><a href="' + appUrl + '" style="background:#4a8c3f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Log In to GimmePar</a></p>',
      '<p style="color:#888;font-size:12px;">You will be asked to set a new password when you log in. If you did not request this reset, you can ignore this email.</p>',
      '</div></div>'
    ].join('');

    const body = JSON.stringify({
      from: process.env.RESEND_FROM || 'GimmePar <onboarding@resend.dev>',
      to: [user.email],
      subject: 'GimmePar - Password Reset',
      html
    });

    const options = {
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req2 = https.request(options, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log('Forgot PW email status:',r.statusCode)); });
    req2.on('error', e => console.warn('Forgot PW email error:', e.message));
    req2.write(body); req2.end();

    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});
