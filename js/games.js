/* Oddaroa casino games — screens and animation engines.
   Every outcome is decided by the server (/api/games/*); this file
   only presents and animates what the server returns. Loaded after
   app.js and driven through two hooks there: render() calls
   OddaroaGames.destroy() before swapping views and
   OddaroaGames.afterRender() after. */
(function () {
  'use strict';
  const META = {
    'Aviator': { id: 'aviator', tag: 'Cash out before it flies away' },
    'Plinko X': { id: 'plinko', tag: 'Drop the ball, chase the edges' },
    'Lucky Dice': { id: 'dice', tag: 'Call the total of two dice' },
    'Penalty Shootout': { id: 'shootout', tag: 'Five kicks, one ladder' },
    'Coin Flip': { id: 'coinflip', tag: 'Crest or Coin at 1.94x' },
    'Football Penalty': { id: 'penalty', tag: 'Beat the keeper, one kick' },
  };
  const PENALTY_PRICES = [1.44, 1.30, 1.44, 1.45, 1.28, 1.45]; // display mirror of api/_games.js
  const ZONE_NAMES = ['Top Left', 'Top Middle', 'Top Right', 'Bottom Left', 'Bottom Middle', 'Bottom Right'];

  let S = null; // live screen state, torn down on every view change
  function teardown() {
    if (!S) return;
    (S.timers || []).forEach(clearInterval);
    (S.timeouts || []).forEach(clearTimeout);
    if (S.raf) cancelAnimationFrame(S.raf);
    S = null;
  }
  function fresh(extra) {
    teardown();
    S = Object.assign({ timers: [], timeouts: [], raf: 0, busy: false, round: null }, extra || {});
    return S;
  }
  const $g = (sel) => document.querySelector(sel);
  const later = (fn, ms) => { S.timeouts.push(setTimeout(fn, ms)); };
  const every = (fn, ms) => { S.timers.push(setInterval(fn, ms)); };

  function setBalance(b) {
    if (typeof b === 'number' && state.user) {
      state.user.balance_ghs = b;
      if (typeof syncHeader === 'function') syncHeader();
      const chip = $g('#gBal');
      if (chip) chip.textContent = money(b);
    }
  }
  function banner(kind, html) {
    const b = $g('#gBanner');
    if (!b) return;
    b.className = 'gbanner ' + kind;
    b.innerHTML = html;
  }
  function shell(name, stageHTML, panelHTML) {
    const m = META[name];
    return '<button class="gback" data-gback>← All games</button>' +
      '<div class="ghead"><h2>' + esc(name) + '</h2><span class="gbal" id="gBal">' +
      (state.user ? money(state.user.balance_ghs) : '') + '</span></div>' +
      '<p class="gtagline">' + esc(m.tag) + '</p>' +
      '<div class="gstage card">' + stageHTML + '</div>' +
      '<div class="gbanner" id="gBanner"></div>' +
      '<div class="gpanel card">' + panelHTML + '</div>' +
      '<div class="ghist card"><h3>Your recent rounds</h3><div id="gHistory"><p class="empty">Loading…</p></div></div>';
  }
  function stakeHTML(def) {
    return '<label class="glabel">Stake (GHS)</label>' +
      '<div class="gstake"><button type="button" class="gstep" data-step="-1">−</button>' +
      '<input id="gStake" type="number" min="1" max="1000" step="1" value="' + def + '">' +
      '<button type="button" class="gstep" data-step="1">+</button></div>' +
      '<div class="gchips">' + [2, 5, 10, 25, 50, 100].map(v =>
        '<button type="button" class="gchip" data-chip="' + v + '">' + v + '</button>').join('') +
      '<button type="button" class="gchip" data-scale="0.5">½</button>' +
      '<button type="button" class="gchip" data-scale="2">2×</button></div>';
  }
  function bindStake() {
    const input = $g('#gStake');
    document.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.chip; input.dispatchEvent(new Event('input')); }));
    document.querySelectorAll('[data-scale]').forEach(b => b.addEventListener('click', () => {
      const v = Math.min(1000, Math.max(1, Math.round((Number(input.value) || 0) * Number(b.dataset.scale) * 100) / 100));
      input.value = v;
      input.dispatchEvent(new Event('input'));
    }));
    document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const v = Math.min(1000, Math.max(1, (Number(input.value) || 0) + Number(b.dataset.step) * 5));
      input.value = v;
      input.dispatchEvent(new Event('input'));
    }));
  }
  const stakeVal = () => Math.round(Number($g('#gStake').value) * 100) / 100;
  function segHTML(id, opts, cur) {
    return '<div class="gseg" id="' + id + '">' + opts.map(o =>
      '<button type="button" class="gseg-btn' + (o.v === cur ? ' on' : '') + '" data-v="' + o.v + '">' + o.t + '</button>').join('') + '</div>';
  }
  function bindSeg(id, fn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll('.gseg-btn').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('.gseg-btn').forEach(x => x.classList.toggle('on', x === b));
      fn(b.dataset.v);
    }));
  }
  const segVal = (id) => { const b = document.querySelector('#' + id + ' .gseg-btn.on'); return b ? b.dataset.v : null; };

  async function loadHistory(gameId) {
    const box = $g('#gHistory');
    if (!box) return;
    try {
      const d = await api('/games/history?game=' + gameId);
      if (!S) return;
      S.recent = d.recent || [];
      if (!d.mine.length) { box.innerHTML = '<p class="empty">No rounds yet — your results will land here.</p>'; return; }
      box.innerHTML = d.mine.map(r => {
        const mult = r.stake > 0 && r.payout > 0 ? ' · ' + (r.payout / r.stake).toFixed(2) + 'x' : '';
        const res = r.status === 'open' ? '<b class="g-live">In play</b>'
          : r.payout > 0 ? '<b class="g-win">+' + money(r.payout) + '</b>' : '<b class="g-lose">−' + money(r.stake) + '</b>';
        return '<div class="ghrow"><span>' + new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) +
          '</span><span>Stake ' + money(r.stake) + mult + '</span>' + res + '</div>';
      }).join('');
      if (typeof S.onHistory === 'function') S.onHistory();
    } catch (e) { if (box) box.innerHTML = '<p class="empty">History unavailable right now.</p>'; }
  }

  async function startRound(gameId, config) {
    const stake = stakeVal();
    if (!(stake >= 1 && stake <= 1000)) { toast('Stake must be between GHS 1 and GHS 1,000'); return null; }
    try {
      const d = await api('/games/start', { method: 'POST', body: { game: gameId, stake_ghs: stake, config } });
      setBalance(d.balance);
      return d;
    } catch (e) {
      if (e.code === 'insufficient_balance') toast('Not enough balance — top up in Wallet');
      else if (e.code === 'too_fast') toast('Slow down a moment, then play again');
      else toast('Could not start the round — try again');
      return null;
    }
  }

  /* ---------------- Aviator ---------------- */
  function aviatorScreen() {
    return shell('Aviator',
      '<div class="av-wrap">' +
      '<div class="av-history"><span>Previous flights</span><div class="av-crashes" id="avCrashes"></div></div>' +
      '<div class="av-stagebox"><canvas id="avCanvas" width="760" height="460"></canvas>' +
      '<div class="av-mult" id="avMult">1.00x</div>' +
      '<div class="av-flew" id="avFlew">FLEW AWAY!</div>' +
      '<div class="av-status" id="avStatus">Set your stake and take off</div></div>' +
      '<div class="av-feed"><div class="av-feed-head"><span>Latest flights</span><span>Stake</span><span>Result</span></div><div id="avFeed"><p class="av-feed-empty">Flight results will appear here.</p></div></div></div>',
      stakeHTML(10) +
      '<label class="glabel">Auto cash out</label>' +
      '<div class="gauto"><label class="gswitch"><input type="checkbox" id="avAutoOn"><span></span></label>' +
      '<input id="avAutoVal" type="number" min="1.01" max="500" step="0.1" value="2.0" disabled><span class="av-auto-note">Cash out automatically at this multiplier</span></div>' +
      '<button class="btn gold big av-bet-btn" id="avLaunch">BET</button>' +
      '<button class="btn big g-cash av-cash-btn" id="avCash" hidden>Cash Out</button>' +
      '<p class="gnote2">The flight is fixed before takeoff — its hash is shown on every round and the seed is revealed after, so the crash point can be verified.</p>');
  }
  function aviatorMount() {
    fresh({ game: 'aviator' });
    bindStake();
    const cv = $g('#avCanvas'), ctx = cv.getContext('2d');
    const launchBtn = $g('#avLaunch'), cashBtn = $g('#avCash');
    const paintBetLabel = () => { if (!S.flying) launchBtn.textContent = 'BET ' + money(stakeVal() || 0); };
    $g('#gStake').addEventListener('input', paintBetLabel);
    paintBetLabel();
    $g('#avAutoOn').addEventListener('change', (e) => { $g('#avAutoVal').disabled = !e.target.checked; });
    const stageCard = $g('#avCanvas') && $g('#avCanvas').closest('.gstage');
    if (stageCard) stageCard.classList.add('av-stage-card');
    const panelCard = $g('#avLaunch') && $g('#avLaunch').closest('.gpanel');
    if (panelCard) panelCard.classList.add('av-panel');
    S.onHistory = () => {
      const strip = $g('#avCrashes');
      if (!strip || !S.recent) return;
      const flights = S.recent.filter(r => r.game === 'aviator');
      const crashes = flights.filter(r => r.crash != null).slice(0, 10);
      strip.innerHTML = crashes.map(r => '<span class="av-chip' + (r.crash < 2 ? ' low' : r.crash >= 10 ? ' hot' : '') + '">' + Number(r.crash).toFixed(2) + 'x</span>').join('');
      const feed = $g('#avFeed');
      if (feed) {
        const rows = flights.slice(0, 6);
        feed.innerHTML = rows.length ? rows.map(r => {
          const result = r.payout > 0
            ? '<b class="g-win">' + (r.stake ? (r.payout / r.stake).toFixed(2) : '0.00') + 'x · ' + money(r.payout) + '</b>'
            : '<b class="g-lose">' + Number(r.crash || 1).toFixed(2) + 'x</b>';
          return '<div class="av-feed-row"><span>' + esc(r.who || 'Player') + '</span><span>' + money(r.stake) + '</span>' + result + '</div>';
        }).join('') : '<p class="av-feed-empty">Flight results will appear here.</p>';
      }
    };
    loadHistory('aviator');

    function flightPoint(ms, m) {
      const W = cv.width, H = cv.height;
      const progress = 1 - Math.exp(-Math.max(0, ms) / 11500);
      const x = 52 + (W - 118) * progress;
      const lift = Math.min(0.98, Math.log(Math.max(1, m)) / Math.log(14));
      const y = (H - 54) - (H - 132) * lift;
      return { x, y };
    }
    function drawPlane(x, y, angle, elapsed, crashed, alpha) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = alpha == null ? 1 : alpha;
      // Original red propeller plane, drawn from simple shapes.
      const body = ctx.createLinearGradient(0, -14, 0, 14);
      body.addColorStop(0, crashed ? '#ff6b74' : '#ff4d4d');
      body.addColorStop(0.55, crashed ? '#d8232a' : '#e52b2b');
      body.addColorStop(1, '#8f1116');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(38, 0); ctx.bezierCurveTo(24, -11, -8, -13, -28, -7);
      ctx.bezierCurveTo(-38, -4, -38, 5, -27, 8); ctx.bezierCurveTo(-6, 13, 25, 10, 38, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a31219';
      ctx.beginPath(); ctx.moveTo(-28, -5); ctx.lineTo(-43, -24); ctx.lineTo(-34, -25); ctx.lineTo(-18, -8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-27, 6); ctx.lineTo(-43, 17); ctx.lineTo(-35, 18); ctx.lineTo(-18, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7d0d12';
      ctx.beginPath(); ctx.moveTo(3, 2); ctx.lineTo(-16, 24); ctx.lineTo(-5, 25); ctx.lineTo(15, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#bfe9ff';
      ctx.beginPath(); ctx.ellipse(8, -8, 11, 5.5, -0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111820';
      ctx.beginPath(); ctx.arc(-12, 13, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.82)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      const spin = Math.sin(elapsed / 28) * 15;
      ctx.beginPath(); ctx.moveTo(40, -15 + spin * 0.25); ctx.lineTo(40, 15 - spin * 0.25); ctx.stroke();
      ctx.fillStyle = '#f5c518'; ctx.beginPath(); ctx.arc(39, 0, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    function draw(elapsed, mult, crashed, opts) {
      opts = opts || {};
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      const sky = ctx.createRadialGradient(54, H - 54, 20, 54, H - 54, W * 1.05);
      sky.addColorStop(0, '#23352a'); sky.addColorStop(0.34, '#111c15'); sky.addColorStop(1, '#050807');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      // Slow rotating fan of light from the take-off corner — the
      // living background the reference crash games are known for,
      // rendered here in Oddaroa's own green, gold and red.
      ctx.save(); ctx.translate(52, H - 54); ctx.rotate((elapsed / 90000) % (Math.PI * 2));
      for (let i = 0; i < 28; i++) {
        const a0 = (i / 28) * Math.PI * 2, a1 = ((i + 1) / 28) * Math.PI * 2;
        ctx.fillStyle = i % 4 === 0 ? 'rgba(245,197,24,.055)' : i % 4 === 2 ? 'rgba(255,71,87,.045)' : 'rgba(90,180,120,.045)';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, W * 1.15, a0, a1); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      [[92, 58], [188, 112], [646, 64], [556, 138], [690, 196], [238, 44]].forEach(([sx, sy], i) => {
        ctx.globalAlpha = 0.16 + (i % 3) * 0.08; ctx.beginPath(); ctx.arc(sx, sy, i % 2 ? 1.4 : 2, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      const steps = 42, pts = [];
      for (let i = 0; i <= steps; i++) {
        const e = elapsed * i / steps;
        pts.push(flightPoint(e, Math.exp(0.1 * Math.max(0, e) / 1000)));
      }
      const head = opts.head || flightPoint(elapsed, mult);
      const under = ctx.createLinearGradient(0, 70, 0, H);
      under.addColorStop(0, crashed ? 'rgba(255,71,87,.20)' : 'rgba(245,197,24,.16)');
      under.addColorStop(1, 'rgba(245,197,24,0)');
      ctx.fillStyle = under;
      ctx.beginPath(); ctx.moveTo(pts[0].x, H - 54);
      pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(head.x, H - 54); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = crashed ? '#ff4757' : '#f03d3d';
      ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = crashed ? 'rgba(255,71,87,.65)' : 'rgba(240,61,61,.6)'; ctx.shadowBlur = 12;
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.shadowBlur = 0;
      const prev = pts[pts.length - 2] || pts[0];
      const angle = Math.atan2(head.y - prev.y, head.x - prev.x);
      drawPlane(head.x, head.y, angle, elapsed, crashed, opts.alpha);
      // Runway marks at the take-off corner.
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      for (let i = 0; i < 5; i++) ctx.fillRect(18 + i * 19, H - 24, 10, 3);
    }
    draw(0, 1, false);

    function finish(round, cashedMult) {
      S.flying = false;
      cancelAnimationFrame(S.raf);
      clearInterval(S.poll);
      launchBtn.hidden = false; cashBtn.hidden = true;
      const multEl = $g('#avMult'), st = $g('#avStatus'), flew = $g('#avFlew');
      if (round.status === 'cashed' || round.status === 'won') {
        multEl.classList.add('won');
        if (flew) flew.classList.remove('on');
        st.textContent = 'Cashed out at ' + Number(cashedMult || round.cashed_at || 0).toFixed(2) + 'x';
        banner('win', 'You cashed out — <b>' + money(round.payout) + '</b> landed in your wallet.');
      } else {
        const crash = Number(round.crash || 1);
        multEl.textContent = crash.toFixed(2) + 'x';
        multEl.classList.add('crashed');
        if (flew) flew.classList.add('on');
        st.textContent = 'Flew away at ' + crash.toFixed(2) + 'x';
        banner('lose', 'The plane flew away at <b>' + crash.toFixed(2) + 'x</b>. Your stake is gone — launch again when ready.');
        // Let the plane visibly escape instead of freezing on the
        // crash frame: half a second of flight beyond the curve.
        const crashMs = Math.log(crash) / 0.1 * 1000;
        const base = flightPoint(crashMs, crash);
        const t0 = performance.now();
        const escape = (now) => {
          if (!S) return;
          const f = Math.min(1, (now - t0) / 520);
          draw(crashMs, crash, true, {
            head: { x: base.x + f * 230, y: base.y - f * 92 },
            alpha: 1 - f * 0.75,
          });
          if (f < 1) S.raf = requestAnimationFrame(escape);
        };
        S.raf = requestAnimationFrame(escape);
      }
      S.round = null;
      loadHistory('aviator');
    }

    async function pollStatus() {
      if (!S.round) return;
      try {
        const d = await api('/games/status?round_id=' + S.round.id);
        setBalance(d.balance);
        if (d.round.status !== 'open') finish(d.round, d.round.cashed_at);
      } catch (e) { /* next tick retries */ }
    }

    launchBtn.addEventListener('click', async () => {
      if (S.busy || S.flying) return;
      S.busy = true; launchBtn.disabled = true;
      const auto = $g('#avAutoOn').checked ? Number($g('#avAutoVal').value) : null;
      const d = await startRound('aviator', { auto_cashout: auto });
      S.busy = false; launchBtn.disabled = false;
      if (!d) return;
      S.round = d.round; S.flying = true; S.stake = Number(d.round.stake) || stakeVal();
      S.offset = (d.server_now || Date.now()) - Date.now();
      S.startedAt = new Date(d.round.started_at).getTime();
      S.auto = auto;
      const multEl = $g('#avMult'), st = $g('#avStatus'), flew = $g('#avFlew');
      multEl.classList.remove('won', 'crashed');
      if (flew) flew.classList.remove('on');
      cashBtn.hidden = false; launchBtn.hidden = true;
      banner('', '');
      st.textContent = 'Flying…';
      const tick = () => {
        if (!S || !S.flying) return;
        const elapsed = Date.now() + S.offset - S.startedAt;
        const m = Math.exp(0.1 * Math.max(0, elapsed) / 1000);
        const shown = Math.floor(m * 100) / 100;
        multEl.textContent = shown.toFixed(2) + 'x';
        cashBtn.textContent = 'Cash Out ' + money((S.stake || stakeVal()) * shown);
        draw(elapsed, shown, false);
        if (S.auto && shown >= S.auto && !S.cashing) {
          S.cashing = true;
          api('/games/cashout', { method: 'POST', body: { round_id: S.round.id } })
            .then(r => { setBalance(r.balance); finish(r.round, S.auto); })
            .catch(() => { S.cashing = false; });
        }
        S.raf = requestAnimationFrame(tick);
      };
      tick();
      S.poll = setInterval(pollStatus, 700);
      S.timers.push(S.poll);
    });
    cashBtn.addEventListener('click', async () => {
      if (!S.round || S.cashing) return;
      S.cashing = true; cashBtn.disabled = true;
      try {
        const d = await api('/games/cashout', { method: 'POST', body: { round_id: S.round.id } });
        setBalance(d.balance);
        finish(d.round, d.round.cashed_at);
      } catch (e) { toast('Cash out failed — the flight is still live'); S.cashing = false; cashBtn.disabled = false; }
    });
  }

  /* ---------------- Plinko X ---------------- */
  const PLINKO_TABLES = {
    8: { low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
    12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10], medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33], high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170] },
    16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000] },
  };
  function plinkoScreen() {
    return shell('Plinko X',
      '<div class="pl-wrap"><canvas id="plCanvas" width="720" height="540"></canvas></div>',
      '<label class="glabel">Rows</label>' + segHTML('plRows', [{ v: '8', t: '8' }, { v: '12', t: '12' }, { v: '16', t: '16' }], '12') +
      '<label class="glabel">Risk</label>' + segHTML('plRisk', [{ v: 'low', t: 'Low' }, { v: 'medium', t: 'Medium' }, { v: 'high', t: 'High' }], 'medium') +
      stakeHTML(5) +
      '<button class="btn gold big" id="plDrop">Drop Ball</button>' +
      '<p class="gnote2">Edge slots pay the most because the ball rarely lands there — the path is rolled on the server before the ball drops.</p>');
  }
  function plinkoMount() {
    fresh({ game: 'plinko' });
    bindStake();
    const cv = $g('#plCanvas'), ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    function geometry(rows) {
      const dx = (W - 80) / (rows + 1), topY = 56, dy = (H - 130) / rows;
      return { dx, topY, dy, cx: W / 2 };
    }
    function slotColor(m) {
      if (m >= 10) return '#f5c518';
      if (m >= 2) return '#2fbf71';
      if (m >= 1) return '#3d5a48';
      if (m >= 0.5) return '#5a4632';
      return '#6e2f35';
    }
    function draw(ball) {
      const rows = Number(segVal('plRows')), risk = segVal('plRisk');
      const table = PLINKO_TABLES[rows][risk], g = geometry(rows);
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a1510'); bg.addColorStop(1, '#12241a');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#dfe9df';
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k <= r; k++) {
          const x = g.cx + (k - r / 2) * g.dx, y = g.topY + r * g.dy;
          ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
        }
      }
      const slotY = g.topY + rows * g.dy + 14, slotH = 34;
      table.forEach((m, i) => {
        const x = g.cx + (i - rows / 2) * g.dx - g.dx / 2 + 2;
        ctx.fillStyle = slotColor(m);
        ctx.beginPath(); ctx.roundRect(x, slotY, g.dx - 4, slotH, 6); ctx.fill();
        ctx.fillStyle = m >= 1 ? '#0b100d' : '#e8e2d0';
        if (m < 1) ctx.fillStyle = '#f2e9d8';
        ctx.font = '700 ' + Math.max(10, Math.min(15, g.dx * 0.34)) + 'px system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(m + 'x', x + (g.dx - 4) / 2, slotY + slotH / 2 + 1);
      });
      if (ball) {
        ctx.fillStyle = '#f5c518';
        ctx.shadowColor = 'rgba(245,197,24,.7)'; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(ball.x, ball.y, 10, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
      }
      S.geo = g; S.slotY = slotY;
    }
    draw(null);
    bindSeg('plRows', () => draw(null));
    bindSeg('plRisk', () => draw(null));
    loadHistory('plinko');

    $g('#plDrop').addEventListener('click', async () => {
      if (S.busy) return;
      S.busy = true;
      const btn = $g('#plDrop'); btn.disabled = true;
      const rows = Number(segVal('plRows')), risk = segVal('plRisk');
      const d = await startRound('plinko', { rows, risk });
      if (!d) { S.busy = false; btn.disabled = false; return; }
      const { path, slot } = d.round.result, g = geometry(rows);
      const stake = d.round.stake;
      // Waypoints: at step s the ball sits above row s, drifting with
      // the rights it has taken so far; arcs between them sell the bounce.
      const pts = [{ x: g.cx, y: 18 }];
      let rights = 0;
      for (let s = 0; s < rows; s++) {
        rights += path[s];
        pts.push({ x: g.cx + (rights - (s + 1) / 2) * g.dx, y: g.topY + s * g.dy - 6 });
      }
      pts.push({ x: g.cx + (slot - rows / 2) * g.dx, y: S.slotY + 17 });
      const stepMs = 105, total = stepMs * (pts.length - 1);
      const t0 = performance.now();
      const frame = (now) => {
        if (!S) return;
        const t = Math.min(1, (now - t0) / total);
        const pos = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(pos)), f = pos - i;
        const a = pts[i], b = pts[i + 1];
        const x = a.x + (b.x - a.x) * f;
        const y = a.y + (b.y - a.y) * f - Math.sin(f * Math.PI) * 13;
        draw({ x, y });
        if (t < 1) { S.raf = requestAnimationFrame(frame); return; }
        draw({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
        const mult = PLINKO_TABLES[rows][risk][slot];
        if (d.round.payout > 0) banner(mult >= 1 ? 'win' : 'lose', 'Slot <b>' + mult + 'x</b> — you got back <b>' + money(d.round.payout) + '</b> on ' + money(stake) + '.');
        else banner('lose', 'The ball found a dead slot — <b>' + money(stake) + '</b> gone. The edges pay for a reason.');
        setBalance(d.balance);
        S.busy = false; btn.disabled = false;
        loadHistory('plinko');
      };
      S.raf = requestAnimationFrame(frame);
    });
  }

  /* ---------------- Lucky Dice ---------------- */
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieHTML(face) {
    let cells = '';
    for (let i = 0; i < 9; i++) cells += '<span class="pip' + (PIPS[face].includes(i) ? ' on' : '') + '"></span>';
    return '<div class="die">' + cells + '</div>';
  }
  function diceScreen() {
    return shell('Lucky Dice',
      '<div class="dice-row"><div id="dieA">' + dieHTML(3) + '</div><div class="dice-plus">+</div><div id="dieB">' + dieHTML(4) + '</div><div class="dice-total" id="diceTotal">7</div></div>' +
      '<p class="dice-hint" id="diceHint">Two dice. Call where the total lands.</p>',
      '<label class="glabel">Your call</label>' +
      '<div class="dice-picks" id="dicePicks">' +
      '<button type="button" class="dpick on" data-pick="under"><b>Under 7</b><span>2 – 6 · 2.33x</span></button>' +
      '<button type="button" class="dpick" data-pick="seven"><b>Lucky 7</b><span>exactly 7 · 5.82x</span></button>' +
      '<button type="button" class="dpick" data-pick="over"><b>Over 7</b><span>8 – 12 · 2.33x</span></button></div>' +
      stakeHTML(5) +
      '<button class="btn gold big" id="diceRoll">Roll Dice</button>');
  }
  function diceMount() {
    fresh({ game: 'dice' });
    bindStake();
    loadHistory('dice');
    document.querySelectorAll('#dicePicks .dpick').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#dicePicks .dpick').forEach(x => x.classList.toggle('on', x === b));
    }));
    $g('#diceRoll').addEventListener('click', async () => {
      if (S.busy) return;
      S.busy = true;
      const btn = $g('#diceRoll'); btn.disabled = true;
      const pick = document.querySelector('#dicePicks .dpick.on').dataset.pick;
      const d = await startRound('dice', { pick });
      if (!d) { S.busy = false; btn.disabled = false; return; }
      const { d1, d2, total } = d.round.result;
      const a = $g('#dieA'), b2 = $g('#dieB');
      a.classList.add('tumbling'); b2.classList.add('tumbling');
      let n = 0;
      const spin = setInterval(() => {
        a.innerHTML = dieHTML(1 + Math.floor(Math.random() * 6));
        b2.innerHTML = dieHTML(1 + Math.floor(Math.random() * 6));
        if (++n >= 9) {
          clearInterval(spin);
          a.classList.remove('tumbling'); b2.classList.remove('tumbling');
          a.innerHTML = dieHTML(d1); b2.innerHTML = dieHTML(d2);
          $g('#diceTotal').textContent = total;
          if (d.round.payout > 0) banner('win', 'Total <b>' + total + '</b> — your call landed. <b>' + money(d.round.payout) + '</b> is in your wallet.');
          else banner('lose', 'Total <b>' + total + '</b> — your call missed. <b>' + money(d.round.stake) + '</b> gone.');
          setBalance(d.balance);
          S.busy = false; btn.disabled = false;
          loadHistory('dice');
        }
      }, 80);
      S.timers.push(spin);
    });
  }

  /* ---------------- Coin Flip ---------------- */
  function coinScreen() {
    return shell('Coin Flip',
      '<div class="coin-scene"><div class="coin" id="coin"><div class="face front"><span class="coin-star">★</span><small>ODDAROA</small></div>' +
      '<div class="face back"><span class="coin-cedi">₵</span><small>GHANA</small></div></div></div>' +
      '<p class="dice-hint" id="coinHint">One flip. Call it right and 1.94x is yours.</p>',
      '<label class="glabel">Your call</label>' + segHTML('coinPick', [{ v: 'crest', t: '★ Crest' }, { v: 'coin', t: '₵ Coin' }], 'crest') +
      stakeHTML(5) +
      '<button class="btn gold big" id="coinFlipBtn">Flip the Coin</button>');
  }
  function coinMount() {
    fresh({ game: 'coinflip' });
    bindStake();
    bindSeg('coinPick', () => {});
    loadHistory('coinflip');
    $g('#coinFlipBtn').addEventListener('click', async () => {
      if (S.busy) return;
      S.busy = true;
      const btn = $g('#coinFlipBtn'); btn.disabled = true;
      const pick = segVal('coinPick');
      const d = await startRound('coinflip', { pick });
      if (!d) { S.busy = false; btn.disabled = false; return; }
      const coin = $g('#coin');
      const target = (d.round.result.face === 'crest' ? 0 : 180) + 360 * 6;
      coin.style.transition = 'none';
      coin.style.transform = 'rotateY(0deg)';
      void coin.offsetWidth;
      coin.style.transition = 'transform 1.6s cubic-bezier(.15,.6,.25,1)';
      coin.style.transform = 'rotateY(' + target + 'deg)';
      later(() => {
        if (d.round.payout > 0) banner('win', 'It landed on <b>' + (d.round.result.face === 'crest' ? 'the Crest' : 'the Coin') + '</b> — <b>' + money(d.round.payout) + '</b> won.');
        else banner('lose', 'It landed on <b>' + (d.round.result.face === 'crest' ? 'the Crest' : 'the Coin') + '</b> — not your call. <b>' + money(d.round.stake) + '</b> gone.');
        setBalance(d.balance);
        S.busy = false; btn.disabled = false;
        loadHistory('coinflip');
      }, 1700);
    });
  }

  /* ---------------- Shared goal stage (both penalty games) ---------------- */
  function goalStageHTML(prices) {
    const zones = ZONE_NAMES.map((n, i) =>
      '<button type="button" class="zone" data-zone="' + i + '" aria-label="' + n + '">' +
      (prices ? '<b>' + prices[i].toFixed(2) + 'x</b>' : '<b>' + n.split(' ').map(w => w[0]).join(' ') + '</b>') +
      '<small>' + n + '</small></button>').join('');
    return '<div class="pitch" id="pitch"><div class="goal" id="goal">' + zones +
      '<div class="keeper" id="keeper"><span class="k-head"></span><span class="k-body"></span></div></div>' +
      '<div class="pball" id="pball"></div><div class="pspot"></div></div>';
  }
  function aim(zone, missed) {
    // Pixel target for a shot: the zone's centre, or wide of the post
    // when the server says the shot missed the goal entirely.
    const pitch = $g('#pitch'), goal = $g('#goal');
    const cell = goal.querySelector('[data-zone="' + zone + '"]');
    const pr = pitch.getBoundingClientRect(), cr = cell.getBoundingClientRect();
    let x = cr.left - pr.left + cr.width / 2, y = cr.top - pr.top + cr.height / 2;
    if (missed) { x += (zone % 3 === 0 ? -1 : 1) * (cr.width * 0.9); y -= 14; }
    return { x, y };
  }
  function kickAnimate(zone, keeperZone, missed) {
    const pitch = $g('#pitch'), ball = $g('#pball'), keeper = $g('#keeper');
    const pr = pitch.getBoundingClientRect();
    const spot = { x: pr.width / 2, y: pr.height - 26 };
    const t = aim(zone, missed);
    ball.style.transition = 'none'; ball.style.transform = 'translate(' + spot.x + 'px,' + spot.y + 'px) scale(1)';
    keeper.style.transition = 'none'; keeper.style.transform = '';
    void ball.offsetWidth;
    ball.style.transition = 'transform .55s cubic-bezier(.2,.7,.3,1)';
    ball.style.transform = 'translate(' + t.x + 'px,' + t.y + 'px) scale(.5)';
    const k = aim(keeperZone, false);
    keeper.style.transition = 'transform .5s cubic-bezier(.2,.7,.3,1)';
    keeper.style.transform = 'translate(' + (k.x - pr.width / 2) + 'px,' + (k.y - (pr.height - 150)) + 'px) rotate(' + (keeperZone % 3 === 0 ? -28 : keeperZone % 3 === 2 ? 28 : 0) + 'deg)';
    return new Promise(r => setTimeout(r, 620));
  }
  function resetPitch() {
    const pitch = $g('#pitch'), ball = $g('#pball'), keeper = $g('#keeper');
    if (!pitch) return;
    const pr = pitch.getBoundingClientRect();
    ball.style.transition = 'none';
    ball.style.transform = 'translate(' + (pr.width / 2) + 'px,' + (pr.height - 26) + 'px) scale(1)';
    keeper.style.transition = 'transform .4s ease';
    keeper.style.transform = '';
    document.querySelectorAll('.zone').forEach(z => z.classList.remove('scored', 'saved'));
  }

  /* ---------------- Penalty Shootout ---------------- */
  const LADDER_FALLBACK = [1.16, 1.40, 1.68, 2.01, 2.41];
  function shootoutScreen() {
    const rail = LADDER_FALLBACK.map((m, i) => '<span class="rung" data-rung="' + i + '">Goal ' + (i + 1) + ' · ' + m.toFixed(2) + 'x</span>').join('');
    return shell('Penalty Shootout',
      goalStageHTML(null) +
      '<div class="ladder" id="ladder">' + rail + '</div>' +
      '<p class="dice-hint" id="soStatus">Start a shootout, then pick your corner. Cash out between kicks — one save ends it.</p>',
      '<div id="soStart">' + stakeHTML(10) + '<button class="btn gold big" id="soStartBtn">Start Shootout</button></div>' +
      '<button class="btn big g-cash" id="soCash" hidden>Cash Out</button>');
  }
  function shootoutMount() {
    fresh({ game: 'shootout' });
    bindStake();
    loadHistory('shootout');
    later(resetPitch, 30);
    const zones = document.querySelectorAll('.zone');
    zones.forEach(z => z.disabled = true);
    function paint(round) {
      const st = $g('#soStatus'), cash = $g('#soCash');
      const goals = round.goals || 0, kicks = round.kicks || 0;
      document.querySelectorAll('.rung').forEach((r, i) => {
        r.classList.toggle('done', i < goals);
        r.classList.toggle('next', i === goals);
      });
      st.textContent = 'Kick ' + (kicks + 1) + ' of 5 · ' + goals + ' scored' +
        (goals ? ' · cash out now for ' + money(round.cashout_value) : '') + ' — pick your spot.';
      cash.hidden = goals === 0;
      cash.textContent = 'Cash Out ' + money(round.cashout_value || 0);
    }
    function endRound(round) {
      zones.forEach(z => z.disabled = true);
      $g('#soCash').hidden = true;
      $g('#soStart').hidden = false;
      $g('#soStartBtn').textContent = 'Play Again';
      S.round = null;
      document.querySelectorAll('.rung').forEach(r => r.classList.remove('done', 'next'));
      loadHistory('shootout');
    }
    $g('#soStartBtn').addEventListener('click', async () => {
      if (S.busy) return;
      S.busy = true;
      const d = await startRound('shootout', {});
      S.busy = false;
      if (!d) return;
      S.round = d.round;
      resetPitch();
      banner('', '');
      $g('#soStart').hidden = true;
      zones.forEach(z => z.disabled = false);
      paint(d.round);
    });
    zones.forEach(z => z.addEventListener('click', async () => {
      if (!S.round || S.busy) return;
      S.busy = true;
      const zone = Number(z.dataset.zone);
      try {
        const d = await api('/games/act', { method: 'POST', body: { round_id: S.round.id, zone } });
        setBalance(d.balance);
        await kickAnimate(zone, d.kick.keeper, false);
        z.classList.add(d.kick.goal ? 'scored' : 'saved');
        if (d.round.status !== 'open') {
          if (d.round.status === 'won') banner('win', 'Five from five — a perfect shootout! <b>' + money(d.round.payout) + '</b> is yours.');
          else if (d.kick.goal) banner('win', 'You walk away with <b>' + money(d.round.payout) + '</b>.');
          else banner('lose', 'Saved! The keeper read it and the ladder falls — <b>' + money(d.round.stake) + '</b> gone.');
          endRound(d.round);
        } else {
          S.round = d.round;
          banner(d.kick.goal ? 'win' : '', d.kick.goal ? 'Goal! The ladder climbs — cash out or go again.' : '');
          paint(d.round);
          later(resetPitch, 500);
        }
      } catch (e) { toast('That kick did not register — try again'); }
      S.busy = false;
    }));
    $g('#soCash').addEventListener('click', async () => {
      if (!S.round || S.busy) return;
      S.busy = true;
      try {
        const d = await api('/games/cashout', { method: 'POST', body: { round_id: S.round.id } });
        setBalance(d.balance);
        banner('win', 'Cashed out — <b>' + money(d.round.payout) + '</b> landed in your wallet.');
        endRound(d.round);
      } catch (e) { toast('Cash out failed — the shootout is still live'); }
      S.busy = false;
    });
  }

  /* ---------------- Football Penalty ---------------- */
  function penaltyScreen() {
    return shell('Football Penalty',
      goalStageHTML(PENALTY_PRICES) +
      '<p class="dice-hint">One kick. The glamour corners pay more because they miss more — and the keeper loves the low corners.</p>',
      stakeHTML(5) +
      '<p class="gnote2">Set your stake, then tap a zone in the goal to shoot. The price on each zone is what a goal pays.</p>');
  }
  function penaltyMount() {
    fresh({ game: 'penalty' });
    bindStake();
    loadHistory('penalty');
    later(resetPitch, 30);
    document.querySelectorAll('.zone').forEach(z => z.addEventListener('click', async () => {
      if (S.busy) return;
      S.busy = true;
      const zone = Number(z.dataset.zone);
      const d = await startRound('penalty', { zone });
      if (!d) { S.busy = false; return; }
      const r = d.round.result;
      await kickAnimate(zone, r.keeper, r.missed);
      z.classList.add(r.goal ? 'scored' : 'saved');
      if (r.goal) banner('win', 'GOAL! Top bins or bottom corner, the keeper had no chance — <b>' + money(d.round.payout) + '</b> won.');
      else if (r.saved) banner('lose', 'SAVED! The keeper read your kick. <b>' + money(d.round.stake) + '</b> gone.');
      else banner('lose', 'MISSED! It flew wide of the post. <b>' + money(d.round.stake) + '</b> gone.');
      setBalance(d.balance);
      loadHistory('penalty');
      later(resetPitch, 1100);
      S.busy = false;
    }));
  }

  /* ---------------- Wiring ---------------- */
  const SCREENS = {
    aviator: [aviatorScreen, aviatorMount],
    plinko: [plinkoScreen, plinkoMount],
    dice: [diceScreen, diceMount],
    coinflip: [coinScreen, coinMount],
    shootout: [shootoutScreen, shootoutMount],
    penalty: [penaltyScreen, penaltyMount],
  };
  async function lobbyMount() {
    const box = document.getElementById('gamesRecent');
    if (!box || !state.user) return;
    try {
      const d = await api('/games/history');
      if (!document.getElementById('gamesRecent')) return;
      if (!d.recent.length) { box.innerHTML = '<p class="empty">No rounds played yet — be the first result on this board.</p>'; return; }
      box.innerHTML = d.recent.slice(0, 8).map(r => {
        const label = r.game === 'aviator' && r.crash != null ? 'crashed ' + Number(r.crash).toFixed(2) + 'x'
          : r.payout > 0 ? '+' + money(r.payout) : '−' + money(r.stake);
        return '<div class="ghrow"><span>' + esc(r.who) + '</span><span>' + esc((Object.keys(META).find(k => META[k].id === r.game) || r.game)) + '</span><b class="' + (r.payout > 0 ? 'g-win' : 'g-lose') + '">' + label + '</b></div>';
      }).join('');
    } catch (e) { /* strip is decorative; the lobby still works */ }
  }
  window.OddaroaGames = {
    destroy: teardown,
    screenHTML(name) {
      const m = META[name];
      return m ? SCREENS[m.id][0]() : '<h2>Games</h2>';
    },
    afterRender() {
      if (state.view === 'game' && state.game && META[state.game]) {
        SCREENS[META[state.game].id][1]();
        const back = document.querySelector('[data-gback]');
        if (back) back.addEventListener('click', () => { state.view = 'games'; render(); window.scrollTo(0, 0); });
      } else if (state.view === 'games') {
        lobbyMount();
      }
    },
  };
})();
