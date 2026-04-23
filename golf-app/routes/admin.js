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
