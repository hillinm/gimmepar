$file = "C:\Users\MarkHillin\Projects\gimmepar\golf-app\public\index.html"
$content = Get-Content $file -Raw

# Check if already patched
if ($content -match "signScorecardArea") {
    Write-Host "Already patched!" -ForegroundColor Green
    exit
}

# Find and replace the calculate button block with sign scorecard
$old = @'
  // Calculate button
  var calcBtn = document.createElement('button');
  calcBtn.className = 'btn-calculate';
  calcBtn.style.marginTop = '20px';
  calcBtn.innerHTML = '&#9971; CALCULATE RESULTS';
  calcBtn.onclick = calculate;
  container.appendChild(calcBtn);
}
'@

$new = @'
  // Sign Scorecard button
  var signArea = document.createElement('div');
  signArea.id = 'signScorecardArea';
  signArea.style.cssText = 'margin-top:24px;';
  var alreadySigned = false;
  var activeWeek = (typeof curr !== 'undefined' && curr && curr.currentWeek) ? curr.currentWeek : 1;
  try {
    var signedList = await api('GET', '/api/league/scorecard/signed');
    var mySig = signedList.find(function(s) { return s.team_id === team.id && s.week_number === activeWeek; });
    if (mySig) alreadySigned = true;
  } catch(e) {}
  if (alreadySigned) {
    signArea.innerHTML = '<div style="background:#d4f7d4;border:2px solid #1a6e12;border-radius:10px;padding:16px 20px;text-align:center;font-weight:700;color:#1a4e10;font-size:18px;">&#x2705; Scorecard Signed &amp; Submitted</div>';
  } else {
    var signBtn = document.createElement('button');
    signBtn.id = 'signScorecardBtn';
    signBtn.style.cssText = 'width:100%;background:#1a2e1a;color:#fff;font-family:"Bebas Neue",sans-serif;font-size:22px;letter-spacing:3px;padding:16px;border:none;border-radius:12px;cursor:pointer;margin-bottom:8px;box-shadow:0 6px 20px rgba(0,0,0,.3);';
    signBtn.textContent = '\u270D SIGN SCORECARD';
    signBtn.onclick = function() { signScorecard(team, scoreTeams[0], activeWeek); };
    var signNote = document.createElement('div');
    signNote.style.cssText = 'text-align:center;font-size:12px;color:#555;margin-top:4px;';
    signNote.textContent = 'By signing, you confirm your scores are accurate and final.';
    signArea.appendChild(signBtn);
    signArea.appendChild(signNote);
  }
  container.appendChild(signArea);
}

async function signScorecard(team, st, weekNum) {
  if (!weekNum) { alert('No active week found. Contact your league admin.'); return; }
  var btn = document.getElementById('signScorecardBtn');
  var count = (st.nine === 'all18') ? 18 : 9;
  var holes = [];
  var allFilled = true;
  for (var i = 0; i < count; i++) {
    var inp = document.getElementById('shole_' + team.id + '_' + i);
    var val = inp ? parseInt(inp.value) : null;
    if (!val) allFilled = false;
    holes.push(val || 0);
  }
  if (!allFilled) { if (!confirm('Some holes are empty. Sign scorecard anyway?')) return; }
  var gross = holes.reduce(function(a,b){return a+b;}, 0);
  var hdcpEl = document.getElementById('shdcp_' + team.id);
  var hdcp = hdcpEl ? (parseInt(hdcpEl.value)||0) : 0;
  var net = gross - hdcp;
  if (btn) { btn.textContent = 'Submitting...'; btn.disabled = true; }
  try {
    await api('POST', '/api/league/scorecard/sign', {
      team_id: team.id, week_number: weekNum, hole_scores: holes,
      gross: gross, net: net, handicap_used: hdcp, nine: st.nine || 'front', signed_by: 'Player'
    });
    var area = document.getElementById('signScorecardArea');
    if (area) area.innerHTML = '<div style="background:#d4f7d4;border:2px solid #1a6e12;border-radius:10px;padding:16px 20px;text-align:center;font-weight:700;color:#1a4e10;font-size:18px;">&#x2705; Scorecard Signed &amp; Submitted</div>';
  } catch(e) {
    if (btn) { btn.textContent = '\u270D SIGN SCORECARD'; btn.disabled = false; }
    alert('Error: ' + e.message);
  }
}
'@

if ($content -match [regex]::Escape("calcBtn.onclick = calculate;")) {
    $content = $content.Replace($old, $new)
    Set-Content $file $content -NoNewline
    Write-Host "SUCCESS - Sign Scorecard button added!" -ForegroundColor Green
} else {
    Write-Host "ERROR - Could not find calculate button block to replace" -ForegroundColor Red
    Write-Host "Searching for nearby text..." -ForegroundColor Yellow
    if ($content -match "CALCULATE RESULTS") {
        Write-Host "Found CALCULATE RESULTS in file" -ForegroundColor Yellow
    } else {
        Write-Host "CALCULATE RESULTS not found either - file may be very different" -ForegroundColor Red
    }
}
