// =====================================================================
//  THE TRAITORS — Game Master console
// =====================================================================
import {
  db, R, ensureAuth, errMsg, toast, modal, confirmBox, promptBox, h, esc, $, $$,
  randStr, randHex, playerKey, shuffle, recommendedTraitors, avatarHTML, money, roleBadge,
  PHASES, alive, pname, timerRemaining, fmtTime, pageUrl, qrUrl, copyText, configBanner,
  getDoc, setDoc, updateDoc, onSnapshot, query, where, orderBy, writeBatch,
  deleteField, arrayUnion, arrayRemove, increment
} from "./core.js";

const S = {
  code: null, uid: null, game: null, secret: null,
  privs: {}, privSubs: {}, privKeyOf: {},
  claims: {}, votes: [], voteId: null, voteUnsub: null,
  chamberKey: null, chamber: null, msgs: [], noms: [], chamberUnsubs: [],
  privacy: localStorage.getItem("traitors.gm.privacy") === "1",
  selection: "random", manualTraitors: new Set(), handledOffers: new Set(),
  panelKey: null, chamberBuiltFor: null, showGmLog: false, notGM: false,
};
const app = $("#app");
const L = (text) => ({ t: Date.now() + Math.random(), day: S.game?.day || 0, text });

// ---------------------------------------------------------------- boot
(async function boot() {
  try { const u = await ensureAuth(); S.uid = u.uid; }
  catch (e) { return showFatal(errMsg(e)); }
  const code = (new URLSearchParams(location.search).get("g") || "").toUpperCase().trim();
  if (code) openGame(code); else showSetup();
})();

function showFatal(msg) {
  app.innerHTML = `${configBanner()}<div class="card center-card"><h2>⚠️ Hold on</h2><p>${esc(msg)}</p>
    <div class="btn-row" style="justify-content:center"><a class="btn" href="index.html">🏠 Home</a><a class="btn" href="gm.html">🏰 Game Master home</a></div></div>`;
}

// ---------------------------------------------------------------- setup screen
const myGames = () => { try { return JSON.parse(localStorage.getItem("traitors.gm.games") || "[]"); } catch { return []; } };
function rememberGame(code, name) {
  const l = myGames().filter((x) => x.code !== code); l.unshift({ code, name, ts: Date.now() });
  localStorage.setItem("traitors.gm.games", JSON.stringify(l.slice(0, 12)));
}
function showSetup() {
  const games = myGames();
  app.innerHTML = `
  ${configBanner()}
  <div class="setup-wrap">
    <div class="card">
      <h2>🏰 Create a new game</h2>
      <form id="createForm" class="form">
        <label>Game name<input name="name" required maxlength="60" placeholder="e.g. Office Traitors – Season 1"></label>
        <div class="row">
          <label>Currency symbol<input name="currency" value="₹" maxlength="3"></label>
          <label>Starting prize pot<input name="pot" type="number" min="0" value="0"></label>
        </div>
        <button class="btn btn-primary btn-lg">Create game</button>
      </form>
      <p class="tiny">This browser becomes the Game Master. Run the GM console from this same device and browser for the whole game.</p>
    </div>
    <div class="card">
      <h2>↩️ Resume a game</h2>
      ${games.length ? `<ul class="list">${games.map((x) => `<li><a href="gm.html?g=${x.code}"><b>${esc(x.name)}</b> &nbsp;<span class="code">${x.code}</span></a></li>`).join("")}</ul>` : `<p class="muted">No games created on this device yet.</p>`}
      <form id="resumeForm" class="form inline"><input name="code" placeholder="Game code" maxlength="5" required style="text-transform:uppercase"><button class="btn">Open</button></form>
    </div>
  </div>`;
  $("#createForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); const btn = e.target.querySelector("button"); btn.classList.add("busy");
    try { const code = await createGame(fd.get("name").trim(), fd.get("currency").trim() || "₹", Number(fd.get("pot")) || 0); location.href = `gm.html?g=${code}`; }
    catch (err) { toast(errMsg(err), "error"); btn.classList.remove("busy"); }
  };
  $("#resumeForm").onsubmit = (e) => { e.preventDefault(); location.href = "gm.html?g=" + new FormData(e.target).get("code").toUpperCase().trim(); };
}

async function createGame(name, currency, pot) {
  let code = null;
  for (let i = 0; i < 8 && !code; i++) { const c = randStr(5); const s = await getDoc(R.game(c)); if (!s.exists()) code = c; }
  if (!code) throw new Error("Could not allocate a game code, please retry.");
  await setDoc(R.game(code), {
    code, name, gmUid: S.uid, createdAt: Date.now(), phase: "lobby", day: 0, pot, currency,
    players: {}, order: [], missions: [], timer: null, vote: null, reveal: null, banish: null,
    announce: null, winner: null, breakfastDone: false,
    settings: { numTraitors: 0, autoTraitorWin: true, daggerEnabled: true, endgameSize: 4, tiedCanVote: false },
    log: [{ t: Date.now(), day: 0, text: `🏰 The castle doors open: ${name}` }],
  });
  await setDoc(R.secret(code), { roles: {}, pins: {}, keys: {}, traitorKey: null, shields: {}, daggers: {}, pendingMurder: null, revealQueue: [], revealResult: null, gmLog: [] });
  rememberGame(code, name);
  return code;
}

// ---------------------------------------------------------------- open game / subscriptions
function openGame(code) {
  S.code = code;
  app.innerHTML = `<div class="loading">Opening the castle gates…</div>`;
  let first = true;
  onSnapshot(R.game(code), (snap) => {
    if (!snap.exists()) return showFatal(`Game ${code} was not found.`);
    const g = snap.data();
    if (first) {
      first = false;
      if (g.gmUid !== S.uid) { S.notGM = true; return showFatal(`This device is not the Game Master for game ${code}. Players should use the Player app; the big screen should use the Display.`); }
      rememberGame(code, g.name); buildShell(); subscribeRest();
    }
    if (S.notGM) return;
    S.game = g; syncVoteSub(); mirrorSubmitted(); render();
  }, (e) => showFatal(errMsg(e)));
}

function subscribeRest() {
  onSnapshot(R.secret(S.code), (snap) => {
    S.secret = snap.data() || {};
    syncPrivSubs(); syncChamberSub(); render();
  }, (e) => toast(errMsg(e), "error"));
  onSnapshot(R.claims(S.code), (qs) => {
    S.claims = {}; qs.forEach((d) => (S.claims[d.id] = d.data()));
    mirrorJoined();
  }, (e) => toast(errMsg(e), "error"));
}

function syncPrivSubs() {
  const keys = S.secret?.keys || {};
  for (const [pid, key] of Object.entries(keys)) {
    if (S.privKeyOf[pid] === key) continue;
    S.privSubs[pid]?.();
    S.privKeyOf[pid] = key;
    S.privSubs[pid] = onSnapshot(R.priv(S.code, key), (snap) => {
      S.privs[pid] = snap.data() || null; handleOffer(pid); renderSoft();
    });
  }
  for (const pid of Object.keys(S.privSubs)) {
    if (!keys[pid]) { S.privSubs[pid](); delete S.privSubs[pid]; delete S.privKeyOf[pid]; delete S.privs[pid]; }
  }
}

function syncChamberSub() {
  const key = S.secret?.traitorKey || null;
  if (key === S.chamberKey) return;
  S.chamberUnsubs.forEach((u) => u()); S.chamberUnsubs = []; S.chamber = null; S.msgs = []; S.noms = [];
  S.chamberKey = key; S.chamberBuiltFor = null;
  if (!key) return;
  S.chamberUnsubs.push(onSnapshot(R.chamber(S.code, key), (s) => { S.chamber = s.data() || null; renderSoft(); }));
  S.chamberUnsubs.push(onSnapshot(query(R.msgs(S.code, key), orderBy("ts")), (qs) => { S.msgs = qs.docs.map((d) => d.data()); renderChamber(); }));
  S.chamberUnsubs.push(onSnapshot(R.noms(S.code, key), (qs) => { S.noms = qs.docs.map((d) => ({ id: d.id, ...d.data() })); renderSoft(); }));
}

function syncVoteSub() {
  const id = S.game?.vote?.id || null;
  if (id === S.voteId) return;
  S.voteUnsub?.(); S.voteUnsub = null; S.votes = []; S.voteId = id;
  if (!id) return;
  S.voteUnsub = onSnapshot(query(R.votes(S.code), where("voteId", "==", id)), (qs) => {
    S.votes = qs.docs.map((d) => d.data()); mirrorSubmitted(); renderSoft();
  }, (e) => toast(errMsg(e), "error"));
}

// Mirror "who has logged in" and "who has voted" onto the public board (no secrets revealed)
async function mirrorJoined() {
  const g = S.game; if (!g) return;
  const patch = {};
  g.order.forEach((p) => { const want = !!S.claims[p]; if (!!g.players[p]?.joined !== want) patch[`players.${p}.joined`] = want; });
  if (Object.keys(patch).length) try { await updateDoc(R.game(S.code), patch); } catch (e) { console.warn(e); }
}
async function mirrorSubmitted() {
  const v = S.game?.vote; if (!v?.open) return;
  const sub = [...new Set(S.votes.filter((x) => x.voteId === v.id && v.voters.includes(x.voter)).map((x) => x.voter))].sort();
  if (JSON.stringify(sub) !== JSON.stringify([...(v.submitted || [])].sort())) {
    try { await updateDoc(R.game(S.code), { "vote.submitted": sub }); } catch (e) { console.warn(e); }
  }
}

// ---------------------------------------------------------------- write helpers
async function upd(patch) { await updateDoc(R.game(S.code), patch); }
async function updSecret(patch) { await updateDoc(R.secret(S.code), patch); }
const keyOf = (pid) => S.secret?.keys?.[pid];
const roleOf = (pid) => S.secret?.roles?.[pid];
const ann = (kind, extra = {}) => ({ kind, ts: Date.now(), ...extra });
function counts() {
  const g = S.game, al = alive(g);
  const T = al.filter((p) => roleOf(p) === "Traitor").length;
  return { alive: al.length, T, F: al.length - T };
}

// ---------------------------------------------------------------- shell
function buildShell() {
  app.innerHTML = `
  <header class="topbar" id="topbar"></header>
  <main class="gm-main">
    <div>
      <section class="card">
        <div class="phase-nav" id="phaseNav"></div>
        <form class="broadcast" id="broadcastForm"><input id="broadcastText" maxlength="160" placeholder="📣 Broadcast a message to every screen…"><button class="btn">Send</button></form>
        <div class="panel" id="panel"></div>
      </section>
    </div>
    <div>
      <section class="card" id="roster"></section>
      <section class="card" id="chamberCard"></section>
      <section class="card" id="logCard"></section>
    </div>
  </main>`;
  $("#broadcastForm").onsubmit = async (e) => {
    e.preventDefault(); const t = $("#broadcastText").value.trim(); if (!t) return;
    try { await upd({ announce: ann("text", { text: t }) }); $("#broadcastText").value = ""; toast("Broadcast sent", "ok"); }
    catch (err) { toast(errMsg(err), "error"); }
  };
  setInterval(() => {
    const t = S.game?.timer, s = timerRemaining(t);
    $$("[data-dyn=timer]").forEach((el) => { el.textContent = t ? fmtTime(s) : "--:--"; el.classList.toggle("urgent", !!t && s <= 30); });
  }, 250);
}

// ---------------------------------------------------------------- render
function render() {
  if (!S.game || !$("#topbar")) return;
  renderTop(); renderNav(); renderPanel(); renderRoster(); renderChamber(); renderLog();
}
function renderSoft() { if (!S.game || !$("#topbar")) return; renderPanel(); renderRoster(); renderChamber(); }

function renderTop() {
  const g = S.game, c = counts(), started = g.phase !== "lobby";
  $("#topbar").innerHTML = `
    <div class="brand"><span class="logo">🗡️</span><div><div class="title">${esc(g.name)}</div><div class="sub">Game code <span class="code">${g.code}</span> · Game Master</div></div></div>
    <div class="stats">
      <div class="stat"><span>Phase</span><b>${PHASES[g.phase]?.icon || ""} ${PHASES[g.phase]?.title || g.phase}</b></div>
      <div class="stat"><span>Day</span><b>${g.day || 0}</b></div>
      <div class="stat"><span>Prize pot</span><b class="gold">${money(g.pot, g.currency)}</b></div>
      <div class="stat"><span>Alive</span><b>${c.alive} / ${g.order.length}</b></div>
      ${started && !S.privacy ? `<div class="stat"><span>Faithful / Traitor</span><b>${c.F} / <span class="red">${c.T}</span></b></div>` : ""}
    </div>
    <div class="actions">
      <a class="btn btn-sm" target="_blank" href="${pageUrl("display.html", { g: g.code })}">📺 Big screen</a>
      <button class="btn btn-sm" data-act="copyLink">📱 Player link</button>
      <button class="btn btn-sm" data-act="privacy" title="Hide roles/PINs when people can see your screen">${S.privacy ? "🙈 Privacy ON" : "👁 Privacy OFF"}</button>
    </div>`;
}

function renderNav() {
  const g = S.game;
  if (g.phase === "lobby" || g.phase === "finished") { $("#phaseNav").innerHTML = ""; return; }
  const jump = ["breakfast", "mission", "roundtable", "night", "endgame"];
  $("#phaseNav").innerHTML =
    Object.entries(PHASES).filter(([k]) => !["lobby", "finished"].includes(k)).map(([k, v]) =>
      `<span class="phase-chip ${g.phase === k ? "active" : ""}" ${jump.includes(k) ? `data-act="go" data-phase="${k}" title="Jump to ${v.title}"` : `title="Reached through game actions"`} style="${jump.includes(k) ? "" : "cursor:default;opacity:.6"}">${v.icon} ${v.title}</span>`
    ).join("");
}

function renderPanel() {
  const g = S.game, P = PANELS[g.phase]; const el = $("#panel");
  if (!P) { el.innerHTML = `<p>Unknown phase ${esc(g.phase)}</p>`; return; }
  const key = g.phase + "|" + (P.key ? P.key() : "") + "|" + S.privacy;
  if (key !== S.panelKey) { S.panelKey = key; P.build(el); }
  P.update?.(el);
}
const dyn = (el, name, html) => { const d = el.querySelector(`[data-dyn="${name}"]`); if (d) d.innerHTML = html; };

// ---------------------------------------------------------------- status & suggestions
function statusBox() {
  const g = S.game; if (!S.secret?.traitorKey || g.phase === "finished") return "";
  const c = counts(), st = g.settings || {}; let html = "";
  if (c.T === 0) html += `<div class="alert alert-gold">🎉 <b>No Traitors remain alive.</b> The Faithful can win now — or appoint a new Traitor to keep the game going.<br>
     <button class="btn btn-gold" data-act="finish" data-winner="Faithful">🛡 Declare Faithful victory</button><button class="btn" data-act="appointTraitor">🎭 Appoint a new Traitor</button></div>`;
  else if (st.autoTraitorWin !== false && c.T >= c.F) html += `<div class="alert alert-red">🗡 <b>The Traitors now equal or outnumber the Faithful (${c.T} vs ${c.F}).</b><br>
     <button class="btn btn-danger" data-act="finish" data-winner="Traitors">🗡 Declare Traitor victory</button></div>`;
  if (c.T > 0 && c.alive <= (st.endgameSize || 4) && g.phase !== "endgame")
    html += `<div class="alert">🔥 Only <b>${c.alive}</b> players remain — time for the Endgame?<br><button class="btn" data-act="go" data-phase="endgame">🔥 Begin the Endgame</button></div>`;
  return html;
}

// ---------------------------------------------------------------- PANELS
const PANELS = {
  // ------------------------------------------------ LOBBY
  lobby: {
    key: () => "",
    build(el) {
      const g = S.game, st = g.settings || {};
      el.innerHTML = `
      <h2>🏰 Lobby — gather your players</h2>
      ${configBanner()}
      <div class="grid2">
        <div>
          <h3>Add players</h3>
          <textarea id="newNames" rows="6" placeholder="One name per line — paste your whole list"></textarea>
          <div class="btn-row"><button class="btn btn-primary" data-act="addPlayers">➕ Add players</button></div>
          <h3>Invite players</h3>
          <p class="muted small">Each player gets a personal one-tap link with their secret PIN. Send it privately (Teams/WhatsApp DM) or print slips.</p>
          <div class="btn-row"><button class="btn" data-act="copyAllInvites">📋 Copy all invites</button><button class="btn" data-act="printSlips">🖨 Print PIN slips</button></div>
        </div>
        <div>
          <h3>Rules & settings</h3>
          <form id="settingsForm" class="form">
            <label>Number of Traitors
              <select name="numTraitors"><option value="0">Auto (recommended)</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${Number(st.numTraitors) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
            <label>Traitor selection
              <select name="selection"><option value="random" ${S.selection === "random" ? "selected" : ""}>Random (recommended)</option><option value="manual" ${S.selection === "manual" ? "selected" : ""}>Manual — tick Traitors in the roster</option></select></label>
            <label>Endgame begins when this many players remain<input name="endgameSize" type="number" min="2" max="12" value="${st.endgameSize || 4}"></label>
            <label class="check"><input type="checkbox" name="autoTraitorWin" ${st.autoTraitorWin !== false ? "checked" : ""}> Traitors win when they equal / outnumber the Faithful</label>
            <label class="check"><input type="checkbox" name="daggerEnabled" ${st.daggerEnabled !== false ? "checked" : ""}> Enable the Dagger (one-time double vote won in missions)</label>
            <label class="check"><input type="checkbox" name="tiedCanVote" ${st.tiedCanVote ? "checked" : ""}> Tied players may vote in a tie-break revote</label>
            <label>Currency symbol<input name="currency" value="${esc(g.currency || "₹")}" maxlength="3"></label>
            <button class="btn" type="submit">💾 Save settings</button>
          </form>
        </div>
      </div>
      <div class="alert" data-dyn="start"></div>`;
      el.querySelector("#settingsForm").onsubmit = async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        S.selection = fd.get("selection");
        try {
          await upd({
            currency: fd.get("currency").trim() || "₹",
            settings: { numTraitors: Number(fd.get("numTraitors")) || 0, endgameSize: Math.max(2, Number(fd.get("endgameSize")) || 4),
              autoTraitorWin: !!fd.get("autoTraitorWin"), daggerEnabled: !!fd.get("daggerEnabled"), tiedCanVote: !!fd.get("tiedCanVote") }
          });
          toast("Settings saved", "ok");
        } catch (err) { toast(errMsg(err), "error"); }
      };
      el.querySelector("[name=selection]").onchange = (e) => { S.selection = e.target.value; renderRoster(); PANELS.lobby.update(el); };
    },
    update(el) {
      const g = S.game, n = g.order.length, joined = g.order.filter((p) => g.players[p]?.joined).length;
      const t = S.selection === "manual" ? S.manualTraitors.size : (Number(g.settings?.numTraitors) || recommendedTraitors(n));
      dyn(el, "start", `
        <div><b>${n}</b> players · <b>${joined}</b> logged in · <b>${t}</b> Traitor(s) ${S.selection === "manual" ? "(manual)" : (g.settings?.numTraitors ? "" : "(auto)")}</div>
        ${n < 4 ? `<div class="tiny">Add at least 4 players to start (6+ recommended).</div>` : ""}
        <div class="btn-row"><button class="btn btn-primary btn-lg" data-act="startGame" ${n < 4 ? "disabled" : ""}>🎭 Secretly assign roles & start</button></div>`);
    },
  },

  // ------------------------------------------------ ROLES
  roles: {
    key: () => "",
    build(el) {
      el.innerHTML = `<h2>🎭 Roles have been assigned</h2>
      <p>Everyone should open the app <b>privately</b> and press-and-hold their role card. Traitors will see each other and gain access to <b>the Turret</b> (their secret chat & nomination room).</p>
      <div data-dyn="seen"></div>
      <h3>How do you want to begin?</h3>
      <div class="btn-row">
        <button class="btn btn-primary" data-act="go" data-phase="mission">⚔️ Day 1 Mission</button>
        <button class="btn" data-act="go" data-phase="roundtable">🪑 Straight to the Round Table</button>
        <button class="btn" data-act="go" data-phase="night">🌙 Night falls (first murder)</button>
      </div>`;
    },
    update(el) {
      const g = S.game, n = g.order.length;
      const seen = g.order.filter((p) => S.privs[p]?.seenRole);
      const notSeen = g.order.filter((p) => !S.privs[p]?.seenRole).map((p) => esc(pname(g, p)));
      dyn(el, "seen", `<div class="progress"><div style="width:${n ? (seen.length / n) * 100 : 0}%"></div></div>
        <p><b>${seen.length}/${n}</b> have seen their role.${notSeen.length ? ` <span class="muted">Waiting for: ${notSeen.join(", ")}</span>` : " ✅ Everyone is ready."}</p>`);
    },
  },

  // ------------------------------------------------ BREAKFAST
  breakfast: {
    key: () => String(S.game.day),
    build(el) { el.innerHTML = `<h2>☕ Breakfast — Day ${S.game.day}</h2><div data-dyn="b"></div>`; },
    update(el) {
      const g = S.game, pm = S.secret?.pendingMurder;
      let html = "";
      if (!g.breakfastDone) {
        const who = pm ? (S.privacy ? "<i>(hidden — privacy mode)</i>" : `<b>${esc(pname(g, pm.pid))}</b>`) : "";
        html += pm ? (pm.blocked
          ? `<div class="alert alert-blue">🛡 The Traitors targeted ${who}, but a Shield saved them. <b>Nobody died.</b> (Players will only learn that everyone survived.)</div>`
          : `<div class="alert alert-red">🔪 ${who} was murdered last night${pm.ultimatum ? " (refused the ultimatum)" : ""}.</div>`)
          : `<div class="alert">No murder was recorded last night.</div>`;
        html += `<p class="muted">Tip: let players walk into breakfast in small groups to build tension, then reveal on all screens.</p>
          <button class="btn btn-primary btn-lg" data-act="revealBreakfast">🔔 Reveal the night's outcome</button>`;
      } else {
        html += `<p>✅ The night's outcome has been revealed. Shields have expired.</p>${statusBox()}
          <div class="btn-row"><button class="btn btn-primary" data-act="go" data-phase="mission">⚔️ Mission</button><button class="btn" data-act="go" data-phase="roundtable">🪑 Round Table</button></div>`;
      }
      dyn(el, "b", html);
    },
  },

  // ------------------------------------------------ MISSION
  mission: {
    key: () => S.game.day + "|" + alive(S.game).join(","),
    build(el) {
      const g = S.game, al = alive(g), dagger = g.settings?.daggerEnabled !== false;
      el.innerHTML = `
      <h2>⚔️ Mission — Day ${g.day}</h2>
      <p class="muted">Run any office challenge (quiz, puzzle, treasure hunt, team task). Record the money earned and secretly award Shields${dagger ? " or the Dagger" : ""}.</p>
      <form id="missionForm" class="form">
        <div class="row">
          <label>Mission name<input name="title" required maxlength="60" placeholder="e.g. The Vault Puzzle"></label>
          <label>Money earned (${esc(g.currency)})<input name="amount" type="number" min="0" value="0"></label>
        </div>
        <fieldset><legend>🛡 Shields — protect from murder tonight (expire at breakfast)</legend>
          <div class="chips">${al.map((p) => `<label class="chip"><input type="checkbox" name="shield" value="${p}"> ${esc(pname(g, p))}</label>`).join("") || "<span class='muted'>No living players</span>"}</div>
          <label class="check"><input type="checkbox" name="publicShield"> Announce shield holders publicly (default: secret)</label>
        </fieldset>
        ${dagger ? `<fieldset><legend>🗡 Dagger — one-time double vote at a Round Table</legend>
          <select name="dagger"><option value="">— nobody —</option>${al.map((p) => `<option value="${p}">${esc(pname(g, p))}</option>`).join("")}</select></fieldset>` : ""}
        <button class="btn btn-primary">✅ Record mission result</button>
      </form>
      <h3 style="margin-top:18px">Adjust prize pot manually</h3>
      <form id="potForm" class="form inline"><input name="delta" type="number" placeholder="+500 or -200" required><button class="btn">Apply</button></form>
      <div data-dyn="missions"></div>
      <div class="btn-row"><button class="btn btn-primary" data-act="go" data-phase="roundtable">🪑 Proceed to the Round Table</button></div>`;
      el.querySelector("#missionForm").onsubmit = (e) => { e.preventDefault(); run(() => recordMission(new FormData(e.target), e.target), e.submitter); };
      el.querySelector("#potForm").onsubmit = (e) => {
        e.preventDefault(); const d = Number(new FormData(e.target).get("delta")) || 0; if (!d) return;
        run(async () => { await upd({ pot: increment(d), log: arrayUnion(L(`💰 Prize pot adjusted by ${d > 0 ? "+" : "-"}${money(Math.abs(d), g.currency)}`)), announce: ann("text", { text: `💰 Prize pot ${d > 0 ? "increased" : "reduced"} by ${money(Math.abs(d), g.currency)}` }) }); e.target.reset(); }, e.submitter);
      };
    },
    update(el) {
      const g = S.game, list = (g.missions || []).filter((m) => m.day === g.day);
      dyn(el, "missions", list.length ? `<h3>Today's missions</h3><ul class="log">${list.map((m) => `<li>⚔️ <b>${esc(m.title)}</b> — +${money(m.amount, g.currency)}</li>`).join("")}</ul>` : "");
    },
  },

  // ------------------------------------------------ ROUND TABLE
  roundtable: {
    key: () => String(S.game.day),
    build(el) {
      const g = S.game;
      el.innerHTML = `
      <h2>🪑 Round Table — Day ${g.day}</h2>
      <p class="muted">Players accuse, defend and debate. When you're ready, open the secret vote — everyone votes on their phone.</p>
      <div class="timer-ctl">
        <div class="big-timer" data-dyn="timer">--:--</div>
        <div class="btn-row" style="justify-content:center;align-items:center">
          <input id="tMin" type="number" min="1" max="120" value="10"> min
          <button class="btn" data-act="timerStart">▶ Start</button>
          <button class="btn" data-act="timerPause">⏯ Pause / Resume</button>
          <button class="btn" data-act="timerAdd">+1 min</button>
          <button class="btn btn-ghost" data-act="timerClear">⟲ Clear</button>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary btn-lg" data-act="openBanishVote">🗳 Open the banishment vote</button></div>
      <div data-dyn="status"></div>`;
    },
    update(el) { dyn(el, "status", statusBox()); },
  },

  // ------------------------------------------------ VOTING
  voting: {
    key: () => S.game.vote?.id || "",
    build(el) {
      const v = S.game.vote || {};
      el.innerHTML = `
      <h2>🗳 ${v.kind === "endgame" ? "Endgame vote — END or BANISH AGAIN?" : "Banishment vote"}</h2>
      ${v.label ? `<p class="gold">${esc(v.label)}</p>` : ""}
      <p class="muted">Ballots are secret until you reveal them. Players can change their vote until you close voting.</p>
      <div data-dyn="v"></div>
      <div class="btn-row">
        <button class="btn btn-primary btn-lg" data-act="closeVote">🔒 Close voting & begin the reveal</button>
        <button class="btn btn-ghost" data-act="cancelVote">✖ Cancel this vote</button>
      </div>`;
    },
    update(el) {
      const g = S.game, v = g.vote; if (!v) return;
      const sub = new Set(S.votes.map((x) => x.voter)); const done = v.voters.filter((p) => sub.has(p)).length;
      dyn(el, "v", `
        <div class="progress"><div style="width:${v.voters.length ? (done / v.voters.length) * 100 : 0}%"></div></div>
        <p><b>${done}/${v.voters.length}</b> votes cast ${done === v.voters.length ? "— <span class='gold'>✅ All votes are in!</span>" : ""}</p>
        ${v.kind !== "endgame" ? `<p class="tiny">Candidates: ${v.candidates.map((p) => esc(pname(g, p))).join(", ")}</p>` : ""}
        <div class="voter-list">${v.voters.map((p) => `<div class="voter ${sub.has(p) ? "done" : ""}">${avatarHTML(pname(g, p))}<span>${esc(pname(g, p))}</span><span style="margin-left:auto">${sub.has(p) ? "✅" : "⏳"}</span></div>`).join("")}</div>`);
    },
  },

  // ------------------------------------------------ REVEAL
  reveal: {
    key: () => S.game.reveal?.voteId || "",
    build(el) {
      const r = S.game.reveal || {};
      el.innerHTML = `<h2>📜 The Reveal ${r.kind === "endgame" ? "— Endgame" : ""}</h2>
        <p class="muted">Ask each player to say who they voted for, then reveal their ballot on all screens — one at a time.</p>
        <div data-dyn="r"></div>`;
    },
    update(el) {
      const g = S.game, r = g.reveal; if (!r) return;
      const items = r.items || [], t = {};
      items.forEach((i) => { if (i.target) t[i.target] = (t[i.target] || 0) + (i.weight || 1); });
      const max = Math.max(1, ...Object.values(t));
      const next = (S.secret?.revealQueue || [])[items.length];
      let html = `<div class="reveal-list">${items.map((i) => `<div class="reveal-item">${avatarHTML(pname(g, i.voter))}<b>${esc(pname(g, i.voter))}</b><span class="arrow">➜</span>
          ${i.target ? `<b>${esc(pname(g, i.target))}</b>${i.weight === 2 ? ` <span class="badge badge-traitor">🗡 Dagger ×2</span>` : ""}` : `<span class="muted">${esc(i.note || "No vote")}</span>`}</div>`).join("")}</div>
        <div class="tally">${Object.entries(t).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<div class="tally-row"><span>${esc(pname(g, p))}</span><div class="tally-bar"><div style="width:${(n / max) * 100}%"></div></div><b>${n}</b></div>`).join("")}</div>`;
      if (!r.done) {
        html += `<div class="btn-row">
          <button class="btn btn-primary btn-lg" data-act="revealNext">▶ Reveal next vote ${next ? `(${esc(pname(g, next.voter))})` : ""}</button>
          <button class="btn" data-act="revealAll">⏩ Reveal all</button></div>
          <p class="tiny">${items.length}/${r.total} revealed</p>`;
      } else {
        const res = r.result || {};
        if (r.kind === "endgame") {
          html += res.unanimousEnd
            ? `<div class="alert alert-gold">🏁 <b>Unanimous — the players choose to END the game.</b><br><button class="btn btn-gold btn-lg" data-act="endGame">🏁 End the game & reveal everything</button></div>`
            : `<div class="alert">Not unanimous — the game continues with another banishment.<br><button class="btn btn-primary" data-act="openBanishVote">🗳 Open banishment vote</button><button class="btn" data-act="go" data-phase="endgame">🔥 Back to Endgame</button></div>`;
        } else if (res.type === "single") {
          html += `<div class="alert alert-red">⚖️ <b>${esc(pname(g, res.ids[0]))}</b> received the most votes.<br><button class="btn btn-danger btn-lg" data-act="banish" data-pid="${res.ids[0]}">⚖️ Banish ${esc(pname(g, res.ids[0]))}</button></div>`;
        } else if (res.type === "tie") {
          html += `<div class="alert alert-gold">⚖️ <b>It's a tie</b> between ${res.ids.map((p) => esc(pname(g, p))).join(" & ")}.<br>
            <button class="btn btn-primary" data-act="revote">🔁 Revote between tied players</button>
            <button class="btn" data-act="randomDraw">🎲 Random draw</button>
            <button class="btn" data-act="gmChoose">👑 Game Master decides</button>
            <button class="btn btn-ghost" data-act="noBanish">🙅 No banishment</button></div>`;
        } else {
          html += `<div class="alert">No valid votes were cast.<br><button class="btn" data-act="openBanishVote">🗳 Re-open vote</button><button class="btn btn-ghost" data-act="noBanish">🙅 No banishment</button></div>`;
        }
      }
      dyn(el, "r", html);
    },
  },

  // ------------------------------------------------ BANISHMENT
  banishment: {
    key: () => (S.game.banish?.pid || "none") + "|" + !!S.game.banish?.roleRevealed,
    build(el) {
      const g = S.game, b = g.banish || {};
      if (!b.pid) {
        el.innerHTML = `<h2>⚖️ No one was banished</h2><p>The Round Table could not decide. Night will fall soon…</p><div data-dyn="s"></div>
          <div class="btn-row"><button class="btn btn-primary" data-act="go" data-phase="night">🌙 Night falls</button></div>`;
        return;
      }
      const nm = esc(pname(g, b.pid)), role = roleOf(b.pid);
      el.innerHTML = b.roleRevealed
        ? `<h2>⚖️ ${nm} was ${role === "Traitor" ? "a TRAITOR 🗡" : "FAITHFUL 🛡"}</h2>
           ${role === "Traitor" ? `<p>A Traitor has been caught! ${counts().T > 0 ? "The remaining Traitors may <b>recruit</b> a new Traitor tonight." : ""}</p>` : `<p>The Round Table banished one of their own…</p>`}
           <div data-dyn="s"></div>
           <div class="btn-row"><button class="btn btn-primary" data-act="go" data-phase="night">🌙 Night falls</button><button class="btn" data-act="go" data-phase="endgame">🔥 Endgame</button></div>`
        : `<h2>⚖️ ${nm} has been banished</h2>
           <div style="text-align:center;margin:16px 0">${avatarHTML(pname(g, b.pid), "xl")}</div>
           <p>Let ${nm} say their final words, then reveal who they really are.</p>
           ${S.privacy ? "" : `<p class="tiny">GM only: ${roleBadge(role)}</p>`}
           <div class="btn-row"><button class="btn btn-primary btn-lg" data-act="revealRole">🎭 Reveal ${nm}'s role</button></div>`;
    },
    update(el) { dyn(el, "s", statusBox()); },
  },

  // ------------------------------------------------ NIGHT
  night: {
    key: () => S.chamber?.nightId || "",
    build(el) {
      const g = S.game;
      el.innerHTML = `
      <h2>🌙 Night ${g.day}</h2>
      <p class="muted">Faithfuls sleep. The Traitors confer in the Turret on their phones (or meet you in person). Their nominations appear below — you confirm the outcome.</p>
      <label>Tonight the Traitors will…
        <select id="nightMode">
          <option value="murder">🔪 Murder a Faithful</option>
          <option value="recruit">🤝 Recruit — offer a Faithful to join them</option>
          <option value="ultimatum">⚠️ Recruit by ultimatum — join or be murdered</option>
        </select></label>
      <div data-dyn="noms"></div>
      <label style="margin-top:10px">Target<select id="nightTarget"></select></label>
      <div class="btn-row" data-dyn="btns"></div>
      <div data-dyn="status"></div>
      <div class="btn-row" style="margin-top:18px"><button class="btn btn-primary btn-lg" data-act="go" data-phase="breakfast">🌅 Morning comes → Breakfast (Day ${g.day + 1})</button></div>`;
      el.querySelector("#nightMode").onchange = (e) => run(() => updateDoc(R.chamber(S.code, S.chamberKey), {
        mode: e.target.value,
        status: e.target.value === "murder" ? "Choose who will not wake up tomorrow." : e.target.value === "recruit" ? "Tonight you may RECRUIT. Nominate the Faithful you want to invite." : "Tonight you issue an ULTIMATUM: join us, or die. Nominate your target.",
      }));
    },
    update(el) {
      const g = S.game, ch = S.chamber || {}, s = S.secret || {};
      const modeSel = el.querySelector("#nightMode");
      if (modeSel && document.activeElement !== modeSel && ch.mode) modeSel.value = ch.mode;
      const noms = S.noms.filter((n) => n.nightId && n.nightId === ch.nightId);
      const t = {}; noms.forEach((n) => (t[n.target] = (t[n.target] || 0) + 1));
      const top = Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0];
      const priv = S.privacy;
      dyn(el, "noms", `<h3>Traitor nominations</h3>${priv ? `<p class="muted">Hidden — privacy mode.</p>` : noms.length ? `<ul class="log">${noms.map((n) => `<li>🗡 <b>${esc(pname(g, n.id))}</b> ➜ ${esc(pname(g, n.target))}</li>`).join("")}</ul>
        <p>Leading: <b class="red">${top ? esc(pname(g, top)) : "—"}</b> ${top ? `(${t[top]} of ${alive(g).filter((p) => roleOf(p) === "Traitor").length} living Traitors)` : ""}</p>` : `<p class="muted">No nominations yet.</p>`}`);
      // target select (living Faithful only)
      const sel = el.querySelector("#nightTarget");
      if (sel && document.activeElement !== sel) {
        const opts = alive(g).filter((p) => roleOf(p) !== "Traitor");
        const cur = sel.value; const sig = opts.join(",") + priv;
        if (sel.dataset.sig !== sig) {
          sel.dataset.sig = sig;
          sel.innerHTML = `<option value="">— choose —</option>` + opts.map((p) => `<option value="${p}">${esc(pname(g, p))}${s.shields?.[p] && !priv ? " 🛡" : ""}</option>`).join("");
        }
        sel.value = opts.includes(cur) ? cur : (top && opts.includes(top) ? top : "");
      }
      const mode = ch.mode || "murder";
      dyn(el, "btns", mode === "murder"
        ? `<button class="btn btn-danger" data-act="confirmMurder">🔪 Confirm murder</button><button class="btn btn-ghost" data-act="noMurder">🕊 No murder tonight</button>`
        : `<button class="btn btn-primary" data-act="sendOffer">${mode === "ultimatum" ? "⚠️ Send ultimatum" : "🤝 Send recruitment offer"}</button>`);
      let st = "";
      const pm = s.pendingMurder;
      if (pm && pm.day === g.day) st += `<div class="alert ${pm.blocked ? "alert-blue" : "alert-red"}">${pm.blocked ? "🛡" : "🔪"} Tonight's outcome: <b>${priv ? "(hidden)" : esc(pname(g, pm.pid))}</b> ${pm.blocked ? "was targeted but is SHIELDED — nobody will die." : "will be found murdered at breakfast."}</div>`;
      Object.entries(S.privs).forEach(([p, pv]) => {
        if (pv?.offer && pv.offer.day === g.day) {
          const resp = pv.offerResponse ? (pv.offerResponse === "accept" ? "✅ ACCEPTED" : "❌ DECLINED") : "⏳ awaiting answer…";
          st += `<div class="alert">${pv.offer.type === "ultimatum" ? "⚠️ Ultimatum" : "🤝 Recruitment offer"} to <b>${priv ? "(hidden)" : esc(pname(g, p))}</b>: ${resp}</div>`;
        }
      });
      if (ch.status && !priv) st += `<p class="tiny">Turret sees: “${esc(ch.status)}”</p>`;
      dyn(el, "status", st);
    },
  },

  // ------------------------------------------------ ENDGAME
  endgame: {
    key: () => String(S.game.day),
    build(el) {
      el.innerHTML = `
      <h2>🔥 The Endgame</h2>
      <p>In the Endgame, players vote whether to <b>END</b> the game or <b>BANISH AGAIN</b>. The game only ends if <b>everyone</b> votes END.
      When it ends, all roles are revealed: if <b>any</b> Traitor is still standing, the Traitors steal the entire pot. If only Faithfuls remain, they share it.</p>
      <div data-dyn="c"></div>
      <div class="btn-row">
        <button class="btn btn-primary btn-lg" data-act="openEndVote">🔥 Open END-or-BANISH vote</button>
        <button class="btn" data-act="openBanishVote">🗳 Open a banishment vote</button>
        <button class="btn btn-ghost" data-act="endGame">🏁 End the game now</button>
      </div>
      <div class="timer-ctl"><div class="big-timer" data-dyn="timer">--:--</div>
        <div class="btn-row" style="justify-content:center;align-items:center"><input id="tMin" type="number" min="1" max="120" value="5"> min
          <button class="btn" data-act="timerStart">▶ Start</button><button class="btn" data-act="timerPause">⏯</button><button class="btn btn-ghost" data-act="timerClear">⟲</button></div></div>`;
    },
    update(el) {
      const g = S.game, al = alive(g);
      dyn(el, "c", `<p><b>${al.length}</b> players remain: ${al.map((p) => esc(pname(g, p))).join(", ")}</p>${statusBox()}`);
    },
  },

  // ------------------------------------------------ FINISHED
  finished: {
    key: () => String(S.game.finishedAt || ""),
    build(el) {
      const g = S.game, fr = g.finalRoles || {};
      el.innerHTML = `
      <h2>🏆 ${g.winner === "Traitors" ? "The TRAITORS win!" : "The FAITHFUL win!"}</h2>
      <p>Prize pot: <b class="gold">${money(g.pot, g.currency)}</b> ${g.winners?.length === 1 ? `— all of it goes to <b>${esc(pname(g, g.winners[0]))}</b>` : g.winners?.length ? `— shared by ${g.winners.map((p) => `<b>${esc(pname(g, p))}</b>`).join(", ")} (${money(g.share, g.currency)} each)` : ""}</p>
      <h3>Final roles</h3>
      <div class="table-wrap"><table class="roster">${g.order.map((p) => `<tr><td>${avatarHTML(pname(g, p))}</td><td><b>${esc(pname(g, p))}</b></td><td>${roleBadge(fr[p])}</td><td>${g.players[p].status === "alive" ? `<span class="badge badge-alive">Survived</span>` : `<span class="badge">${g.players[p].status} · Day ${g.players[p].eliminatedDay ?? "?"}</span>`}</td></tr>`).join("")}</table></div>
      <div class="btn-row"><button class="btn btn-primary" data-act="resetGame">🔁 Play again with the same players</button><a class="btn" href="gm.html">🏰 New game</a></div>`;
    },
  },
};

// ---------------------------------------------------------------- roster
function renderRoster() {
  const g = S.game, s = S.secret || {}, el = $("#roster"); if (!el) return;
  const lobby = g.phase === "lobby", manual = lobby && S.selection === "manual";
  const rows = g.order.map((p) => {
    const pl = g.players[p] || {}, pv = S.privs[p] || {}, role = s.roles?.[p];
    const statusTxt = pl.status === "alive" ? "" : pl.status === "murdered" ? `🔪 murdered · day ${pl.eliminatedDay ?? "?"}` : `⚖️ banished · day ${pl.eliminatedDay ?? "?"}`;
    return `<tr class="st-${pl.status}">
      ${manual ? `<td><input type="checkbox" data-act="toggleManual" data-pid="${p}" ${S.manualTraitors.has(p) ? "checked" : ""} title="Make Traitor"></td>` : ""}
      <td>${avatarHTML(pl.name)}</td>
      <td><b>${esc(pl.name)}</b><div class="tiny">${statusTxt}</div></td>
      <td>${lobby ? "" : S.privacy ? `<span class="masked">●●●</span>` : roleBadge(role)}</td>
      <td class="icons">${pl.joined ? `<span title="Logged in">📱</span>` : `<span class="dim" title="Not logged in yet">📵</span>`}${pv.seenRole ? `<span title="Has seen role">👁</span>` : ""}${!S.privacy && s.shields?.[p] ? `<span title="Shield">🛡</span>` : ""}${!S.privacy && s.daggers?.[p] ? `<span title="Dagger">🗡</span>` : ""}</td>
      <td class="mono">${S.privacy ? "••••••" : esc(s.pins?.[p] || "")}</td>
      <td><button class="btn btn-xs" data-act="playerMenu" data-pid="${p}">⋯</button></td></tr>`;
  }).join("");
  el.innerHTML = `<div class="card-head"><h3>👥 Players (${g.order.length})</h3>${manual ? `<span class="tiny">Tick = Traitor</span>` : ""}</div>
    ${g.order.length ? `<div class="table-wrap"><table class="roster">${rows}</table></div>` : `<p class="muted">No players yet. Add names in the Lobby.</p>`}
    <p class="tiny">📱 logged in · 👁 seen role · 🛡 shield · 🗡 dagger · PIN shown for re-sending invites.</p>`;
}

// ---------------------------------------------------------------- chamber monitor
function renderChamber() {
  const el = $("#chamberCard"); if (!el || !S.game) return;
  if (!S.chamberKey) { el.innerHTML = `<h3>🗼 The Turret (Traitors' chamber)</h3><p class="muted">Opens when roles are assigned.</p>`; S.chamberBuiltFor = null; return; }
  if (S.chamberBuiltFor !== S.chamberKey) {
    S.chamberBuiltFor = S.chamberKey;
    el.innerHTML = `<div class="card-head"><h3>🗼 The Turret (Traitors' chamber)</h3><span class="tiny">GM view</span></div>
      <div data-dyn="ct"></div><div class="chat" data-dyn="chat"></div>
      <form class="chat-form" id="gmChatForm"><input id="gmChatText" maxlength="300" placeholder="Message the Traitors as Game Master…"><button class="btn">Send</button></form>`;
    el.querySelector("#gmChatForm").onsubmit = async (e) => {
      e.preventDefault(); const t = $("#gmChatText").value.trim(); if (!t) return;
      try { await setDoc(R.newMsg(S.code, S.chamberKey), { from: "GM", name: "Game Master", text: t, ts: Date.now(), system: true }); $("#gmChatText").value = ""; }
      catch (err) { toast(errMsg(err), "error"); }
    };
  }
  const g = S.game;
  const ct = el.querySelector('[data-dyn="ct"]'), chat = el.querySelector('[data-dyn="chat"]');
  if (S.privacy) { ct.innerHTML = `<p class="muted">Hidden — privacy mode is on.</p>`; chat.innerHTML = ""; return; }
  const traitors = g.order.filter((p) => roleOf(p) === "Traitor");
  ct.innerHTML = `<p class="small">Traitors: ${traitors.map((p) => `<b class="${g.players[p]?.status === "alive" ? "red" : "dim"}">${esc(pname(g, p))}</b>`).join(", ") || "—"} · Mode: <b>${esc(S.chamber?.mode || "—")}</b></p>`;
  const atBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 20;
  chat.innerHTML = S.msgs.length ? S.msgs.map((m) => `<div class="msg ${m.system ? "sys" : ""}"><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join("") : `<p class="muted small">No messages yet.</p>`;
  if (atBottom) chat.scrollTop = chat.scrollHeight;
}

// ---------------------------------------------------------------- log
function renderLog() {
  const el = $("#logCard"); if (!el) return;
  const g = S.game;
  const list = S.showGmLog ? [...(S.secret?.gmLog || [])] : [...(g.log || [])];
  el.innerHTML = `<div class="card-head"><h3>📜 ${S.showGmLog ? "Secret GM log" : "Public game log"}</h3><button class="btn btn-xs" data-act="toggleLog">${S.showGmLog ? "Show public log" : "Show secret GM log"}</button></div>
    ${S.showGmLog && S.privacy ? `<p class="muted">Hidden — privacy mode.</p>` : `<ul class="log">${list.reverse().map((x) => `<li><span class="d">D${x.day}</span>${esc(x.text)}</li>`).join("") || "<li class='muted'>Nothing yet.</li>"}</ul>`}`;
}

// ---------------------------------------------------------------- action dispatcher
async function run(fn, btn) {
  try { btn?.classList.add("busy"); await fn(); }
  catch (e) { console.error(e); toast(errMsg(e), "error", 6000); }
  finally { btn?.classList.remove("busy"); }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (!b || !S.game) return;
  const fn = ACT[b.dataset.act]; if (!fn) return;
  if (b.tagName !== "INPUT") e.preventDefault();
  run(() => fn(b), b);
});

const ACT = {
  privacy() { S.privacy = !S.privacy; localStorage.setItem("traitors.gm.privacy", S.privacy ? "1" : "0"); S.chamberBuiltFor = null; render(); },
  copyLink() { return copyText(pageUrl("play.html", { g: S.code })); },
  toggleLog() { S.showGmLog = !S.showGmLog; renderLog(); },
  go(b) { return goPhase(b.dataset.phase); },
  toggleManual(b) { b.checked ? S.manualTraitors.add(b.dataset.pid) : S.manualTraitors.delete(b.dataset.pid); PANELS.lobby.update($("#panel")); },

  // lobby
  addPlayers: () => addPlayers(),
  copyAllInvites() { return copyText(S.game.order.map((p) => inviteText(p)).join("\n\n────────────\n\n")); },
  printSlips: () => printSlips(),
  startGame: () => startGame(),
  playerMenu: (b) => playerMenu(b.dataset.pid),

  // timer
  timerStart() { const m = Math.max(1, Number($("#tMin")?.value) || 10); return upd({ timer: { running: true, endsAt: Date.now() + m * 60000, total: m * 60 } }); },
  timerPause() {
    const t = S.game.timer; if (!t) return;
    return upd({ timer: t.running ? { running: false, remaining: timerRemaining(t), total: t.total } : { running: true, endsAt: Date.now() + (t.remaining || 0) * 1000, total: t.total } });
  },
  timerAdd() {
    const t = S.game.timer; if (!t) return;
    return upd({ timer: t.running ? { ...t, endsAt: t.endsAt + 60000 } : { ...t, remaining: (t.remaining || 0) + 60 } });
  },
  timerClear() { return upd({ timer: null }); },

  // voting
  openBanishVote() { const al = alive(S.game); return openVote("banish", al, al, ""); },
  openEndVote() { const al = alive(S.game); return openVote("endgame", al, ["END", "BANISH"], "Unanimous END finishes the game. Anything else means another banishment."); },
  closeVote: () => closeVote(),
  async cancelVote() {
    if (!await confirmBox("Cancel this vote?", "All ballots cast so far will be discarded.", "Cancel vote", true)) return;
    await upd({ vote: null, phase: S.game.vote?.kind === "endgame" ? "endgame" : "roundtable", announce: ann("text", { text: "The vote has been cancelled by the Game Master." }) });
  },
  revealNext: () => revealNext(false),
  revealAll: () => revealNext(true),
  banish: (b) => banish(b.dataset.pid),
  revote() {
    const g = S.game, ids = g.reveal?.result?.ids || [];
    let voters = g.settings?.tiedCanVote ? alive(g) : alive(g).filter((p) => !ids.includes(p));
    if (!voters.length) voters = alive(g);
    return openVote("banish", voters, ids, `Tie-break revote between ${ids.map((p) => pname(g, p)).join(" & ")}`);
  },
  async randomDraw() {
    const ids = S.game.reveal?.result?.ids || []; if (!ids.length) return;
    const pick = shuffle(ids)[0];
    if (!await confirmBox("Random draw", `The draw selected <b>${esc(pname(S.game, pick))}</b>. Banish them?`, "Banish")) return;
    await banish(pick, "by random draw");
  },
  async gmChoose() {
    const g = S.game, ids = g.reveal?.result?.ids || [];
    const pick = await modal({ title: "👑 Game Master decides", body: "Choose who will be banished:", actions: [...ids.map((p) => ({ label: pname(g, p), value: p, cls: "btn-danger" })), { label: "Cancel", value: null, cls: "btn-ghost" }] });
    if (pick) await banish(pick, "by the Game Master's decision");
  },
  async noBanish() {
    if (!await confirmBox("No banishment?", "Nobody will be banished this round.", "Confirm")) return;
    await upd({ phase: "banishment", banish: { pid: null, day: S.game.day }, announce: ann("text", { text: "The Round Table could not decide. Nobody is banished… tonight." }), log: arrayUnion(L("🙅 Nobody was banished.")) });
  },
  revealRole: () => revealRole(),

  // breakfast / night
  revealBreakfast: () => revealBreakfast(),
  confirmMurder: () => confirmMurder(),
  async noMurder() {
    if (!await confirmBox("No murder tonight?", "Everyone will survive the night.", "Confirm")) return;
    const b = writeBatch(db);
    b.update(R.secret(S.code), { pendingMurder: null, gmLog: arrayUnion(L(`Night ${S.game.day}: no murder.`)) });
    b.update(R.chamber(S.code, S.chamberKey), { status: "There will be no murder tonight." });
    await b.commit();
  },
  sendOffer: () => sendOffer(),
  appointTraitor: () => appointTraitor(),

  // end
  endGame: () => endGame(),
  finish: (b) => endGame(b.dataset.winner),
  resetGame: () => resetGame(),
};

// ---------------------------------------------------------------- phase changes
async function goPhase(p) {
  const g = S.game;
  if (p === g.phase && p !== "night") return;
  if (g.vote?.open && !await confirmBox("Leave the vote?", "A vote is still open. Moving on will abandon it.", "Leave anyway", true)) return;
  if (p === "night" && g.phase === "night" && !await confirmBox("Restart the night?", "This clears tonight's nominations and starts the night again.", "Restart night")) return;
  const patch = { phase: p };
  if (g.vote?.open) patch.vote = null;
  if (p === "night") {
    if (!S.chamberKey) return toast("Assign roles first.", "error");
    await updateDoc(R.chamber(S.code, S.chamberKey), { mode: "murder", nightId: randStr(8), day: g.day, status: "Night has fallen. Discuss, then nominate who will not wake up tomorrow." });
    await setDoc(R.newMsg(S.code, S.chamberKey), { from: "GM", name: "Game Master", system: true, text: `🌙 Night ${g.day} has begun. Make your nominations.`, ts: Date.now() });
    patch.announce = ann("night", { text: "🌙 Night falls on the castle… Faithfuls, sleep well. Traitors — to the Turret." });
    patch.timer = null; patch.log = arrayUnion(L(`🌙 Night ${g.day} fell.`));
  }
  if (p === "breakfast") {
    if (g.phase === "night") patch.day = (g.day || 0) + 1;
    patch.breakfastDone = false;
    patch.announce = ann("text", { text: "☕ Good morning. Breakfast is served… but is anyone missing?" });
  }
  if (p === "mission") patch.announce = ann("text", { text: "⚔️ Mission time! Earn money for the prize pot." });
  if (p === "roundtable") { patch.timer = null; patch.announce = ann("text", { text: "🪑 Take your seats at the Round Table." }); }
  if (p === "endgame") { patch.announce = ann("text", { text: "🔥 The Endgame has begun." }); patch.log = arrayUnion(L(`🔥 The Endgame began with ${alive(g).length} players.`)); }
  await upd(patch);
}

// ---------------------------------------------------------------- lobby actions
async function addPlayers() {
  const ta = $("#newNames"); const g = S.game;
  const existing = new Set(g.order.map((p) => g.players[p].name.toLowerCase()));
  const names = [...new Set(ta.value.split(/\n|,/).map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean))].filter((n) => n.length <= 40);
  const fresh = names.filter((n) => !existing.has(n.toLowerCase()));
  if (!fresh.length) return toast(names.length ? "Those players already exist." : "Type at least one name.", "error");
  if (g.order.length + fresh.length > 60) return toast("Maximum 60 players.", "error");
  const b = writeBatch(db); const gp = {}; const sp = {}; const pids = [];
  for (const name of fresh) {
    const pid = "p" + randStr(7).toLowerCase(), pin = randStr(6), key = await playerKey(S.code, pid, pin);
    pids.push(pid);
    gp[`players.${pid}`] = { name, status: "alive", joined: false, revealedRole: null, shieldPublic: false, eliminatedDay: null };
    sp[`pins.${pid}`] = pin; sp[`keys.${pid}`] = key;
    b.set(R.priv(S.code, key), { playerId: pid, name, role: null, fellows: [], shield: false, dagger: false, offer: null, offerResponse: null, notice: null, seenRole: false });
  }
  gp.order = arrayUnion(...pids);
  b.update(R.secret(S.code), sp);
  b.update(R.game(S.code), gp);
  await b.commit();
  ta.value = ""; toast(`${fresh.length} player(s) added`, "ok");
}

function inviteText(pid) {
  const g = S.game, pin = S.secret?.pins?.[pid];
  return `🗡 THE TRAITORS — ${g.name}\nHi ${pname(g, pid)}! Tap your personal link to join:\n${pageUrl("play.html", { g: g.code, p: pid, k: pin })}\n\nGame code: ${g.code}\nYour secret PIN: ${pin}\n🤫 Do not share this link or PIN with anyone.`;
}

function printSlips() {
  const g = S.game, w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print slips.", "error");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>PIN slips — ${esc(g.name)}</title><link rel="stylesheet" href="${new URL("css/style.css", location.href).href}"></head>
  <body style="background:#fff;color:#000"><div class="no-print" style="padding:10px"><button onclick="print()">🖨 Print</button> Cut along the dashed lines and hand each slip privately.</div>
  <div class="slips">${g.order.map((p) => {
    const url = pageUrl("play.html", { g: g.code, p, k: S.secret.pins[p] });
    return `<div class="slip"><img src="${qrUrl(url, 220)}" alt="QR"><div><div style="font-size:.8rem;letter-spacing:.2em">THE TRAITORS · ${esc(g.name)}</div>
      <div style="font-size:1.3rem;font-weight:700;margin:4px 0">${esc(pname(g, p))}</div><div>Game code: <b>${g.code}</b></div><div>PIN: <span class="pin">${S.secret.pins[p]}</span></div>
      <div style="font-size:.7rem;margin-top:4px">Scan the QR, or open ${esc(pageUrl("play.html"))}</div></div></div>`;
  }).join("")}</div></body></html>`);
  w.document.close();
}

async function startGame() {
  const g = S.game, pids = [...g.order], n = pids.length;
  if (n < 4) return toast("Add at least 4 players.", "error");
  let traitors;
  if (S.selection === "manual") {
    traitors = [...S.manualTraitors].filter((p) => pids.includes(p));
    if (!traitors.length) return toast("Tick at least one Traitor in the roster.", "error");
  } else {
    const t = Number(g.settings?.numTraitors) || recommendedTraitors(n);
    traitors = shuffle(pids).slice(0, t);
  }
  if (traitors.length >= n - traitors.length) return toast("Too many Traitors — they must be fewer than the Faithful.", "error");
  const notJoined = pids.filter((p) => !g.players[p].joined);
  if (!await confirmBox("Assign roles?", `<b>${traitors.length}</b> Traitor(s) will be secretly chosen among <b>${n}</b> players.${notJoined.length ? `<br><br>⚠️ ${notJoined.length} player(s) haven't logged in yet. They can still log in later and see their role.` : ""}`, "🎭 Assign roles")) return;

  const tKey = randHex(16), roles = {};
  pids.forEach((p) => (roles[p] = traitors.includes(p) ? "Traitor" : "Faithful"));
  const fellows = traitors.map((p) => ({ pid: p, name: pname(g, p) }));
  const b = writeBatch(db);
  b.update(R.secret(S.code), { roles, traitorKey: tKey, shields: {}, daggers: {}, pendingMurder: null, revealQueue: [], revealResult: null, gmLog: arrayUnion(L(`🎭 Traitors chosen: ${fellows.map((f) => f.name).join(", ")}`)) });
  pids.forEach((p) => {
    const isT = roles[p] === "Traitor";
    b.update(R.priv(S.code, keyOf(p)), { role: roles[p], traitorKey: isT ? tKey : deleteField(), fellows: isT ? fellows : [], seenRole: false, shield: false, dagger: false, offer: null, offerResponse: null, notice: null });
  });
  b.set(R.chamber(S.code, tKey), { mode: "murder", nightId: null, day: 1, status: "Welcome to the Turret, Traitors. When night falls, you will choose who does not wake up.", createdAt: Date.now() });
  b.update(R.game(S.code), {
    phase: "roles", day: 1, startedAt: Date.now(), breakfastDone: false,
    log: arrayUnion(L(`🎭 The game has begun with ${n} players. ${traitors.length} Traitor(s) walk among you.`)),
    announce: ann("text", { text: "🎭 Roles have been assigned. Check your phone — in private!" }),
  });
  await b.commit();
  await setDoc(R.newMsg(S.code, tKey), { from: "GM", name: "Game Master", system: true, text: `Welcome, Traitors: ${fellows.map((f) => f.name).join(", ")}. Trust no one… except each other.`, ts: Date.now() });
  S.manualTraitors.clear();
}

async function playerMenu(pid) {
  const g = S.game, s = S.secret || {}, pl = g.players[pid]; if (!pl) return;
  const started = !!s.traitorKey && g.phase !== "lobby";
  const acts = [
    { label: "📋 Copy personal invite", value: "invite" },
    { label: "✏️ Rename", value: "rename" },
    { label: "🔄 Reset login (force re-login)", value: "unclaim" },
    { label: "🎲 Issue a new PIN", value: "newpin" },
  ];
  if (started) {
    if (pl.status !== "alive") acts.push({ label: "♻️ Restore to alive", value: "revive" });
    if (pl.status === "alive") acts.push({ label: "🔪 Mark as murdered", value: "murder" }, { label: "⚖️ Mark as banished", value: "banished" });
    acts.push(roleOf(pid) === "Traitor" ? { label: "🛡 Change role to Faithful", value: "toFaithful" } : { label: "🗡 Change role to Traitor", value: "toTraitor" });
  }
  acts.push({ label: "🗑 Remove player", value: "remove", cls: "btn-danger" });
  const choice = await new Promise((res) => {
    const wrap = h(`<div class="modal-backdrop"><div class="modal"><h3>${esc(pl.name)}</h3><p class="tiny">PIN: <span class="mono">${esc(s.pins?.[pid] || "")}</span></p><div class="btn-col"></div><div class="modal-actions"><button class="btn btn-ghost">Close</button></div></div></div>`);
    const col = wrap.querySelector(".btn-col");
    acts.forEach((a) => { const bt = h(`<button class="btn ${a.cls || ""}"></button>`); bt.textContent = a.label; bt.onclick = () => { wrap.remove(); res(a.value); }; col.append(bt); });
    wrap.querySelector(".modal-actions button").onclick = () => { wrap.remove(); res(null); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) { wrap.remove(); res(null); } });
    document.body.append(wrap);
  });
  if (!choice) return;
  const key = keyOf(pid);
  switch (choice) {
    case "invite": return copyText(inviteText(pid));
    case "rename": {
      const nn = await promptBox("Rename player", "New name", pl.name); if (!nn || nn === pl.name) return;
      const b = writeBatch(db);
      b.update(R.game(S.code), { [`players.${pid}.name`]: nn });
      b.update(R.priv(S.code, key), { name: nn });
      await b.commit(); return refreshFellows();
    }
    case "unclaim": { const b = writeBatch(db); b.delete(R.claim(S.code, pid)); await b.commit(); return toast("Login reset. The player must log in again.", "ok"); }
    case "newpin": {
      if (!await confirmBox("Issue a new PIN?", `${esc(pl.name)}'s old PIN and link will stop working.`, "Issue new PIN")) return;
      const pin = randStr(6), nkey = await playerKey(S.code, pid, pin);
      const snap = await getDoc(R.priv(S.code, key));
      const b = writeBatch(db);
      b.set(R.priv(S.code, nkey), snap.data() || { playerId: pid, name: pl.name, role: null });
      b.delete(R.priv(S.code, key));
      b.delete(R.claim(S.code, pid));
      b.update(R.secret(S.code), { [`pins.${pid}`]: pin, [`keys.${pid}`]: nkey });
      await b.commit();
      toast(`New PIN for ${pl.name}: ${pin}`, "ok", 8000); return;
    }
    case "revive": return upd({ [`players.${pid}.status`]: "alive", [`players.${pid}.revealedRole`]: null, [`players.${pid}.eliminatedDay`]: null, log: arrayUnion(L(`♻️ ${pl.name} was restored by the Game Master.`)) });
    case "murder":
      if (!await confirmBox("Mark as murdered?", `This is a manual correction for ${esc(pl.name)}.`, "Mark murdered", true)) return;
      return upd({ [`players.${pid}.status`]: "murdered", [`players.${pid}.revealedRole`]: roleOf(pid) || "Faithful", [`players.${pid}.eliminatedDay`]: g.day, log: arrayUnion(L(`🔪 ${pl.name} was marked as murdered.`)) });
    case "banished":
      if (!await confirmBox("Mark as banished?", `This is a manual correction for ${esc(pl.name)}. Their role will be revealed.`, "Mark banished", true)) return;
      return upd({ [`players.${pid}.status`]: "banished", [`players.${pid}.revealedRole`]: roleOf(pid) || "Faithful", [`players.${pid}.eliminatedDay`]: g.day, log: arrayUnion(L(`⚖️ ${pl.name} was marked as banished.`)) });
    case "toTraitor":
      if (!await confirmBox("Make Traitor?", `${esc(pl.name)} will secretly become a Traitor and gain Turret access.`, "Make Traitor")) return;
      return convertToTraitor(pid, { notice: "The Game Master has made you a TRAITOR. Open the Turret tab.", via: "set by GM" });
    case "toFaithful":
      if (!await confirmBox("Make Faithful?", `${esc(pl.name)} will lose Traitor status and Turret access.`, "Make Faithful")) return;
      return demoteToFaithful(pid);
    case "remove": {
      if (!await confirmBox("Remove player?", `${esc(pl.name)} will be removed from the game completely.`, "Remove", true)) return;
      const wasTraitor = roleOf(pid) === "Traitor";
      const b = writeBatch(db);
      b.update(R.game(S.code), { [`players.${pid}`]: deleteField(), order: arrayRemove(pid) });
      b.update(R.secret(S.code), { [`pins.${pid}`]: deleteField(), [`keys.${pid}`]: deleteField(), [`roles.${pid}`]: deleteField(), [`shields.${pid}`]: deleteField(), [`daggers.${pid}`]: deleteField() });
      if (key) b.delete(R.priv(S.code, key));
      b.delete(R.claim(S.code, pid));
      await b.commit(); S.manualTraitors.delete(pid);
      if (wasTraitor) { const r = { ...S.secret.roles }; delete r[pid]; await refreshFellows(r); }
      return toast(`${pl.name} removed`, "ok");
    }
  }
}

// ---------------------------------------------------------------- traitor membership
async function refreshFellows(rolesOverride = null) {
  const g = S.game, roles = rolesOverride || S.secret.roles || {};
  const traitors = g.order.filter((p) => roles[p] === "Traitor" && keyOf(p));
  if (!traitors.length) return;
  const fellows = traitors.map((p) => ({ pid: p, name: pname(g, p) }));
  const b = writeBatch(db);
  traitors.forEach((p) => b.update(R.priv(S.code, keyOf(p)), { fellows }));
  await b.commit();
}

async function convertToTraitor(pid, opts = {}) {
  const g = S.game, s = S.secret; let key = s.traitorKey; const b = writeBatch(db);
  const sp = { [`roles.${pid}`]: "Traitor", gmLog: arrayUnion(L(`🗡 ${pname(g, pid)} became a Traitor${opts.via ? ` (${opts.via})` : ""}.`)) };
  if (!key) { key = randHex(16); sp.traitorKey = key; b.set(R.chamber(S.code, key), { mode: "murder", nightId: null, day: g.day, status: "", createdAt: Date.now() }); }
  const roles = { ...s.roles, [pid]: "Traitor" };
  const traitors = g.order.filter((p) => roles[p] === "Traitor" && keyOf(p));
  const fellows = traitors.map((p) => ({ pid: p, name: pname(g, p) }));
  b.update(R.secret(S.code), sp);
  traitors.forEach((p) => {
    b.update(R.priv(S.code, keyOf(p)), p === pid
      ? { role: "Traitor", traitorKey: key, fellows, notice: opts.notice || "You are now a TRAITOR. Welcome to the Turret.", noticeSeen: false, ...(opts.offerHandled ? { "offer.handled": true } : {}) }
      : { fellows });
  });
  b.set(R.newMsg(S.code, key), { from: "GM", name: "Game Master", system: true, text: `🗡 ${pname(g, pid)} has joined the Traitors.`, ts: Date.now() });
  b.update(R.chamber(S.code, key), { status: `${pname(g, pid)} is now one of you.` });
  await b.commit();
  toast(`${pname(g, pid)} is now a Traitor`, "ok");
}

async function demoteToFaithful(pid) {
  const g = S.game, s = S.secret; const b = writeBatch(db);
  b.update(R.secret(S.code), { [`roles.${pid}`]: "Faithful", gmLog: arrayUnion(L(`🛡 ${pname(g, pid)} was changed to Faithful by the GM.`)) });
  b.update(R.priv(S.code, keyOf(pid)), { role: "Faithful", traitorKey: deleteField(), fellows: [], notice: "The Game Master has changed your role. You are now FAITHFUL.", noticeSeen: false });
  await b.commit();
  await refreshFellows({ ...s.roles, [pid]: "Faithful" });
}

async function appointTraitor() {
  const g = S.game, cands = alive(g).filter((p) => roleOf(p) !== "Traitor");
  if (!cands.length) return toast("No living Faithful to appoint.", "error");
  const pick = await modal({ title: "🎭 Appoint a new Traitor", body: "Choose (or let fate choose) who secretly becomes a Traitor:",
    actions: [{ label: "🎲 Random", value: "__random", cls: "btn-gold" }, ...cands.map((p) => ({ label: pname(g, p), value: p })), { label: "Cancel", value: null, cls: "btn-ghost" }] });
  if (!pick) return;
  const pid = pick === "__random" ? shuffle(cands)[0] : pick;
  await convertToTraitor(pid, { notice: "The Game Master has chosen you. You are now a TRAITOR. Open the Turret.", via: "appointed by GM" });
  await upd({ announce: ann("text", { text: "🎭 Something has changed in the castle… a new Traitor walks among you." }), log: arrayUnion(L("🎭 A new Traitor has been secretly appointed.")) });
}

// ---------------------------------------------------------------- voting
async function openVote(kind, voters, candidates, label) {
  if (!voters.length) return toast("No eligible voters.", "error");
  const g = S.game, id = (kind === "endgame" ? "E" : "B") + g.day + randStr(4);
  await updSecret({ revealQueue: [], revealResult: null });
  await upd({
    phase: "voting", vote: { id, kind, open: true, voters, candidates, submitted: [], label: label || "", openedAt: Date.now() },
    reveal: null, timer: null,
    announce: ann("text", { text: kind === "endgame" ? "🔥 Endgame vote: END the game or BANISH again? Vote on your phone." : (label ? `🗳 ${label} — vote on your phone.` : "🗳 Voting is open! Cast your vote secretly on your phone.") }),
  });
}

async function closeVote() {
  const g = S.game, v = g.vote, s = S.secret; if (!v) return;
  const got = new Map(S.votes.filter((x) => x.voteId === v.id && v.voters.includes(x.voter)).map((x) => [x.voter, x]));
  const missing = v.voters.filter((p) => !got.has(p));
  if (missing.length && !await confirmBox("Close voting?", `${missing.length} player(s) haven't voted: <b>${missing.map((p) => esc(pname(g, p))).join(", ")}</b>. They will count as “no vote”.`, "Close anyway")) return;
  const items = [], daggerUse = [];
  for (const p of shuffle(v.voters)) {
    const x = got.get(p);
    if (!x) { items.push({ voter: p, target: null, weight: 0, note: "No vote" }); continue; }
    const valid = v.candidates.includes(x.target) && (v.kind === "endgame" || x.target !== p);
    let weight = valid ? 1 : 0;
    if (valid && v.kind === "banish" && x.dagger && s.daggers?.[p]) { weight = 2; daggerUse.push(p); }
    items.push({ voter: p, target: valid ? x.target : null, weight, dagger: weight === 2, note: valid ? "" : "Invalid vote" });
  }
  items.sort((a, b) => (a.target ? 0 : 1) - (b.target ? 0 : 1)); // no-votes last
  const tally = {}; items.forEach((i) => { if (i.target) tally[i.target] = (tally[i.target] || 0) + i.weight; });
  const max = Math.max(0, ...Object.values(tally)), tops = Object.keys(tally).filter((k) => tally[k] === max);
  const result = max === 0 ? { type: "none", ids: [] } : tops.length === 1 ? { type: "single", ids: tops } : { type: "tie", ids: tops };
  if (v.kind === "endgame") result.unanimousEnd = items.length > 0 && items.every((i) => i.target === "END");
  const b = writeBatch(db); const sp = { revealQueue: items, revealResult: { ...result, tally } };
  daggerUse.forEach((p) => { sp[`daggers.${p}`] = deleteField(); b.update(R.priv(S.code, keyOf(p)), { dagger: false }); });
  b.update(R.secret(S.code), sp);
  b.update(R.game(S.code), { "vote.open": false, phase: "reveal", reveal: { voteId: v.id, kind: v.kind, items: [], total: items.length, done: false }, announce: ann("text", { text: "🔒 Voting is closed. Time for the reveal…" }) });
  await b.commit();
}

async function revealNext(all) {
  const g = S.game, r = g.reveal, q = S.secret?.revealQueue || []; if (!r) return;
  const n = all ? q.length : Math.min(q.length, (r.items || []).length + 1);
  const items = q.slice(0, n), done = n >= q.length;
  const patch = { "reveal.items": items, "reveal.done": done };
  if (done) {
    const res = S.secret.revealResult || {};
    patch["reveal.result"] = res;
    const t = res.tally || {};
    patch.log = arrayUnion(L(`🗳 ${r.kind === "endgame" ? "Endgame vote" : "Votes"}: ${Object.entries(t).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${pname(g, p)} ${c}`).join(", ") || "none"}`));
  }
  await upd(patch);
}

async function banish(pid, how = "") {
  const g = S.game, nm = pname(g, pid);
  await upd({
    phase: "banishment", banish: { pid, roleRevealed: false, day: g.day },
    [`players.${pid}.status`]: "banished", [`players.${pid}.eliminatedDay`]: g.day,
    announce: ann("banish", { pid, name: nm, text: `⚖️ ${nm} has been banished${how ? " " + how : ""}.` }),
    log: arrayUnion(L(`⚖️ ${nm} was banished${how ? " " + how : " by the Round Table"}.`)),
  });
}

async function revealRole() {
  const g = S.game, pid = g.banish?.pid; if (!pid) return;
  const role = roleOf(pid) || "Faithful", nm = pname(g, pid);
  await upd({
    "banish.roleRevealed": true, [`players.${pid}.revealedRole`]: role,
    announce: ann("role", { pid, name: nm, role }),
    log: arrayUnion(L(`🎭 ${nm} was ${role === "Traitor" ? "a TRAITOR" : "FAITHFUL"}.`)),
  });
}

// ---------------------------------------------------------------- night
async function confirmMurder() {
  const g = S.game, s = S.secret, pid = $("#nightTarget")?.value;
  if (!pid) return toast("Choose a target.", "error");
  if (roleOf(pid) === "Traitor") return toast("Traitors cannot murder a Traitor.", "error");
  const blocked = !!s.shields?.[pid], nm = pname(g, pid);
  if (!await confirmBox("Confirm the murder", `${esc(nm)} ${blocked ? "holds a 🛡 <b>Shield</b> — the murder will FAIL and nobody dies." : "will be found murdered at breakfast."}`, blocked ? "Confirm (blocked)" : "🔪 Confirm", !blocked)) return;
  const b = writeBatch(db);
  b.update(R.secret(S.code), { pendingMurder: { pid, blocked, day: g.day }, gmLog: arrayUnion(L(`🔪 Night ${g.day}: Traitors chose ${nm}${blocked ? " — BLOCKED by a shield" : ""}.`)) });
  const msg = blocked ? `🛡 ${nm} was protected by a Shield. Your murder attempt has FAILED.` : `🔪 It is done. ${nm} will not wake up tomorrow.`;
  b.update(R.chamber(S.code, S.chamberKey), { status: msg });
  b.set(R.newMsg(S.code, S.chamberKey), { from: "GM", name: "Game Master", system: true, text: msg, ts: Date.now() });
  await b.commit();
}

async function sendOffer() {
  const g = S.game, pid = $("#nightTarget")?.value, mode = S.chamber?.mode;
  if (!pid) return toast("Choose who to approach.", "error");
  if (roleOf(pid) === "Traitor") return toast("That player is already a Traitor.", "error");
  const nm = pname(g, pid);
  if (!await confirmBox(mode === "ultimatum" ? "Send ultimatum?" : "Send recruitment offer?", `${esc(nm)} will see a private prompt on their phone${mode === "ultimatum" ? ": join the Traitors, or be murdered." : " inviting them to join the Traitors."}`, "Send")) return;
  const b = writeBatch(db);
  b.update(R.priv(S.code, keyOf(pid)), { offer: { type: mode, ts: Date.now(), day: g.day, handled: false }, offerResponse: null });
  b.update(R.chamber(S.code, S.chamberKey), { status: `${mode === "ultimatum" ? "⚠️ Ultimatum" : "🤝 Offer"} sent to ${nm}. Awaiting their answer…` });
  b.update(R.secret(S.code), { gmLog: arrayUnion(L(`${mode === "ultimatum" ? "⚠️ Ultimatum" : "🤝 Recruitment offer"} sent to ${nm}.`)) });
  await b.commit();
}

async function handleOffer(pid) {
  const pv = S.privs[pid]; if (!pv?.offer || pv.offer.handled || !pv.offerResponse || !S.secret || !S.game) return;
  const tag = pid + "|" + pv.offer.ts; if (S.handledOffers.has(tag)) return; S.handledOffers.add(tag);
  const g = S.game, nm = pname(g, pid), type = pv.offer.type;
  try {
    if (pv.offerResponse === "accept") {
      await convertToTraitor(pid, { offerHandled: true, via: type === "ultimatum" ? "accepted ultimatum" : "accepted recruitment", notice: "You have joined the TRAITORS. Open the Turret tab." });
      toast(`${nm} ACCEPTED and is now a Traitor`, "ok", 6000);
    } else {
      const b = writeBatch(db);
      b.update(R.priv(S.code, keyOf(pid)), { "offer.handled": true });
      if (type === "ultimatum") {
        b.update(R.secret(S.code), { pendingMurder: { pid, blocked: false, ultimatum: true, day: g.day }, gmLog: arrayUnion(L(`⚠️ ${nm} refused the ultimatum and will be murdered.`)) });
        b.update(R.chamber(S.code, S.chamberKey), { status: `${nm} refused your ultimatum. They will not wake up tomorrow.` });
        b.set(R.newMsg(S.code, S.chamberKey), { from: "GM", name: "Game Master", system: true, text: `⚠️ ${nm} refused the ultimatum — and has paid the price.`, ts: Date.now() });
      } else {
        b.update(R.secret(S.code), { gmLog: arrayUnion(L(`🤝 ${nm} declined recruitment.`)) });
        b.update(R.chamber(S.code, S.chamberKey), { mode: "murder", status: `${nm} refused to join you. You may still choose to murder tonight.` });
        b.set(R.newMsg(S.code, S.chamberKey), { from: "GM", name: "Game Master", system: true, text: `❌ ${nm} declined your offer. You may now nominate a murder.`, ts: Date.now() });
      }
      await b.commit();
      toast(`${nm} DECLINED`, "info", 6000);
    }
  } catch (e) { S.handledOffers.delete(tag); toast(errMsg(e), "error"); }
}

async function revealBreakfast() {
  const g = S.game, s = S.secret, pm = s.pendingMurder;
  const b = writeBatch(db), gp = { breakfastDone: true };
  if (pm && !pm.blocked && g.players[pm.pid]?.status === "alive") {
    const nm = pname(g, pm.pid);
    gp[`players.${pm.pid}.status`] = "murdered";
    gp[`players.${pm.pid}.revealedRole`] = s.roles?.[pm.pid] || "Faithful";
    gp[`players.${pm.pid}.eliminatedDay`] = g.day;
    gp.announce = ann("murder", { pid: pm.pid, name: nm, text: `🔪 ${nm} was murdered in the night.` });
    gp.log = arrayUnion(L(`🔪 ${nm} was murdered by the Traitors.`));
  } else {
    gp.announce = ann("nomurder", { text: "🌅 Everyone made it through the night… this time." });
    gp.log = arrayUnion(L("🌅 Nobody was murdered last night."));
  }
  Object.keys(s.shields || {}).forEach((p) => keyOf(p) && b.update(R.priv(S.code, keyOf(p)), { shield: false }));
  g.order.forEach((p) => { if (g.players[p]?.shieldPublic) gp[`players.${p}.shieldPublic`] = false; });
  b.update(R.secret(S.code), { pendingMurder: null, shields: {} });
  b.update(R.game(S.code), gp);
  await b.commit();
}

// ---------------------------------------------------------------- mission
async function recordMission(fd, form) {
  const g = S.game, title = String(fd.get("title") || "").trim() || "Mission";
  const amount = Math.max(0, Number(fd.get("amount")) || 0);
  const shields = fd.getAll("shield"), dagger = fd.get("dagger") || "", pub = !!fd.get("publicShield");
  const b = writeBatch(db), sp = {}, gp = { pot: increment(amount), missions: arrayUnion({ t: Date.now(), day: g.day, title, amount }) };
  let text = `⚔️ ${title}: ${money(amount, g.currency)} added to the prize pot!`;
  const logs = [L(`⚔️ Mission “${title}”: +${money(amount, g.currency)}`)], gmLogs = [];
  if (shields.length) {
    shields.forEach((p) => { sp[`shields.${p}`] = true; b.update(R.priv(S.code, keyOf(p)), { shield: true }); if (pub) gp[`players.${p}.shieldPublic`] = true; });
    const names = shields.map((p) => pname(g, p)).join(", ");
    text += pub ? ` 🛡 Shields won by: ${names}.` : ` 🛡 ${shields.length} Shield(s) were awarded in secret.`;
    logs.push(L(pub ? `🛡 Shields: ${names}` : `🛡 ${shields.length} Shield(s) awarded secretly.`));
    gmLogs.push(L(`🛡 Shields → ${names}`));
  }
  if (dagger) {
    sp[`daggers.${dagger}`] = true; b.update(R.priv(S.code, keyOf(dagger)), { dagger: true });
    text += " 🗡 A Dagger has been awarded in secret.";
    gmLogs.push(L(`🗡 Dagger → ${pname(g, dagger)}`));
  }
  if (gmLogs.length) sp.gmLog = arrayUnion(...gmLogs);
  if (Object.keys(sp).length) b.update(R.secret(S.code), sp);
  gp.log = arrayUnion(...logs);
  gp.announce = ann("mission", { text });
  b.update(R.game(S.code), gp);
  await b.commit();
  form.reset(); toast("Mission recorded", "ok");
}

// ---------------------------------------------------------------- end of game
async function endGame(forceWinner) {
  const g = S.game, s = S.secret, al = alive(g);
  const T = al.filter((p) => s.roles?.[p] === "Traitor");
  const winner = forceWinner || (T.length ? "Traitors" : "Faithful");
  const winners = winner === "Traitors" ? T : al.filter((p) => s.roles?.[p] !== "Traitor");
  const share = winners.length ? Math.floor((g.pot || 0) / winners.length) : 0;
  if (!await confirmBox("End the game?", `All roles will be revealed. Result: <b>${winner === "Traitors" ? "🗡 TRAITORS WIN" : "🛡 FAITHFUL WIN"}</b>.<br>Winners: ${winners.map((p) => esc(pname(g, p))).join(", ") || "—"}`, "🏁 End game")) return;
  const finalRoles = {}; g.order.forEach((p) => (finalRoles[p] = s.roles?.[p] || "Faithful"));
  const patch = {
    phase: "finished", winner, winners, share, finalRoles, finishedAt: Date.now(), timer: null, vote: null,
    announce: ann("win", { winner, text: winner === "Traitors" ? "🗡 The Traitors have won!" : "🛡 The Faithful have won!" }),
    log: arrayUnion(L(`🏆 ${winner === "Traitors" ? "The TRAITORS" : "The FAITHFUL"} won. ${winners.map((p) => pname(g, p)).join(", ")} share ${money(g.pot, g.currency)}.`)),
  };
  g.order.forEach((p) => (patch[`players.${p}.revealedRole`] = finalRoles[p]));
  await upd(patch);
}

async function resetGame() {
  if (!await confirmBox("Play again?", "Same players and PINs. Roles, pot, statuses and votes are reset; a new game begins in the Lobby.", "🔁 Reset")) return;
  const g = S.game, b = writeBatch(db);
  const gp = { phase: "lobby", day: 0, pot: 0, vote: null, reveal: null, banish: null, winner: null, winners: null, share: null, finalRoles: null, finishedAt: null, timer: null, missions: [], breakfastDone: false,
    announce: ann("text", { text: "🔁 A new game is about to begin…" }), log: [{ t: Date.now(), day: 0, text: "🔁 A new game begins with the same players." }] };
  g.order.forEach((p) => {
    gp[`players.${p}.status`] = "alive"; gp[`players.${p}.revealedRole`] = null; gp[`players.${p}.shieldPublic`] = false; gp[`players.${p}.eliminatedDay`] = null;
    if (keyOf(p)) b.update(R.priv(S.code, keyOf(p)), { role: null, traitorKey: deleteField(), fellows: [], shield: false, dagger: false, offer: null, offerResponse: null, notice: null, seenRole: false });
  });
  b.update(R.secret(S.code), { roles: {}, traitorKey: null, shields: {}, daggers: {}, pendingMurder: null, revealQueue: [], revealResult: null, gmLog: [] });
  b.update(R.game(S.code), gp);
  await b.commit();
}
