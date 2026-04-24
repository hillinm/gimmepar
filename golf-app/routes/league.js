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
      query('INSERT INTO round_scores (round_id, team_id, nine, handicap_used, hole_scores, gross, net, is_sub, sub_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [roundId, s.team_id, s.nine, s.handicap_used||0, JSON.stringify(s.hole_scores||[]), s.gross||0, s.net||0, !!s.is_sub, s.sub_name||''])
    ));
    res.json({ success: true, roundId });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Sub usage count for each team this season
router.get('/sub-counts', requireAuth, async (req, res) => {
  try {
    const rows = await getAll(
      `SELECT rs.team_id, COUNT(*) as sub_count
       FROM round_scores rs
       JOIN rounds r ON r.id = rs.round_id
       WHERE r.league_id = $1 AND rs.is_sub = TRUE
       GROUP BY rs.team_id`,
      [req.session.leagueId]
    );
    // Return as {teamId: count}
    const counts = {};
    rows.forEach(r => { counts[r.team_id] = parseInt(r.sub_count); });
    res.json(counts);
  } catch(e) { res.status(500).json({ error: e.message }); }
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

// ── GLOBAL COURSE LIBRARY ──
const { getAll: getAllCourses, getOne: getOneCourse, query: queryCourse } = require('../db/database');

router.get('/courses/global/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json([]);
    const results = await getAll(
      "SELECT * FROM global_courses WHERE name ILIKE $1 OR location ILIKE $1 OR state ILIKE $1 ORDER BY name LIMIT 10",
      ['%' + q + '%']
    );
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/courses/global', requireAuth, async (req, res) => {
  try {
    const { name, location, state, front9par, back9par } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Course name required' });
    // Upsert — if course already exists update par values
    const existing = await getOne("SELECT id FROM global_courses WHERE LOWER(name)=LOWER($1)", [name]);
    if (existing) {
      await query(
        'UPDATE global_courses SET location=$1, state=$2, front9par=$3, back9par=$4 WHERE id=$5',
        [location||'', state||'', JSON.stringify(front9par), JSON.stringify(back9par), existing.id]
      );
      return res.json({ success: true, updated: true, id: existing.id });
    }
    const result = await query(
      'INSERT INTO global_courses (name, location, state, front9par, back9par, added_by_league_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, location||'', state||'', JSON.stringify(front9par), JSON.stringify(back9par), req.session.leagueId || null]
    );
    res.json({ success: true, updated: false, ...result.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/courses/global/all', requireAuth, async (req, res) => {
  try {
    const courses = await getAll('SELECT * FROM global_courses ORDER BY name', []);
    res.json(courses);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/courses/global/:id', requireAuth, async (req, res) => {
  try {
    // Only superadmin can delete global courses
    if (req.session.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
    await query('DELETE FROM global_courses WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SCHEDULE STORAGE ──
router.post('/schedule/save', requireAuth, async (req, res) => {
  try {
    const { weeks } = req.body || {};
    if (!weeks || !weeks.length) return res.status(400).json({ error: 'No weeks provided' });
    for (const w of weeks) {
      await query(
        `INSERT INTO schedule_weeks (league_id, week_number, matchups)
         VALUES ($1,$2,$3)
         ON CONFLICT (league_id, week_number) DO UPDATE SET matchups=$3`,
        [req.session.leagueId, w.week, JSON.stringify(w.matchups)]
      );
    }
    res.json({ success: true, saved: weeks.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/schedule/week/:weekNum', requireAuth, async (req, res) => {
  try {
    const leagueId = req.session.leagueId;
    const weekNum = parseInt(req.params.weekNum);
    const row = await getOne('SELECT * FROM schedule_weeks WHERE league_id=$1 AND week_number=$2', [leagueId, weekNum]);
    if (!row) return res.status(404).json({ error: 'No schedule for week ' + weekNum });
    const rawMatchups = JSON.parse(row.matchups);
    // Hydrate team data from IDs
    const teams = await getAll('SELECT * FROM teams WHERE league_id=$1', [leagueId]);
    const teamMap = {};
    teams.forEach(t => { teamMap[t.id] = t; });
    const matchups = rawMatchups.map(m => ({
      hole: m.hole,
      nine: m.nine || 'front',
      teamA: m.teamAId ? teamMap[m.teamAId] || null : null,
      teamB: m.teamBId ? teamMap[m.teamBId] || null : null
    }));
    res.json({ week: row.week_number, matchups });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/schedule/current', requireAuth, async (req, res) => {
  try {
    const leagueId = req.session.leagueId;
    // Get currentWeek from league settings
    const league = await getOne('SELECT settings FROM leagues WHERE id=$1', [leagueId]);
    const settings = JSON.parse(league?.settings || '{}');
    const currentWeek = settings.currentWeek || null;
    // Also check if that week exists in schedule
    const hasWeek = currentWeek ? await getOne(
      'SELECT week_number FROM schedule_weeks WHERE league_id=$1 AND week_number=$2',
      [leagueId, currentWeek]
    ) : null;
    res.json({ currentWeek: hasWeek ? currentWeek : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEAGUE SETTINGS ──
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const league = await getOne('SELECT settings FROM leagues WHERE id=$1', [req.session.leagueId]);
    const settings = JSON.parse(league?.settings || '{}');
    res.json(settings);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/settings', requireAuth, async (req, res) => {
  try {
    const current = await getOne('SELECT settings FROM leagues WHERE id=$1', [req.session.leagueId]);
    const existing = JSON.parse(current?.settings || '{}');
    const updated = Object.assign({}, existing, req.body);
    await query('UPDATE leagues SET settings=$1 WHERE id=$2', [JSON.stringify(updated), req.session.leagueId]);
    res.json({ success: true, settings: updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get all saved schedule weeks for a league
router.get('/schedule/all', requireAuth, async (req, res) => {
  try {
    const leagueId = req.session.leagueId;
    const rows = await getAll(
      'SELECT week_number, matchups FROM schedule_weeks WHERE league_id=$1 ORDER BY week_number',
      [leagueId]
    );
    const teams = await getAll('SELECT * FROM teams WHERE league_id=$1', [leagueId]);
    const teamMap = {};
    // Use string keys to handle JSON integer/string mismatch
    teams.forEach(t => { teamMap[String(t.id)] = t; });
    const weeks = rows.map(row => {
      const raw = JSON.parse(row.matchups);
      return {
        week: row.week_number,
        matchups: raw.map(m => {
          // Support both slim format (teamAId) and legacy format (teamA.id)
          const aId = m.teamAId || (m.teamA && m.teamA.id) || null;
          const bId = m.teamBId || (m.teamB && m.teamB.id) || null;
          return {
            hole: m.hole,
            nine: m.nine || 'front',
            teamA: aId ? (teamMap[String(aId)] || null) : null,
            teamB: bId ? (teamMap[String(bId)] || null) : null
          };
        })
      };
    });
    // Filter out fully null matchups (bye rows stored as null IDs)
    const cleanedWeeks = weeks.map(w => ({
      ...w,
      matchups: w.matchups.filter(m => m.teamA || m.teamB)
    }));
    res.json(cleanedWeeks);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete all saved schedule weeks for a league
router.delete('/schedule/all', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM schedule_weeks WHERE league_id=$1', [req.session.leagueId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
