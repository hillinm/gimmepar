# ⛳ GimmePar

Multi-league golf tournament scoring app with login, roster management, course setup, and results.

## Features
- **Multi-league login** — each league has its own account, roster, and course
- **Team roster** — save player names and handicaps, auto-loads each week
- **Course setup** — search by name (AI-powered) or enter par manually
- **Scoring** — hole-by-hole entry with live totals and color coding
- **Results** — A/B Flight winners (net), skins with carryovers, full scoreboard
- **Handicap adjustment** — override any team's handicap after the round and recalculate
- **Round history** — saves each round for reference
- **CSV export** — download results spreadsheet

---

## Deploy to Render (Free)

### 1. Push to GitHub
```bash
cd golf-app
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/golf-scorer.git
git push -u origin main
```

### 2. Deploy on Render
1. Go to [render.com](https://render.com) and sign up (free)
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — click **Deploy**
5. Your app will be live at `https://gimmepar.onrender.com` (or similar)

### 3. First Use
- Open the app URL
- Click **Create one** to register your league with a name and password
- Go to **Course** tab and search for your course
- Go to **Roster** tab and add your teams
- Hit **Save Roster** — handicaps will pre-fill every week

---

## Run Locally
```bash
npm install
node server.js
# Open http://localhost:3000
```

---

## Notes
- **Database**: SQLite file at `data/golf.db` — backs up automatically on Render's disk
- **Sessions**: Stored in `data/sessions.db`, last 7 days
- **Free Render tier**: App sleeps after 15 min inactivity, wakes in ~30 seconds on next visit
- **Upgrade**: For always-on hosting, upgrade to Render's $7/mo plan

---

## Stack
- **Backend**: Node.js + Express
- **Database**: SQLite (via better-sqlite3)
- **Auth**: bcrypt password hashing + server-side sessions
- **Frontend**: Vanilla JS SPA (no framework)
