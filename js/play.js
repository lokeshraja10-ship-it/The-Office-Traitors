// =====================================================================
//  THE TRAITORS — Player app (mobile)
// =====================================================================
import {
  R, ensureAuth, errMsg, toast, modal, confirmBox, h, esc, $, $$, playerKey,
  avatarHTML, money, roleBadge, statusBadge, PHASES, alive, pname, timerRemaining, fmtTime,
  getDoc, setDoc, updateDoc, onSnapshot, query, orderBy, configBanner, sfx, enableSound
} from "./core.js";

const S = {
  uid: null, code: null, pid: null, pin: null, key: null,
  game: null, priv: null, chamberKey: null, chamber: null, msgs: [], noms: [],
  unsubs: [], chUnsubs: [], tab: "home", lastAnn: null, shownOffer: null, shownNotice: null,
  turretBuilt: false, pendingVote: null, useDagger: false,
};
const app = $("#app");
const STORE = "traitors.player";

// ---------------------------------------------------------------- boot
(async function boot() {
  try { const u = await ensureAuth(); S.uid = u.uid; }
  catch (e) { app.innerHTML = `${configBanner()}<div class="card center-card"><h2>⚠️ Can't connect</h2><p>${esc(errMsg(e))}</p></div>`; return; }
  const qs = new URLSearchParams(location.search);
  const g = (qs.get("g") || "").toUpperCase().trim(), p = qs.get("p"), k = qs.get("k");
  if (g && p && k) {
    history.replaceState(null, "", `play.html?g=${g}`); // remove PIN from address bar
    return login(g, p, k, true);
  }
  let saved = null; try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { }
  if (saved && (!g || g === saved.code)) return login(saved.code, saved.pid, saved.pin, false);
  showLogin(g);
})();

// ---------------------------------------------------------------- login
function showLogin(prefill = "", err = "") {
  app.innerHTML = `
  <div class="p-wrap"><div class="p-body">
    <div class="center" style="margin:30px 0 10px"><div style="font-size:3rem">🗡️</div><h1 class="gold" style="font-size:2rem">THE TRAITORS</h1><p class="muted">Trust no one.</p></div>
    ${err ? `<div class="alert alert-red">${esc(err)}</div>` : ""}
    <div class="card">
      <form id="codeForm" class="form">
        <label>Game code<input name="code" value="${esc(prefill)}" maxlength="5" placeholder="e.g. K7QXM" required autocomplete="off" style="text-transform:uppercase;font-size:1.3rem;letter-spacing:.2em;text-align:center"></label>
        <button class="btn btn-primary btn-lg">Enter the castle</button>
      </form>
      <div id="whoBox"></div>
    </div>
  </div></div>`;
  $("#codeForm").onsubmit = async (e) => {
    e.preventDefault();
    const code = new FormData(e.target).get("code").toUpperCase().trim();
    try {
      const snap = await getDoc(R.game(code));
      if (!snap.exists()) return toast("No game with that code.", "error");
      pickName(code, snap.data());
    } catch (err) { toast(errMsg(err), "error"); }
  };
  if (prefill) $("#codeForm").requestSubmit();
}

function pickName(code, g) {
  let chosen = null;
  $("#whoBox").innerHTML = `
    <h3 style="margin-top:18px">Who are you?</h3>
    <div class="name-grid">${g.order.map((p) => `<button type="button" class="name-btn" data-pid="${p}">${avatarHTML(g.players[p].name)}<span>${esc(g.players[p].name)}</span></button>`).join("")}</div>
    <form id="pinForm" class="form hidden">
      <label>Your secret PIN<input name="pin" maxlength="6" required autocomplete="off" style="text-transform:uppercase;font-size:1.3rem;letter-spacing:.3em;text-align:center" placeholder="••••••"></label>
      <button class="btn btn-primary btn-lg">Log in</button>
    </form>`;
  $$(".name-btn").forEach((b) => (b.onclick = () => {
    $$(".name-btn").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); chosen = b.dataset.pid;
    $("#pinForm").classList.remove("hidden"); $("#pinForm input").focus();
  }));
  $("#pinForm").onsubmit = (e) => { e.preventDefault(); if (chosen) login(code, chosen, new FormData(e.target).get("pin"), true); };
}

async function login(code, pid, pin, interactive) {
  app.innerHTML = `<div class="loading">Entering the castle…</div>`;
  try {
    pin = String(pin).toUpperCase().trim();
    const key = await playerKey(code, pid, pin);
    const snap = await getDoc(R.priv(code, key));
    if (!snap.exists() || snap.data().playerId !== pid) {
      localStorage.removeItem(STORE);
      return showLogin(code, interactive ? "That PIN doesn't match. Check your invite and try again." : "Your saved login is no longer valid. Please log in again.");
    }
    await setDoc(R.claim(code, pid), { uid: S.uid, key, at: Date.now() });
    localStorage.setItem(STORE, JSON.stringify({ code, pid, pin }));
    Object.assign(S, { code, pid, pin, key });
    startSession();
  } catch (e) { showLogin(code, errMsg(e)); }
}
function logout() { localStorage.removeItem(STORE); S.unsubs.forEach((u) => u()); S.chUnsubs.forEach((u) => u()); location.href = `play.html?g=${S.code || ""}`; }

// ---------------------------------------------------------------- session
function startSession() {
  app.innerHTML = `
  <div class="p-wrap">
    <header class="p-head" id="phead"></header>
    <div class="p-body" id="view"></div>
  </div>
  <nav class="tabbar"><div class="in" id="tabs"></div></nav>`;
  document.addEventListener("pointerdown", () => enableSound(), { once: true });
  S.unsubs.push(onSnapshot(R.game(S.code), (snap) => {
    if (!snap.exists()) { toast("This game no longer exists.", "error"); return logout(); }
    const g = snap.data();
    if (!g.players?.[S.pid]) { toast("You have been removed from this game.", "error"); return logout(); }
    S.game = g; handleAnnounce(); render();
  }, (e) => toast(errMsg(e), "error")));
  S.unsubs.push(onSnapshot(R.priv(S.code, S.key), (snap) => {
    if (!snap.exists()) { toast("Your login was reset by the Game Master.", "error"); return setTimeout(logout, 1500); }
    S.priv = snap.data(); syncChamber(); handleOffer(); handleNotice(); render();
  }, (e) => toast(errMsg(e), "error")));
  setInterval(() => $$("[data-timer]").forEach((el) => {
    const t = S.game?.timer; const s = timerRemaining(t);
    el.textContent = t ? fmtTime(s) : "--:--"; el.classList.toggle("urgent", !!t && s <= 30);
  }), 250);
}

function syncChamber() {
  const k = S.priv?.traitorKey || null;
  if (k === S.chamberKey) return;
  S.chUnsubs.forEach((u) => u()); S.chUnsubs = []; S.chamberKey = k; S.chamber = null; S.msgs = []; S.noms = []; S.turretBuilt = false;
  if (!k) { if (S.tab === "turret") S.tab = "home"; return; }
  S.chUnsubs.push(onSnapshot(R.chamber(S.code, k), (s) => { S.chamber = s.data() || null; render(); }));
  S.chUnsubs.push(onSnapshot(query(R.msgs(S.code, k), orderBy("ts")), (qs) => {
    const before = S.msgs.length; S.msgs = qs.docs.map((d) => d.data());
    if (before && S.msgs.length > before && S.tab !== "turret") { sfx.chime(); toast("🗼 New message in the Turret"); }
    render();
  }));
  S.chUnsubs.push(onSnapshot(R.noms(S.code, k), (qs) => { S.noms = qs.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }));
}

// ---------------------------------------------------------------- announcements, offers, notices
function handleAnnounce() {
  const a = S.game.announce; if (!a) return;
  if (S.lastAnn === null) { S.lastAnn = a.ts; return; } // don't replay on first load
  if (a.ts <= S.lastAnn) return; S.lastAnn = a.ts;
  let text = a.text || "";
  if (a.kind === "role") text = `🎭 ${a.name} was ${a.role === "Traitor" ? "a TRAITOR 🗡" : "FAITHFUL 🛡"}`;
  if (a.kind === "murder" && a.pid === S.pid) text = "🔪 You were murdered in the night. Your game is over — but you can keep watching.";
  if (a.kind === "banish" && a.pid === S.pid) text = "⚖️ You have been banished. Say your final words… then reveal who you are.";
  if (!text) return;
  ({ murder: sfx.sting, role: sfx.reveal, night: sfx.gong, win: sfx.heroic }[a.kind] || sfx.chime)();
  navigator.vibrate?.(200);
  $(".announce-bar")?.remove();
  const bar = h(`<div class="announce-bar"></div>`); bar.textContent = text; bar.onclick = () => bar.remove();
  document.body.append(bar); setTimeout(() => bar.remove(), 8000);
}

async function handleOffer() {
  const o = S.priv?.offer;
  if (!o || o.handled || S.priv.offerResponse || S.shownOffer === o.ts) return;
  S.shownOffer = o.ts; navigator.vibrate?.([200, 100, 200]); sfx.sting();
  const ult = o.type === "ultimatum";
  const choice = await new Promise((res) => {
    const wrap = h(`<div class="modal-backdrop offer-modal"><div class="modal">
      <div style="font-size:3rem">${ult ? "⚠️" : "🗡"}</div>
      <h3>${ult ? "An ultimatum" : "A secret invitation"}</h3>
      <p>${ult ? "The Traitors have chosen you. <b>Join them — or you will be murdered tonight.</b>" : "The Traitors invite you to <b>join them</b>. Become a Traitor and play to steal the prize pot."}</p>
      <p class="tiny">Your choice is secret. Hide your screen!</p>
      <div class="modal-actions" style="justify-content:center"><button class="btn btn-ghost" data-v="decline">${ult ? "Refuse (and die)" : "Refuse — I stay Faithful"}</button><button class="btn btn-danger" data-v="accept">Accept — I'm a Traitor</button></div>
    </div></div>`);
    wrap.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => { wrap.remove(); res(b.dataset.v); }));
    document.body.append(wrap);
  });
  if (!await confirmBox("Are you sure?", choice === "accept" ? "You will become a <b>Traitor</b>." : (ult ? "You will be <b>murdered</b> tonight." : "You will stay <b>Faithful</b>."), "Yes, final answer", choice === "accept" || ult)) { S.shownOffer = null; return handleOffer(); }
  try { await updateDoc(R.priv(S.code, S.key), { offerResponse: choice }); toast("Your answer has been delivered.", "ok"); }
  catch (e) { toast(errMsg(e), "error"); S.shownOffer = null; }
}

async function handleNotice() {
  const n = S.priv?.notice;
  if (!n || S.priv.noticeSeen || S.shownNotice === n) return;
  S.shownNotice = n; navigator.vibrate?.(300);
  await modal({ title: "🎭 A message from the Game Master", body: `<p>${esc(n)}</p><p class="tiny">Keep your screen hidden.</p>`, dismissable: false, actions: [{ label: "Understood", value: true, cls: "btn-primary" }] });
  try { await updateDoc(R.priv(S.code, S.key), { noticeSeen: true }); } catch { }
  if (S.priv?.role === "Traitor") { S.tab = "turret"; render(); }
}

// ---------------------------------------------------------------- render
const me = () => S.game?.players?.[S.pid] || {};
const isTraitor = () => S.priv?.role === "Traitor" && !!S.priv?.traitorKey;
const amAlive = () => me().status === "alive";

function render() {
  if (!S.game || !S.priv || !$("#phead")) return;
  renderHead(); renderTabs();
  const v = $("#view");
  if (S.tab === "turret" && isTraitor()) { v.dataset.sig = ""; return renderTurret(v); }
  if (S.tab === "turret") S.tab = "home";
  S.turretBuilt = false;
  const html = S.tab === "role" ? roleView() : S.tab === "players" ? playersView() : homeView();
  const sig = S.tab + "|" + html;
  if (v.dataset.sig === sig) return; // nothing changed → keep DOM (preserves press-and-hold, scroll, checkboxes)
  v.dataset.sig = sig; v.innerHTML = html;
  if (S.tab === "role") bindRole(v);
  else if (S.tab === "home") bindHome(v);
}

function renderHead() {
  const g = S.game, m = me();
  $("#phead").innerHTML = `${avatarHTML(m.name)}
    <div class="who"><b>${esc(m.name)}</b><span class="tiny">${esc(g.name)} · ${PHASES[g.phase]?.icon || ""} ${PHASES[g.phase]?.title || ""}${g.day ? ` · Day ${g.day}` : ""}</span></div>
    <div class="pot">Prize pot<b>${money(g.pot, g.currency)}</b></div>`;
}
function renderTabs() {
  const tabs = [["home", "🏰", "Castle"], ["role", "🎭", "My role"], ["players", "👥", "Players"]];
  if (isTraitor()) tabs.push(["turret", "🗼", "Turret"]);
  $("#tabs").innerHTML = tabs.map(([k, i, l]) => `<button class="${S.tab === k ? "active" : ""} ${k === "turret" ? "traitor" : ""}" data-tab="${k}"><span>${i}</span>${l}</button>`).join("");
  $$("#tabs button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
}

// ---------------------------------------------------------------- HOME
function banner(icon, title, text = "") {
  return `<div class="phase-banner"><div class="ico">${icon}</div><h2>${title}</h2>${text ? `<p class="muted">${text}</p>` : ""}</div>`;
}
function homeView() {
  const g = S.game, m = me(), p = g.phase, P = PHASES[p] || {};
  let html = "";
  if (m.status !== "alive" && p !== "finished" && p !== "lobby") {
    html += `<div class="alert ${m.status === "murdered" ? "alert-red" : ""}">${m.status === "murdered" ? "🔪 You were murdered" : "⚖️ You were banished"} on Day ${m.eliminatedDay ?? "?"}. You can no longer vote, but you can keep watching the drama unfold.</div>`;
  }
  switch (p) {
    case "lobby":
      html += banner("🏰", `Welcome, ${esc(m.name)}`, "You're in! Wait for the Game Master to assign the roles.");
      html += `<div class="card"><h3>Players in the castle</h3>${g.order.map((x) => `<div class="p-item">${avatarHTML(pname(g, x))}<span class="nm">${esc(pname(g, x))}</span>${g.players[x].joined ? "✅" : "<span class='tiny'>not yet</span>"}</div>`).join("")}</div>`;
      break;
    case "roles":
      html += banner("🎭", "Your role has been assigned", "Go somewhere private, then open <b>My role</b>.");
      html += `<button class="btn btn-primary btn-lg btn-block" data-go="role">🎭 Reveal my role</button>`;
      break;
    case "breakfast":
      html += banner("☕", `Breakfast — Day ${g.day}`, g.breakfastDone ? "" : "Who didn't make it through the night? Wait for the reveal…");
      if (g.breakfastDone && g.announce?.text) html += `<div class="card center"><p style="font-size:1.2rem">${esc(g.announce.kind === "murder" || g.announce.kind === "nomurder" ? g.announce.text : "The night's outcome has been revealed.")}</p></div>`;
      break;
    case "mission": {
      html += banner("⚔️", `Mission — Day ${g.day}`, "Work together and earn money for the prize pot.");
      const ms = (g.missions || []).filter((x) => x.day === g.day);
      if (ms.length) html += `<div class="card">${ms.map((x) => `<p>⚔️ <b>${esc(x.title)}</b> — +${money(x.amount, g.currency)}</p>`).join("")}</div>`;
      html += inventory();
      break;
    }
    case "roundtable":
      html += banner("🪑", "The Round Table", "Accuse. Defend. Decide who to banish.");
      if (g.timer) html += `<div class="card center"><div class="big-timer" data-timer>--:--</div></div>`;
      html += inventory();
      break;
    case "voting": html += votingView(); break;
    case "reveal": html += revealView(); break;
    case "banishment": {
      const b = g.banish || {};
      if (!b.pid) { html += banner("⚖️", "No banishment", "The Round Table could not decide."); break; }
      const nm = esc(pname(g, b.pid));
      html += `<div class="phase-banner">${avatarHTML(pname(g, b.pid), "xl")}<h2>${b.pid === S.pid ? "You have" : nm + " has"} been banished</h2>
        ${b.roleRevealed ? `<p style="font-size:1.4rem">${b.pid === S.pid ? "You were" : nm + " was"} ${g.players[b.pid]?.revealedRole === "Traitor" ? `<b class="red">a TRAITOR 🗡</b>` : `<b style="color:#9cc2ff">FAITHFUL 🛡</b>`}</p>` : `<p class="muted">Final words… then the truth.</p>`}</div>`;
      break;
    }
    case "night":
      if (isTraitor() && amAlive()) {
        html += banner("🌙", "Night falls", "The Faithful sleep. Your work begins.");
        html += `<button class="btn btn-danger btn-lg btn-block" data-go="turret">🗼 Enter the Turret</button>`;
      } else html += banner("🌙", "Night falls", amAlive() ? "Sleep tight… and hope you wake up tomorrow." : "The castle sleeps.");
      break;
    case "endgame":
      html += banner("🔥", "The Endgame", "Only a few remain. If any Traitor survives to the end, they take the whole pot.");
      if (g.timer) html += `<div class="card center"><div class="big-timer" data-timer>--:--</div></div>`;
      break;
    case "finished": html += finishedView(); break;
    default: html += banner(P.icon || "🏰", P.title || p);
  }
  if (p !== "finished") html += recentLog();
  return html;
}

function inventory() {
  const pv = S.priv || {}; const items = [];
  if (pv.shield) items.push(`<span class="item">🛡 You hold a Shield — you cannot be murdered tonight</span>`);
  if (pv.dagger) items.push(`<span class="item">🗡 You hold the Dagger — use it once to double your vote</span>`);
  return items.length ? `<div class="inv">${items.join("")}</div>` : "";
}

function votingView() {
  const g = S.game, v = g.vote || {};
  const can = v.open && v.voters?.includes(S.pid);
  const stored = localStorage.getItem(`traitors.vote.${v.id}`);
  let html = banner(v.kind === "endgame" ? "🔥" : "🗳", v.kind === "endgame" ? "End the game — or banish again?" : "Cast your vote", v.label ? esc(v.label) : (can ? "Your vote is secret until the reveal. You can change it until voting closes." : ""));
  html += `<div class="progress"><div style="width:${v.voters?.length ? ((v.submitted || []).length / v.voters.length) * 100 : 0}%"></div></div><p class="tiny center">${(v.submitted || []).length}/${v.voters?.length || 0} votes cast</p>`;
  if (!v.open) return html + `<p class="center muted">Voting is closed.</p>`;
  if (!can) return html + `<div class="alert">${amAlive() ? "You are not voting in this round." : "Only living players can vote."}</div>`;
  const sel = S.pendingVote?.id === v.id ? S.pendingVote.target : stored;
  if (stored) html += `<div class="alert alert-gold">✅ You voted for <b>${esc(pname(g, stored))}</b>. Tap another option to change it.</div>`;
  if (v.kind === "endgame") {
    html += `<div class="endvote">
      <button class="cand ${sel === "END" ? "sel" : ""}" data-vote="END">🏁<br>END<br><span class="tiny">I trust everyone left</span></button>
      <button class="cand ${sel === "BANISH" ? "sel" : ""}" data-vote="BANISH">⚖️<br>BANISH<br><span class="tiny">A Traitor remains</span></button></div>`;
  } else {
    html += `<div class="cand-grid">${v.candidates.filter((p) => p !== S.pid).map((p) => `<button class="cand ${sel === p ? "sel" : ""}" data-vote="${p}">${avatarHTML(pname(g, p), "lg")}${esc(pname(g, p))}</button>`).join("")}</div>`;
    if (S.priv?.dagger && g.settings?.daggerEnabled !== false) html += `<label class="check" style="margin-top:14px"><input type="checkbox" id="useDagger" ${S.useDagger ? "checked" : ""}> 🗡 Use my Dagger — this vote counts double (one-time)</label>`;
  }
  return html;
}

function revealView() {
  const g = S.game, r = g.reveal || {}, items = r.items || [];
  const t = {}; items.forEach((i) => { if (i.target) t[i.target] = (t[i.target] || 0) + (i.weight || 1); });
  const max = Math.max(1, ...Object.values(t));
  let html = banner("📜", "The Reveal", r.kind === "endgame" ? "END or BANISH?" : "One by one, the votes are revealed…");
  html += `<div class="reveal-list">${items.map((i) => `<div class="reveal-item">${avatarHTML(pname(g, i.voter))}<b>${esc(pname(g, i.voter))}</b><span class="arrow">➜</span>${i.target ? `<b>${esc(pname(g, i.target))}</b>${i.weight === 2 ? " 🗡×2" : ""}` : `<span class="muted">${esc(i.note || "No vote")}</span>`}</div>`).join("")}</div>`;
  html += `<div class="tally">${Object.entries(t).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<div class="tally-row" style="grid-template-columns:110px 1fr 30px"><span>${esc(pname(g, p))}</span><div class="tally-bar"><div style="width:${(n / max) * 100}%"></div></div><b>${n}</b></div>`).join("")}</div>`;
  if (r.done && r.result?.type === "tie" && r.kind !== "endgame") html += `<div class="alert alert-gold">⚖️ It's a tie! The Game Master will decide what happens next.</div>`;
  return html;
}

function finishedView() {
  const g = S.game, fr = g.finalRoles || {};
  const won = (g.winners || []).includes(S.pid);
  return `<div class="phase-banner"><div class="ico">${g.winner === "Traitors" ? "🗡" : "🛡"}</div>
      <h2>${g.winner === "Traitors" ? "The TRAITORS win!" : "The FAITHFUL win!"}</h2>
      ${won ? `<p class="gold" style="font-size:1.2rem">🎉 You won ${money(g.share, g.currency)}!</p>` : `<p class="muted">Prize pot ${money(g.pot, g.currency)} shared by ${(g.winners || []).map((p) => esc(pname(g, p))).join(", ") || "nobody"}.</p>`}</div>
    <div class="p-list">${g.order.map((p) => `<div class="p-item">${avatarHTML(pname(g, p))}<span class="nm"><b>${esc(pname(g, p))}</b>${p === S.pid ? " (you)" : ""}</span>${roleBadge(fr[p])}</div>`).join("")}</div>`;
}

function recentLog() {
  const log = [...(S.game.log || [])].slice(-6).reverse();
  return log.length ? `<div class="card" style="margin-top:16px"><h3>📜 Castle chronicle</h3><ul class="log">${log.map((x) => `<li><span class="d">D${x.day}</span>${esc(x.text)}</li>`).join("")}</ul></div>` : "";
}

function bindHome(v) {
  $$("[data-go]", v).forEach((b) => (b.onclick = () => { S.tab = b.dataset.go; render(); }));
  $$("[data-vote]", v).forEach((b) => (b.onclick = () => castVote(b.dataset.vote)));
  const dg = $("#useDagger", v); if (dg) dg.onchange = () => (S.useDagger = dg.checked);
}

async function castVote(target) {
  const g = S.game, v = g.vote; if (!v?.open) return;
  const label = v.kind === "endgame" ? (target === "END" ? "END the game" : "BANISH again") : pname(g, target);
  const dagger = !!S.useDagger && !!S.priv?.dagger && v.kind !== "endgame";
  if (!await confirmBox("Confirm your vote", `You are voting for <b>${esc(label)}</b>${dagger ? " using your 🗡 <b>Dagger</b> (counts double)" : ""}.`, "Cast vote")) return;
  S.pendingVote = { id: v.id, target };
  try {
    await setDoc(R.vote(S.code, v.id, S.pid), { voteId: v.id, voter: S.pid, target, dagger, ts: Date.now() });
    localStorage.setItem(`traitors.vote.${v.id}`, target);
    toast("Your vote has been cast 🤫", "ok"); navigator.vibrate?.(80);
  } catch (e) { toast(errMsg(e), "error"); }
  S.pendingVote = null; render();
}

// ---------------------------------------------------------------- ROLE
function roleView() {
  const pv = S.priv || {};
  if (!pv.role) return banner("🎭", "No role yet", "The Game Master hasn't assigned roles yet.");
  const t = pv.role === "Traitor";
  const fellows = (pv.fellows || []).filter((f) => f.pid !== S.pid);
  return `
    <p class="center muted small">Make sure nobody can see your screen.</p>
    <div class="role-card" id="roleCard">
      <div class="cover" id="roleCover">🔒<br><br>PRESS & HOLD<br>to reveal your role</div>
      <div id="roleFace" class="hidden" style="display:flex;flex-direction:column;align-items:center;gap:8px">
        <div class="sym">${t ? "🗡" : "🛡"}</div>
        <div class="tiny" style="letter-spacing:.3em">YOU ARE</div>
        <div class="big" style="color:${t ? "#ff8b96" : "#cfe0ff"}">${t ? "TRAITOR" : "FAITHFUL"}</div>
        <p style="max-width:300px">${t ? "Murder the Faithful by night. Blend in by day. Survive to the end to steal the entire pot." : "Find and banish every Traitor. If only Faithfuls remain at the end, you share the pot."}</p>
        ${t && fellows.length ? `<p class="small"><b>Your fellow Traitors:</b><br>${fellows.map((f) => esc(f.name)).join(", ")}</p>` : ""}
        ${t && !fellows.length ? `<p class="small">You are the only Traitor… for now.</p>` : ""}
      </div>
    </div>
    ${inventory()}
    <div class="btn-row" style="justify-content:center;margin-top:24px"><button class="btn btn-ghost btn-sm" id="logoutBtn">Log out of this device</button></div>`;
}
function bindRole(v) {
  const card = $("#roleCard", v); $("#logoutBtn", v)?.addEventListener("click", async () => { if (await confirmBox("Log out?", "You'll need your PIN to log in again.", "Log out")) logout(); });
  if (!card) return;
  const show = (on) => {
    $("#roleCover", v).classList.toggle("hidden", on); $("#roleFace", v).classList.toggle("hidden", !on);
    card.classList.toggle(S.priv.role === "Traitor" ? "traitor" : "faithful", on);
    if (on && !S.priv.seenRole) updateDoc(R.priv(S.code, S.key), { seenRole: true }).catch(() => { });
    if (on) navigator.vibrate?.(40);
  };
  card.addEventListener("pointerdown", (e) => { e.preventDefault(); show(true); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => card.addEventListener(ev, () => show(false)));
  card.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---------------------------------------------------------------- PLAYERS
function playersView() {
  const g = S.game, al = alive(g), out = g.order.filter((p) => g.players[p].status !== "alive");
  const item = (p) => {
    const pl = g.players[p];
    return `<div class="p-item ${pl.status !== "alive" ? "out" : ""}">${avatarHTML(pl.name)}<div class="nm"><b>${esc(pl.name)}</b>${p === S.pid ? " (you)" : ""}<div>${statusBadge(pl)}</div></div>
      ${pl.shieldPublic ? "🛡" : ""}${pl.revealedRole ? roleBadge(pl.revealedRole) : ""}</div>`;
  };
  return `<h3>Still in the castle (${al.length})</h3><div class="p-list">${al.map(item).join("")}</div>
    ${out.length ? `<h3 style="margin-top:18px">Gone (${out.length})</h3><div class="p-list">${out.map(item).join("")}</div>` : ""}
    <div class="card" style="margin-top:16px"><h3>📜 Full chronicle</h3><ul class="log">${[...(g.log || [])].reverse().map((x) => `<li><span class="d">D${x.day}</span>${esc(x.text)}</li>`).join("")}</ul></div>`;
}

// ---------------------------------------------------------------- TURRET (Traitors only)
function renderTurret(v) {
  const g = S.game, ch = S.chamber || {};
  if (!S.turretBuilt) {
    S.turretBuilt = true;
    v.innerHTML = `
      <div class="phase-banner" style="background:linear-gradient(180deg,#4a0d14,#14060a);border-color:var(--red2)"><div class="ico">🗼</div><h2 class="red">The Turret</h2><p class="muted">Only Traitors can see this.</p></div>
      <div data-t="status"></div>
      <div data-t="nominate"></div>
      <div class="card" style="margin-top:12px"><h3>💬 Traitors' whispers</h3><div class="chat" data-t="chat"></div>
        <form class="chat-form" id="tChat"><input id="tChatText" maxlength="300" placeholder="Whisper to your fellow Traitors…" autocomplete="off"><button class="btn btn-danger">Send</button></form></div>`;
    $("#tChat", v).onsubmit = async (e) => {
      e.preventDefault(); const t = $("#tChatText").value.trim(); if (!t) return;
      if (!amAlive()) return toast("Eliminated Traitors can only watch.", "error");
      try { await setDoc(R.newMsg(S.code, S.chamberKey), { from: S.pid, name: me().name, text: t, ts: Date.now() }); $("#tChatText").value = ""; }
      catch (err) { toast(errMsg(err), "error"); }
    };
  }
  const fellows = (S.priv.fellows || []);
  $('[data-t="status"]', v).innerHTML = `<div class="card"><p class="small">Traitors: ${fellows.map((f) => `<b class="${g.players[f.pid]?.status === "alive" ? "red" : "dim"}">${esc(f.name)}${f.pid === S.pid ? " (you)" : ""}</b>`).join(", ")}</p>
    ${ch.status ? `<div class="alert alert-red">${esc(ch.status)}</div>` : ""}</div>`;
  // nominations
  let nom = "";
  if (g.phase === "night" && ch.nightId && amAlive()) {
    const mode = ch.mode || "murder";
    const noms = S.noms.filter((n) => n.nightId === ch.nightId);
    const mine = noms.find((n) => n.id === S.pid)?.target;
    const traitorIds = new Set(fellows.map((f) => f.pid));
    const targets = alive(g).filter((p) => !traitorIds.has(p));
    nom = `<div class="card" style="margin-top:12px"><h3>${mode === "murder" ? "🔪 Who will not wake up?" : mode === "ultimatum" ? "⚠️ Who receives the ultimatum?" : "🤝 Who should we recruit?"}</h3>
      <p class="tiny">Nominate a target. The Game Master confirms the final choice — agree among yourselves!</p>
      <div class="cand-grid">${targets.map((p) => {
        const c = noms.filter((n) => n.target === p).length;
        return `<button class="cand ${mine === p ? "sel" : ""}" data-nom="${p}">${avatarHTML(pname(g, p), "lg")}${esc(pname(g, p))}${c ? `<span class="badge badge-traitor">${c} nomination${c > 1 ? "s" : ""}</span>` : ""}</button>`;
      }).join("")}</div>
      ${noms.length ? `<ul class="log" style="margin-top:10px">${noms.map((n) => `<li>🗡 ${esc(pname(g, n.id))} ➜ <b>${esc(pname(g, n.target))}</b></li>`).join("")}</ul>` : ""}</div>`;
  } else if (g.phase !== "night") {
    nom = `<p class="muted small center" style="margin-top:12px">Nominations open when night falls. Use the whispers to plan.</p>`;
  }
  $('[data-t="nominate"]', v).innerHTML = nom;
  $$("[data-nom]", v).forEach((b) => (b.onclick = async () => {
    try { await setDoc(R.nom(S.code, S.chamberKey, S.pid), { target: b.dataset.nom, nightId: ch.nightId, mode: ch.mode || "murder", ts: Date.now() }); navigator.vibrate?.(50); }
    catch (e) { toast(errMsg(e), "error"); }
  }));
  const chat = $('[data-t="chat"]', v);
  const atBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 30;
  chat.innerHTML = S.msgs.map((m) => `<div class="msg ${m.system ? "sys" : ""}"><b>${esc(m.from === S.pid ? "You" : m.name)}:</b> ${esc(m.text)}</div>`).join("") || `<p class="muted small">No whispers yet.</p>`;
  if (atBottom || !chat.dataset.init) { chat.scrollTop = chat.scrollHeight; chat.dataset.init = "1"; }
  $("#tChatText") && ($("#tChatText").disabled = !amAlive());
}
