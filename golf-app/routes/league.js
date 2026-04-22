const express = require('express');
const db = require('../db/database');
const router = express.Router();

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.leagueId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// ── COURSE ──
router.put('/course', requireAuth, (req, res) => {
  const { name, location, front9par, back9par } = req.body;
  db.prepare(`UPDATE leagues SET course_name=?, course_location=?, front9par=?, back9par=? WHERE id=?`)
    .run(name, location, JSON.stringify(front9par), JSON.stringify(back9par), req.session.leagueId);
  res.json({ success: true });
});

// ── TEAMS ──
router.get('/teams', requireAuth, (req, res) => {
  const teams = db.prepare('SELECT * FROM teams WHERE league_id=? ORDER BY sort_order, id').all(req.session.leagueId);
  res.json(teams);
});

router.post('/teams', requireAuth, (req, res) => {
  const { player1, player2, handicap, nine } = req.body;
  const count = db.prepare('SELECT COUNT(*) as c FROM teams WHERE league_id=?').get(req.session.leagueId).c;
  const result = db.prepare('INSERT INTO teams (league_id, player1, player2, handicap, nine, sort_order) VALUES (?,?,?,?,?,?)')
    .run(req.session.leagueId, player1||'', player2||'', handicap||0, nine||'front', count);
  res.json({ id: result.lastInsertRowid, player1, player2, handicap, nine: nine||'front', sort_order: count });
});

router.put('/teams/:id', requireAuth, (req, res) => {
  const { player1, player2, handicap, nine } = req.body;
  // Verify team belongs to this league
  const team = db.prepare('SELECT id FROM teams WHERE id=? AND league_id=?').get(req.params.id, req.session.leagueId);
  if (!team) return res.status(403).json({ error: 'Not your team' });
  db.prepare('UPDATE teams SET player1=?, player2=?, handicap=?, nine=? WHERE id=?')
    .run(player1||'', player2||'', handicap||0, nine||'front', req.params.id);
  res.json({ success: true });
});

router.delete('/teams/:id', requireAuth, (req, res) => {
  const team = db.prepare('SELECT id FROM teams WHERE id=? AND league_id=?').get(req.params.id, req.session.leagueId);
  if (!team) return res.status(403).json({ error: 'Not your team' });
  db.prepare('DELETE FROM teams WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Bulk update handicaps (after recalculate)
router.post('/teams/handicaps', requireAuth, (req, res) => {
  const { updates } = req.body; // [{id, handicap}]
  const update = db.prepare('UPDATE teams SET handicap=? WHERE id=? AND league_id=?');
  const updateMany = db.transaction((items) => {
    for (const u of items) update.run(u.handicap, u.id, req.session.leagueId);
  });
  updateMany(updates);
  res.json({ success: true });
});

// Bulk replace all teams (save roster)
router.post('/teams/roster', requireAuth, (req, res) => {
  const { teams } = req.body;
  const deleteAll = db.prepare('DELETE FROM teams WHERE league_id=?');
  const insert = db.prepare('INSERT INTO teams (league_id, player1, player2, handicap, nine, sort_order) VALUES (?,?,?,?,?,?)');
  const saveAll = db.transaction((items) => {
    deleteAll.run(req.session.leagueId);
    items.forEach((t, i) => insert.run(req.session.leagueId, t.player1||'', t.player2||'', t.handicap||0, t.nine||'front', i));
  });
  saveAll(teams);
  res.json({ success: true });
});

// ── ROUNDS (history) ──
router.get('/rounds', requireAuth, (req, res) => {
  const rounds = db.prepare('SELECT * FROM rounds WHERE league_id=? ORDER BY played_on DESC LIMIT 20').all(req.session.leagueId);
  res.json(rounds);
});

router.post('/rounds', requireAuth, (req, res) => {
  const { scores, notes } = req.body;
  // scores: [{team_id, nine, handicap_used, hole_scores, gross, net}]
  const round = db.prepare('INSERT INTO rounds (league_id, notes) VALUES (?,?)').run(req.session.leagueId, notes||'');
  const insertScore = db.prepare('INSERT INTO round_scores (round_id, team_id, nine, handicap_used, hole_scores, gross, net) VALUES (?,?,?,?,?,?,?)');
  const saveRound = db.transaction((items) => {
    for (const s of items) {
      insertScore.run(round.lastInsertRowid, s.team_id, s.nine, s.handicap_used||0, JSON.stringify(s.hole_scores||[]), s.gross||0, s.net||0);
    }
  });
  saveRound(scores);
  res.json({ success: true, roundId: round.lastInsertRowid });
});

router.get('/rounds/:id', requireAuth, (req, res) => {
  const round = db.prepare('SELECT * FROM rounds WHERE id=? AND league_id=?').get(req.params.id, req.session.leagueId);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const scores = db.prepare(`
    SELECT rs.*, t.player1, t.player2 FROM round_scores rs
    JOIN teams t ON t.id = rs.team_id
    WHERE rs.round_id=?`).all(req.params.id);
  res.json({ ...round, scores });
});

module.exports = router;
