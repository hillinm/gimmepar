const express = require('express');
const bcrypt = require('bcryptjs');
const https = require('https');
const { getOne, query } = require('../db/database');
const router = express.Router();

function sendError(res, status, msg) {
  console.error('Auth error:', msg);
  return res.status(status).json({ error: msg });
}

// Send notification email via Resend — fire and forget, never blocks registration
function notifyNewLeague(leagueName) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NOTIFY_EMAIL;
  if (!apiKey || !toEmail) return; // silently skip if not configured

  const body = JSON.stringify({
    from: 'GimmePar <onboarding@resend.dev>',
    to: [toEmail],
    subject: 'New GimmePar League: ' + leagueName,
    html: [
      '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">',
      '<h2 style="color:#1a2e1a;">⛳ New League Created</h2>',
      '<p>A new league just signed up on <strong>GimmePar</strong>.</p>',
      '<table style="width:100%;border-collapse:collapse;margin:16px 0;">',
      '<tr><td style="padding:8px;color:#666;">League Name</td>',
      '<td style="padding:8px;font-weight:bold;">' + leagueName + '</td></tr>',
      '<tr><td style="padding:8px;color:#666;">Time</td>',
      '<td style="padding:8px;">' + new Date().toLocaleString('en-US', {timeZone:'America/Chicago'}) + ' CT</td></tr>',
      '</table>',
      '<p style="color:#888;font-size:12px;">You are receiving this because you are the GimmePar admin.</p>',
      '</div>'
    ].join('')
  });

  const options = {
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => console.log('Notification sent for league:', leagueName, '| Status:', res.statusCode));
  });
  req.on('error', (e) => console.warn('Notification failed (non-critical):', e.message));
  req.write(body);
  req.end();
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
      // Send notification after successful registration (non-blocking)
      notifyNewLeague(String(name).trim());
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
