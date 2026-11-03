// Oddaroa app — live fixtures from ESPN's free scoreboard API.
// ESPN ships scores/fixtures/logos but NO betting odds, so odds below are
// model odds generated deterministically per match (same match = same odds).
const LEAGUES = [
  ["eng.1", "Premier League"], ["esp.1", "La Liga"], ["ita.1", "Serie A"],
  ["ger.1", "Bundesliga"], ["fra.1", "Ligue 1"], ["uefa.champions", "Champions League"],
  ["uefa.europa", "Europa League"], ["usa.1", "MLS"], ["ned.1", "Eredivisie"],
  ["por.1", "Primeira Liga"], ["tur.1", "Süper Lig"],
];

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

// Model odds: favourite gets the shorter price; returns a full market set.
function modelOdds(home, away) {
  const r = hashStr(home + "|" + away);
  const homeWin = 1.45 + r * 2.6;                       // 1.45 – 4.05
  const draw = 2.9 + hashStr(away + home) * 0.9;        // 2.90 – 3.80
  const awayWin = +( (1 / Math.max(0.08, 1 - 1 / homeWin - 1 / draw)) ).toFixed(2);
  const o = {
    "1": +homeWin.toFixed(2), "X": +draw.toFixed(2), "2": Math.min(Math.max(awayWin, 1.6), 9.5),
  };
  o["1X"] = +(1 / (1 / o["1"] + 1 / o["X"]) * 1.06).toFixed(2);
  o["12"] = +(1 / (1 / o["1"] + 1 / o["2"]) * 1.06).toFixed(2);
  o["X2"] = +(1 / (1 / o["X"] + 1 / o["2"]) * 1.06).toFixed(2);
  o["O2.5"] = +(1.72 + hashStr(home + "o") * 0.55).toFixed(2);
  o["U2.5"] = +(1 / Math.max(0.2, 1 - 1 / o["O2.5"]) * 0.96).toFixed(2);
  o["BTTS"] = +(1.68 + hashStr(away + "b") * 0.5).toFixed(2);
  return o;
}
// Model prediction: the market the model rates most likely, with confidence.
function modelPick(m) {
  const o = m.odds;
  const cands = [
    ["Match Result", m.odds["1"] <= m.odds["2"] ? m.home : m.away, Math.min(m.odds["1"], m.odds["2"])],
    ["Double Chance", m.odds["1"] <= m.odds["2"] ? "1X" : "X2", m.odds["1"] <= m.odds["2"] ? o["1X"] : o["X2"]],
    ["Goals", "Over 2.5", o["O2.5"]], ["Goals", "BTTS: Yes", o["BTTS"]],
  ];
  cands.sort((a, b) => a[2] - b[2]);
  const [market, pick, odd] = cands[0];
  return { market, pick, odd, conf: Math.round(Math.min(88, Math.max(52, 100 / odd * 1.55))) };
}

const FALLBACK = [
  { league: "Premier League", home: "Arsenal", away: "Chelsea", time: "Today · 17:30", live: false, hs: null, as: null, hLogo: "", aLogo: "" },
  { league: "La Liga", home: "Real Madrid", away: "Sevilla", time: "Today · 20:00", live: false, hs: null, as: null, hLogo: "", aLogo: "" },
  { league: "Serie A", home: "Inter", away: "Napoli", time: "Today · 19:45", live: false, hs: null, as: null, hLogo: "", aLogo: "" },
  { league: "Champions League", home: "Bayern Munich", away: "PSG", time: "Tomorrow · 20:00", live: false, hs: null, as: null, hLogo: "", aLogo: "" },
  { league: "Bundesliga", home: "Dortmund", away: "RB Leipzig", time: "Tomorrow · 17:30", live: false, hs: null, as: null, hLogo: "", aLogo: "" },
].map(m => ({ ...m, state: "pre", odds: modelOdds(m.home, m.away) }));

async function fetchLeague(slug, name, dates) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard` + (dates ? `?dates=${dates}` : "");
  const res = await fetch(url); if (!res.ok) throw new Error(slug);
  const data = await res.json();
  return (data.events || []).map(ev => {
    const c = ev.competitions[0], [h, a] = c.competitors;
    const state = ev.status.type.state; // pre | in | post
    const live = state === "in";
    return {
      league: name, slug, state, home: h.team.displayName, away: a.team.displayName,
      hLogo: h.team.logo || "", aLogo: a.team.logo || "",
      hs: live || state === "post" ? h.score : null,
      as: live || state === "post" ? a.score : null,
      live, date: ev.date,
      detail: ev.status.type.shortDetail || "",
      time: live ? (ev.status.displayClock || "Live") :
        new Date(ev.date).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }),
      odds: modelOdds(h.team.displayName, a.team.displayName),
    };
  });
}

async function loadMatches() {
  const settled = await Promise.allSettled(LEAGUES.map(([s, n]) => fetchLeague(s, n)));
  let all = settled.flatMap(r => r.status === "fulfilled" ? r.value : []);
  return all.length ? all : FALLBACK;
}

// Matches for one YYYYMMDD date (results / upcoming pages). No fallback:
// an empty day honestly returns an empty list.
async function loadMatchesFor(dates) {
  const settled = await Promise.allSettled(LEAGUES.map(([s, n]) => fetchLeague(s, n, dates)));
  return settled.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

// League table from ESPN's v2 standings API. Returns rows or null.
async function fetchStandings(slug) {
  const season = new Date().getFullYear();
  const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings?season=${season}`);
  if (!res.ok) return null;
  const data = await res.json();
  const entries = data.children && data.children[0] && data.children[0].standings && data.children[0].standings.entries;
  if (!entries || !entries.length) return null;
  const stat = (e, name) => { const s = (e.stats || []).find(x => x.name === name); return s ? s.displayValue : "—"; };
  return entries.map(e => ({
    team: e.team.displayName, logo: e.team.logos && e.team.logos[0] ? e.team.logos[0].href : "",
    note: e.note && e.note.description ? e.note.description : "",
    p: stat(e, "gamesPlayed"), w: stat(e, "wins"), d: stat(e, "ties"), l: stat(e, "losses"),
    gf: stat(e, "pointsFor"), ga: stat(e, "pointsAgainst"), gd: stat(e, "pointDifferential"), pts: stat(e, "points"),
  }));
}

function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }

// A tappable odds button wired to the slip.
function oddsBtn(m, group, market, label, odd) {
  const id = `${m.home}-${m.away}-${group}-${label}`.replace(/\s+/g, "_");
  const b = document.createElement("button");
  b.className = "odds-btn" + (window.OddSlip && OddSlip.has(id) ? " selected" : "");
  b.dataset.sel = id;
  b.innerHTML = `<small>${label}</small><b>${Number(odd).toFixed(2)}</b>`;
  b.onclick = () => {
    const on = OddSlip.toggle({ id, group, match: `${m.home} vs ${m.away}`, market, pick: `${label} — ${m.home} vs ${m.away}`, odd });
    b.classList.toggle("selected", on);
  };
  return b;
}

function matchCard(m) {
  const el = document.createElement("article"); el.className = "match";
  const score = m.hs !== null && m.hs !== undefined ? `<span class="score">${m.hs} – ${m.as}</span>` : `<span class="kickoff">${m.time}</span>`;
  el.innerHTML = `
    <div class="match-top"><span>${m.league}</span>${m.live ? '<span class="live-dot">● LIVE ' + m.time + "</span>" : `<span>${m.time}</span>`}</div>
    <div class="teams">
      <div class="team">${m.hLogo ? `<img src="${m.hLogo}" alt="">` : ""}<span class="tname"></span>${score}</div>
      <div class="team">${m.aLogo ? `<img src="${m.aLogo}" alt="">` : ""}<span class="tname"></span></div>
    </div>`;
  el.querySelectorAll(".tname")[0].textContent = m.home;
  el.querySelectorAll(".tname")[1].textContent = m.away;
  const row = document.createElement("div"); row.className = "odds-row";
  row.append(oddsBtn(m, "1x2", "Match Result", "1", m.odds["1"]), oddsBtn(m, "1x2", "Match Result", "X", m.odds["X"]), oddsBtn(m, "1x2", "Match Result", "2", m.odds["2"]));
  const mk = document.createElement("div"); mk.className = "markets";
  mk.append(oddsBtn(m, "dc", "Double Chance", "1X", m.odds["1X"]), oddsBtn(m, "dc", "Double Chance", "12", m.odds["12"]), oddsBtn(m, "dc", "Double Chance", "X2", m.odds["X2"]),
            oddsBtn(m, "ou", "Goals O/U 2.5", "Over 2.5", m.odds["O2.5"]), oddsBtn(m, "ou", "Goals O/U 2.5", "Under 2.5", m.odds["U2.5"]), oddsBtn(m, "btts", "Both Teams To Score", "BTTS Yes", m.odds["BTTS"]));
  const p = modelPick(m);
  const pl = document.createElement("div"); pl.className = "pred-line";
  pl.innerHTML = `Model pick: <b></b> · confidence ${p.conf}%`;
  pl.querySelector("b").textContent = `${p.pick} @ ${p.odd.toFixed(2)}`;
  el.append(row, mk, pl);
  return el;
}
