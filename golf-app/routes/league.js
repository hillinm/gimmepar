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
    const leagueId = (req.session.role === 'superadmin' && req.query.leagueId) ? req.query.leagueId : req.session.leagueId;
    const teams = await getAll('SELECT * FROM teams WHERE league_id=$1 ORDER BY sort_order, id', [leagueId]);
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
  const apiKey = process.env.GOLF_COURSE_API_KEY || 'RKWDETGQRSPIWRV5I4BRNVO5NA';
  const https = require('https');

  try {
    // Search for courses by name using golfcoursesapi.com
    const searchPath = '/api/v1/courses?search=' + encodeURIComponent(q) + '&per_page=5';
    const searchResult = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'golfcoursesapi.com', path: searchPath, method: 'GET',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' }
      };
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(data) }); }
          catch(e) { resolve({ status: response.statusCode, body: data }); }
        });
      });
      request.on('error', reject);
      request.end();
    });

    if (searchResult.status !== 200) {
      return res.status(500).json({ error: 'Golf Course API error: ' + searchResult.status });
    }

    const data = searchResult.body;
    const courses = (data.data || data.courses || data || []).slice(0, 5);

    if (!courses.length) return res.json({ courses: [] });

    // For each result, fetch full hole details
    const mapped = await Promise.all(courses.map(async (c) => {
      let front9par = [4,3,4,4,4,5,3,4,5];
      let back9par  = [4,4,3,5,4,4,3,4,5];
      let totalPar  = 72;
      try {
        const courseId = c.id || c.course_id;
        if (courseId) {
          const detail = await new Promise((resolve, reject) => {
            const options = {
              hostname: 'golfcoursesapi.com',
              path: '/api/v1/courses/' + courseId,
              method: 'GET',
              headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' }
            };
            const req2 = https.request(options, (response) => {
              let d = '';
              response.on('data', chunk => d += chunk);
              response.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
            });
            req2.on('error', () => resolve({}));
            req2.end();
          });
          // Extract hole pars from detail
          const holes = detail.holes || (detail.data && detail.data.holes) || [];
          if (holes.length >= 9) {
            front9par = holes.slice(0, 9).map(h => parseInt(h.par) || 4);
            if (holes.length >= 18) {
              back9par = holes.slice(9, 18).map(h => parseInt(h.par) || 4);
            }
            totalPar = [...front9par, ...back9par].reduce((a,b) => a+b, 0);
          } else if (detail.par || (detail.data && detail.data.par)) {
            totalPar = detail.par || detail.data.par;
          }
        }
      } catch(e) { /* use defaults */ }

      const location = [c.city, c.state || c.state_name].filter(Boolean).join(', ') || c.location || '';
      return {
        name: c.name || c.course_name || 'Unknown',
        location,
        front9par,
        back9par,
        totalPar,
        confidence: 'high'
      };
    }));

    res.json({ courses: mapped });
  } catch(e) {
    console.error('Course search error:', e);
    res.status(500).json({ error: 'Search failed: ' + e.message });
  }
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
      teamA: m.teamAId ? (teamMap[m.teamAId] || null) : null,
      teamB: m.teamBId ? (teamMap[m.teamBId] || null) : null,
      // Fallback to stored names if team not found (random draw teams)
      teamAName: m.teamAName || null,
      teamBName: m.teamBName || null
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

// ── SEASON STANDINGS ──
// Returns W/L/T per team, grouped by flight, based on saved schedule matchups + round scores
router.get('/standings', requireAuth, async (req, res) => {
  try {
    const leagueId = req.session.leagueId;

    // Get all teams
    const teams = await getAll('SELECT * FROM teams WHERE league_id=$1', [leagueId]);
    const teamMap = {};
    teams.forEach(t => { teamMap[t.id] = t; });

    // Get all round scores (all-time for this league)
    const scores = await getAll(
      `SELECT rs.*, r.played_on
       FROM round_scores rs
       JOIN rounds r ON r.id = rs.round_id
       WHERE r.league_id = $1
       ORDER BY r.played_on ASC, r.id ASC`,
      [leagueId]
    );

    // Get all saved schedule weeks to determine matchups
    const scheduleRows = await getAll(
      'SELECT week_number, matchups FROM schedule_weeks WHERE league_id=$1 ORDER BY week_number',
      [leagueId]
    );

    // Build per-round score lookup: roundId -> [scores]
    // Group scores by round
    const roundScores = {};
    scores.forEach(s => {
      if (!roundScores[s.round_id]) roundScores[s.round_id] = [];
      roundScores[s.round_id].push(s);
    });

    // Get rounds in order
    const rounds = await getAll(
      'SELECT * FROM rounds WHERE league_id=$1 ORDER BY played_on ASC, id ASC',
      [leagueId]
    );

    // Initialize standings per team
    const standings = {};
    teams.forEach(t => {
      standings[t.id] = {
        team: t,
        wins: 0, losses: 0, ties: 0, points: 0,
        played: 0, flight: null
      };
    });

    // Match each round to a schedule week by position (round 1 = week 1, etc)
    rounds.forEach((round, roundIdx) => {
      const weekNum = roundIdx + 1;
      const schedRow = scheduleRows.find(s => s.week_number === weekNum);
      if (!schedRow) return;

      const matchups = JSON.parse(schedRow.matchups);
      const roundScoreList = roundScores[round.id] || [];

      // Build net score map for this round: teamId -> net
      const netMap = {};
      roundScoreList.forEach(s => { netMap[s.team_id] = s.net; });

      matchups.forEach(m => {
        if (!m.teamAId || !m.teamBId) return;
        const netA = netMap[m.teamAId];
        const netB = netMap[m.teamBId];
        if (netA == null || netB == null) return; // scores not entered

        const sA = standings[m.teamAId];
        const sB = standings[m.teamBId];
        if (!sA || !sB) return;

        sA.played++;
        sB.played++;

        if (netA < netB) {
          sA.wins++; sA.points += 1;
          sB.losses++;
        } else if (netB < netA) {
          sB.wins++; sB.points += 1;
          sA.losses++;
        } else {
          sA.ties++; sA.points += 0.5;
          sB.ties++; sB.points += 0.5;
        }
      });
    });

    // Assign flights based on handicap (lower hdcp = A flight)
    // Use the same high/low split logic: lower half = A, upper half = B
    const teamList = teams.slice().sort((a, b) => a.handicap - b.handicap);
    const mid = Math.ceil(teamList.length / 2);
    teamList.forEach((t, i) => {
      if (standings[t.id]) standings[t.id].flight = i < mid ? 'A' : 'B';
    });

    res.json(Object.values(standings).sort((a, b) => b.points - a.points));
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── STANDINGS ADJUSTMENTS ──
router.get('/standings/adjustments', requireAuth, async (req, res) => {
  try {
    const rows = await getAll('SELECT * FROM standings_adjustments WHERE league_id=$1', [req.session.leagueId]);
    const map = {};
    rows.forEach(r => { map[r.team_id] = r; });
    res.json(map);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/standings/adjustments/:teamId', requireAuth, async (req, res) => {
  try {
    const { wins_adj, losses_adj, ties_adj, note } = req.body || {};
    await query(
      `INSERT INTO standings_adjustments (league_id, team_id, wins_adj, losses_adj, ties_adj, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (league_id, team_id) DO UPDATE SET wins_adj=$3, losses_adj=$4, ties_adj=$5, note=$6`,
      [req.session.leagueId, req.params.teamId, wins_adj||0, losses_adj||0, ties_adj||0, note||'']
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEAGUE INFO (name + password) ──
router.put('/info', requireAuth, async (req, res) => {
  try {
    const { name, password } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
    const trimmed = String(name).trim();
    // Check name not taken by another league
    const existing = await getOne('SELECT id FROM leagues WHERE name=$1 AND id!=$2', [trimmed, req.session.leagueId]);
    if (existing) return res.status(409).json({ error: 'League name already taken' });
    if (password) {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync(String(password), 10);
      await query('UPDATE leagues SET name=$1, password_hash=$2 WHERE id=$3', [trimmed, hash, req.session.leagueId]);
    } else {
      await query('UPDATE leagues SET name=$1 WHERE id=$2', [trimmed, req.session.leagueId]);
    }
    req.session.leagueName = trimmed;
    req.session.save(() => res.json({ success: true }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CALCULATED HANDICAPS ──
// Returns calculated handicap for each team based on round history
router.get('/handicaps/calculated', requireAuth, async (req, res) => {
  try {
    const leagueId = req.session.leagueId;
    const league = await getOne('SELECT settings FROM leagues WHERE id=$1', [leagueId]);
    const settings = JSON.parse(league?.settings || '{}');
    const hdcpSystem   = settings.hdcpSystem   || 'live';
    const hdcpEstWeeks = parseInt(settings.hdcpEstWeeks) || 5;
    const hdcpPct      = parseInt(settings.hdcpPct) || 80;
    const hdcpMaxChange = parseFloat(settings.hdcpMaxChange) || 0;

    // Get all rounds in order
    const rounds = await getAll(
      'SELECT * FROM rounds WHERE league_id=$1 ORDER BY played_on ASC, id ASC',
      [leagueId]
    );
    const roundCount = rounds.length;

    // Get all scores
    const scores = await getAll(
      `SELECT rs.team_id, rs.gross, rs.nine,
              r.id as round_id,
              ROW_NUMBER() OVER (ORDER BY r.played_on ASC, r.id ASC) as round_num
       FROM round_scores rs
       JOIN rounds r ON r.id = rs.round_id
       WHERE r.league_id = $1
       ORDER BY r.played_on ASC, r.id ASC`,
      [leagueId]
    );

    // Get par totals per round per team's nine
    const teams = await getAll('SELECT * FROM teams WHERE league_id=$1', [leagueId]);
    const teamMap = {};
    teams.forEach(t => { teamMap[t.id] = t; });

    // Group scores by team
    const teamScores = {};
    scores.forEach(s => {
      if (!teamScores[s.team_id]) teamScores[s.team_id] = [];
      teamScores[s.team_id].push(s);
    });

    // Get par info from league
    const leagueRow = await getOne('SELECT front9par, back9par FROM leagues WHERE id=$1', [leagueId]);
    const front9par = JSON.parse(leagueRow?.front9par || '[4,3,4,4,4,5,3,4,5]').reduce((a,b)=>a+b,0);
    const back9par  = JSON.parse(leagueRow?.back9par  || '[4,3,4,4,4,5,3,4,5]').reduce((a,b)=>a+b,0);
    const all18par  = front9par + back9par;

    const result = {};
    teams.forEach(t => {
      const scores = teamScores[t.id] || [];
      if (!scores.length) {
        result[t.id] = { teamId: t.id, calculatedHdcp: t.handicap, roundsPlayed: 0, avgDiff: null, status: 'no_rounds', useHandicap: false };
        return;
      }

      // Calculate diff per round, applying max change cap if set
      const rawDiffs = scores.map(s => {
        const par = s.nine === 'all18' ? all18par : s.nine === 'back' ? back9par : front9par;
        return s.gross - par;
      });

      // Apply asymmetric rolling cap:
      // - Can improve (go lower) as much as calculated
      // - Can only get worse (go higher) by 1 stroke per week max
      // hdcpMaxChange applies only to the "getting worse" direction
      const worseLimit = 1; // max strokes worse per week
      let cappedDiffs = [rawDiffs[0]];
      for (let i = 1; i < rawDiffs.length; i++) {
        const prev = cappedDiffs[i - 1];
        const raw  = rawDiffs[i];
        // If getting worse (higher diff = harder), cap at prev + worseLimit
        // If getting better (lower diff = easier), allow freely
        const capped = raw > prev + worseLimit ? prev + worseLimit : raw;
        cappedDiffs.push(capped);
      }
      const avgDiff = cappedDiffs.reduce((a,b)=>a+b,0) / cappedDiffs.length;

      let calcHdcp = Math.round(avgDiff);
      let useHandicap = true;
      let status = 'active';

      if (hdcpSystem === 'establish') {
        const roundsPlayed = scores.length;
        if (roundsPlayed < hdcpEstWeeks) {
          useHandicap = false;
          status = 'establishing';
          calcHdcp = null;
        } else {
          calcHdcp = Math.round(avgDiff * (hdcpPct / 100));
          status = 'established';
        }
      }

      result[t.id] = {
        teamId: t.id,
        calculatedHdcp: calcHdcp,
        roundsPlayed: scores.length,
        avgDiff: Math.round(avgDiff * 10) / 10,  // keep 1 decimal for display
        status,
        useHandicap,
        hdcpSystem,
        hdcpEstWeeks,
        hdcpPct,
        hdcpMaxChange
      };
    });

    res.json(result);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── EMAIL LEAGUE ──
router.post('/email', requireAuth, async (req, res) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Email not configured — add RESEND_API_KEY to Render environment variables' });

    const { subject, body } = req.body || {};
    if (!subject || !body) return res.status(400).json({ error: 'Subject and body required' });

    // Get league name and all players with emails
    const league = await getOne('SELECT name, admin_email FROM leagues WHERE id=$1', [req.session.leagueId]);
    const players = await getAll(
      "SELECT email, first_name, last_name FROM users WHERE league_id=$1 AND email IS NOT NULL AND email != ''",
      [req.session.leagueId]
    );

    if (!players.length) return res.status(400).json({ error: 'No players with email addresses found' });

    const https = require('https');
    const appUrl = process.env.APP_URL || 'https://gimmepar.com';
    const fromName = (league.name || 'GimmePar') + ' League';
    // sent counted in batch loop
    // errors tracked in batch loop

    // Send one email with all recipients in BCC to avoid rate limits
    const toAddrs = players.map(p => p.email);
    const html = [
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">',
      '<div style="background:#1a2e1a;padding:16px 24px;border-radius:8px 8px 0 0;">',
      '<span style="color:#c9a84c;font-size:20px;font-weight:700;letter-spacing:2px;">⛳ ' + (league.name || 'GimmePar') + '</span>',
      '</div>',
      '<div style="border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px;">',
      '<div style="white-space:pre-wrap;color:#333;line-height:1.7;margin:16px 0;">' + body.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>',
      '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">',
      '<p style="font-size:12px;color:#888;">You are receiving this message as a member of ' + (league.name||'your league') + ' on <a href="' + appUrl + '">GimmePar</a>.</p>',
      '</div></div>'
    ].join('');

    // Resend supports up to 50 recipients per call - chunk if needed
    const chunkSize = 50;
    let sent = 0;
    let errors = [];
    for (let i = 0; i < toAddrs.length; i += chunkSize) {
      const chunk = toAddrs.slice(i, i + chunkSize);
      await new Promise((resolve) => {
        const emailBody = JSON.stringify({
          from: process.env.RESEND_FROM || 'GimmePar <onboarding@resend.dev>',
          to: chunk,
          reply_to: league.admin_email || undefined,
          subject: subject,
          html
        });
        const options = {
          hostname: 'api.resend.com', path: '/emails', method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(emailBody) }
        };
        const req2 = https.request(options, (r) => {
          let d = ''; r.on('data', c => d += c);
          r.on('end', () => {
            console.log('Batch email to', chunk.length, 'recipients, status:', r.statusCode, d);
            if (r.statusCode >= 200 && r.statusCode < 300) sent += chunk.length;
            else errors.push('Batch ' + i + ': ' + r.statusCode + ' ' + d);
            resolve();
          });
        });
        req2.on('error', (e) => { errors.push('Batch ' + i + ': ' + e.message); resolve(); });
        req2.write(emailBody); req2.end();
      });
    }

    res.json({ success: true, sent, errors: errors.length ? errors : undefined });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── RANDOM DRAW HISTORY ──
// Track which players have been paired together to avoid repeat pairings
router.get('/draw/history', requireAuth, async (req, res) => {
  try {
    const rows = await getAll(
      'SELECT matchups FROM schedule_weeks WHERE league_id=$1 ORDER BY week_number',
      [req.session.leagueId]
    );
    // Build a set of previous pairings: "idA-idB" (sorted)
    const pairings = new Set();
    rows.forEach(row => {
      const matchups = JSON.parse(row.matchups);
      matchups.forEach(m => {
        if (m.teamAId && m.teamBId) {
          const key = [Math.min(m.teamAId, m.teamBId), Math.max(m.teamAId, m.teamBId)].join('-');
          pairings.add(key);
        }
      });
    });
    res.json([...pairings]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LIVE SCORE POLLING ──
// Returns the most recent round score for a team (for opponent live updates)
router.get('/scores/latest/:teamId', requireAuth, async (req, res) => {
  try {
    const row = await getOne(
      `SELECT rs.hole_scores, rs.gross, rs.net, rs.handicap_used, rs.nine, r.played_on
       FROM round_scores rs
       JOIN rounds r ON r.id = rs.round_id
       WHERE r.league_id = $1 AND rs.team_id = $2
       ORDER BY r.played_on DESC, r.id DESC
       LIMIT 1`,
      [req.session.leagueId, req.params.teamId]
    );
    if (!row) return res.json({ found: false });
    res.json({
      found: true,
      hole_scores: JSON.parse(row.hole_scores || '[]'),
      gross: row.gross,
      net: row.net,
      handicap_used: row.handicap_used,
      nine: row.nine,
      played_on: row.played_on
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LOG SUBSTITUTE ──
router.post('/rounds/:roundId/sub', requireAuth, async (req, res) => {
  try {
    const { team_id, sub_name, replaced_name } = req.body || {};
    if (!team_id || !sub_name) return res.status(400).json({ error: 'Team and sub name required' });

    // Verify round belongs to this league
    const round = await getOne('SELECT id FROM rounds WHERE id=$1 AND league_id=$2', [req.params.roundId, req.session.leagueId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });

    // Check if a score row already exists for this team in this round
    const existing = await getOne('SELECT id, sub_name FROM round_scores WHERE round_id=$1 AND team_id=$2', [req.params.roundId, team_id]);

    if (existing) {
      // Update existing row to mark as sub
      await query(
        'UPDATE round_scores SET is_sub=TRUE, sub_name=$1 WHERE round_id=$2 AND team_id=$3',
        [sub_name + (replaced_name ? ' (for ' + replaced_name + ')' : ''), req.params.roundId, team_id]
      );
    } else {
      // Insert a new score row with sub flag and zero scores
      await query(
        `INSERT INTO round_scores (round_id, team_id, nine, handicap_used, hole_scores, gross, net, is_sub, sub_name)
         VALUES ($1,$2,'front',0,'[]',0,0,TRUE,$3)`,
        [req.params.roundId, team_id, sub_name + (replaced_name ? ' (for ' + replaced_name + ')' : '')]
      );
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SIGN SCORECARD ──
router.post('/scorecard/sign', requireAuth, async (req, res) => {
  try {
    const { team_id, week_number, hole_scores, gross, net, handicap_used, nine, signed_by } = req.body || {};
    if (!team_id || !week_number) return res.status(400).json({ error: 'team_id and week_number required' });
    await query(
      `INSERT INTO signed_scorecards (league_id, team_id, week_number, hole_scores, gross, net, handicap_used, nine, signed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (league_id, team_id, week_number) DO UPDATE
       SET hole_scores=$4, gross=$5, net=$6, handicap_used=$7, nine=$8, signed_by=$9, signed_at=NOW()`,
      [req.session.leagueId, team_id, week_number, JSON.stringify(hole_scores||[]), gross||0, net||0, handicap_used||0, nine||'front', signed_by||'']
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get all signed scorecards for current week (for admin view)
router.get('/scorecard/signed', requireAuth, async (req, res) => {
  try {
    const rows = await getAll(
      `SELECT ss.*, t.player1, t.player2
       FROM signed_scorecards ss
       JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = $1
       ORDER BY ss.week_number DESC, ss.signed_at DESC`,
      [req.session.leagueId]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
