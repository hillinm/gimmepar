const express = require('express');
const { getOne, getAll, query } = require('../db/database');
const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.leagueId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// ── COURSE ──
router.put('/course', requireAuth, async (req, res) => {
  try {
    const { name, location, front9par, back9par } = req.body;
    await query(
      'UPDATE leagues SET course_name=$1, course_location=$2, front9par=$3, back9par=$4 WHERE id=$5',
      [name, location, JSON.stringify(front9par), JSON.stringify(back9par), req.session.leagueId]
    );
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── TEAMS ──
router.get('/teams', requireAuth, async (req, res) => {
  try {
    const teams = await getAll('SELECT * FROM teams WHERE league_id=$1 ORDER BY sort_order, id', [req.session.leagueId]);
    res.json(teams);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/teams', requireAuth, async (req, res) => {
  try {
    const { player1, player2, player3, player4, handicap, nine, format } = req.body;
    const countRes = await query('SELECT COUNT(*) FROM teams WHERE league_id=$1', [req.session.leagueId]);
    const sort_order = parseInt(countRes.rows[0].count);
    const result = await query(
      'INSERT INTO teams (league_id, player1, player2, player3, player4, handicap, nine, format, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.session.leagueId, player1||'', player2||'', player3||'', player4||'', handicap||0, nine||'front', format||'2man', sort_order]
    );
    res.json(result.rows[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.put('/teams/:id', requireAuth, async (req, res) => {
  try {
    const { player1, player2, player3, player4, handicap, nine, format } = req.body;
    const team = await getOne('SELECT id FROM teams WHERE id=$1 AND league_id=$2', [req.params.id, req.session.leagueId]);
    if (!team) return res.status(403).json({ error: 'Not your team' });
    await query(
      'UPDATE teams SET player1=$1, player2=$2, player3=$3, player4=$4, handicap=$5, nine=$6, format=$7 WHERE id=$8',
      [player1||'', player2||'', player3||'', player4||'', handicap||0, nine||'front', format||'2man', req.params.id]
    );
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/teams/:id', requireAuth, async (req, res) => {
  try {
    const team = await getOne('SELECT id FROM teams WHERE id=$1 AND league_id=$2', [req.params.id, req.session.leagueId]);
    if (!team) return res.status(403).json({ error: 'Not your team' });
    await query('DELETE FROM teams WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/teams/handicaps', requireAuth, async (req, res) => {
  try {
    const { updates } = req.body;
    await Promise.all(updates.map(u =>
      query('UPDATE teams SET handicap=$1 WHERE id=$2 AND league_id=$3', [u.handicap, u.id, req.session.leagueId])
    ));
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/teams/roster', requireAuth, async (req, res) => {
  try {
    const { teams } = req.body;
    await query('DELETE FROM teams WHERE league_id=$1', [req.session.leagueId]);
    await Promise.all(teams.map((t, i) =>
      query('INSERT INTO teams (league_id, player1, player2, player3, player4, handicap, nine, format, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [req.session.leagueId, t.player1||'', t.player2||'', t.player3||'', t.player4||'', t.handicap||0, t.nine||'front', t.format||'2man', i])
    ));
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── ROUNDS ──
router.get('/rounds', requireAuth, async (req, res) => {
  try {
    const rounds = await getAll('SELECT * FROM rounds WHERE league_id=$1 ORDER BY played_on DESC LIMIT 20', [req.session.leagueId]);
    res.json(rounds);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/rounds', requireAuth, async (req, res) => {
  try {
    const { scores, notes } = req.body;
    const roundRes = await query('INSERT INTO rounds (league_id, notes) VALUES ($1,$2) RETURNING id', [req.session.leagueId, notes||'']);
    const roundId = roundRes.rows[0].id;
    await Promise.all(scores.map(s =>
      query('INSERT INTO round_scores (round_id, team_id, nine, handicap_used, hole_scores, gross, net) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [roundId, s.team_id, s.nine, s.handicap_used||0, JSON.stringify(s.hole_scores||[]), s.gross||0, s.net||0])
    ));
    res.json({ success: true, roundId });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.get('/rounds/:id', requireAuth, async (req, res) => {
  try {
    const round = await getOne('SELECT * FROM rounds WHERE id=$1 AND league_id=$2', [req.params.id, req.session.leagueId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    const scores = await getAll(
      'SELECT rs.*, t.player1, t.player2 FROM round_scores rs JOIN teams t ON t.id=rs.team_id WHERE rs.round_id=$1',
      [req.params.id]
    );
    res.json({ ...round, scores });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── COURSE SEARCH ──
router.post('/course-search', requireAuth, async (req, res) => {
  const { query: q } = req.body;
  if (!q) return res.status(400).json({ error: 'Query required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  const payload = JSON.stringify({
    model: 'claude-sonnet-4-20250514', max_tokens: 800,
    messages: [{ role: 'user', content: `Find golf course matching: "${q}". Return ONLY JSON:
{"courses":[{"name":"string","location":"City, State","front9par":[4,3,4,4,4,5,3,4,5],"back9par":[4,4,3,5,4,4,3,4,5],"totalPar":72,"confidence":"high|medium|low"}]}
Up to 3 results. Real hole pars for known courses. Always 9 values per nine.` }]
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const https = require('https');
      const options = {
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) }
      };
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(JSON.parse(data)));
      });
      request.on('error', reject);
      request.write(payload);
      request.end();
    });
    if (result.error) return res.status(500).json({ error: result.error.message });
    const raw = result.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Search failed: ' + e.message }); }
});

module.exports = router;

// ── SAVED COURSES LIBRARY ──
router.get('/courses', requireAuth, async (req, res) => {
  try {
    const courses = await getAll('SELECT * FROM saved_courses WHERE league_id=$1 ORDER BY name', [req.session.leagueId]);
    res.json(courses);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/courses', requireAuth, async (req, res) => {
  try {
    const { name, location, front9par, back9par } = req.body;
    const result = await query(
      'INSERT INTO saved_courses (league_id, name, location, front9par, back9par) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.session.leagueId, name, location||'', JSON.stringify(front9par), JSON.stringify(back9par)]
    );
    res.json(result.rows[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.put('/courses/:id', requireAuth, async (req, res) => {
  try {
    const { name, location, front9par, back9par } = req.body;
    const course = await getOne('SELECT id FROM saved_courses WHERE id=$1 AND league_id=$2', [req.params.id, req.session.leagueId]);
    if (!course) return res.status(403).json({ error: 'Not your course' });
    await query(
      'UPDATE saved_courses SET name=$1, location=$2, front9par=$3, back9par=$4 WHERE id=$5',
      [name, location||'', JSON.stringify(front9par), JSON.stringify(back9par), req.params.id]
    );
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/courses/:id', requireAuth, async (req, res) => {
  try {
    const course = await getOne('SELECT id FROM saved_courses WHERE id=$1 AND league_id=$2', [req.params.id, req.session.leagueId]);
    if (!course) return res.status(403).json({ error: 'Not your course' });
    await query('DELETE FROM saved_courses WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});
