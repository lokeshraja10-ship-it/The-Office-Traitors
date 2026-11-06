// =====================================================================
//  THE TRAITORS — Big screen / projector display (read-only)
// =====================================================================
import {
  R, configOk, errMsg, h, esc, $, avatarHTML, money, roleBadge, PHASES, alive, pname,
  timerRemaining, fmtTime, pageUrl, qrUrl, onSnapshot, sfx, enableSound, configBanner, broadcastHTML
} from "./core.js";

const S = { code: null, game: null, lastAnn: null, lastBcast: undefined, overlayTimer: null, lastTimerSec: null, lastRevealCount: 0 };
const app = $("#app");

(function boot() {
  if (!configOk()) { app.innerHTML = configBanner(); return; }
  const code = (new URLSearchParams(location.search).get("g") || "").toUpperCase().trim();
  if (!code) return askCode();
  S.code = code;
  document.body.classList.add("display");
  app.innerHTML = `<div class="loading">Raising the curtain…</div>`;
  onSnapshot(R.game(code), (snap) => {
    if (!snap.exists()) { app.innerHTML = `<div class="card center-card"><h2>Game ${esc(code)} not found</h2><a class="btn" href="display.html">Try another code</a></div>`; return; }
    const prev = S.game; S.game = snap.data(); render(prev); handleAnnounce();
  }, (e) => { app.innerHTML = `<div class="card center-card"><h2>⚠️</h2><p>${esc(errMsg(e))}</p></div>`; });
  const sb = h(`<button class="btn btn-sm sound-btn">🔇 Click to enable sound</button>`);
  sb.onclick = () => { if (enableSound()) { sfx.chime(); sb.textContent = "🔊 Sound on"; setTimeout(() => sb.remove(), 1500); } };
  document.body.append(sb);
  const fs = h(`<button class="btn btn-sm" style="position:fixed;left:14px;bottom:14px;z-index:600;opacity:.6">⛶ Fullscreen</button>`);
  fs.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
  document.body.append(fs);
  setInterval(tickTimer, 250);
})();

function askCode() {
  app.innerHTML = `<div class="card center-card"><h2>📺 Big screen</h2><form id="f" class="form"><input name="code" placeholder="Game code" maxlength="5" required style="text-transform:uppercase;text-align:center;font-size:1.4rem;letter-spacing:.2em"><button class="btn btn-primary btn-lg">Show</button></form></div>`;
  $("#f").onsubmit = (e) => { e.preventDefault(); location.href = "display.html?g=" + new FormData(e.target).get("code").toUpperCase().trim(); };
}

// ---------------------------------------------------------------- layout
function render(prev) {
  const g = S.game;
  if (!$(".d-wrap")) app.innerHTML = `<div class="d-wrap"><header class="d-head" id="dhead"></header><div class="d-bcast" id="dbcast"></div><section class="d-stage" id="stage"></section><footer class="d-players" id="dplayers"></footer></div>`;
  $(".d-wrap").classList.toggle("d-night", g.phase === "night");
  $("#dhead").innerHTML = `
    <div><div class="gname">🗡 ${esc(g.name)}</div><div class="muted">Game code <span class="code">${g.code}</span></div></div>
    <div class="phase center">${PHASES[g.phase]?.icon || ""} ${PHASES[g.phase]?.title || ""}${g.day ? `<div class="muted small">Day ${g.day}</div>` : ""}</div>
    <div class="d-pot"><span>Prize pot</span><b>${money(g.pot, g.currency)}</b></div>`;
  const bc = g.broadcast?.text ? g.broadcast : null;
  $("#dbcast").innerHTML = broadcastHTML(bc);
  if (S.lastBcast !== undefined && bc && bc.ts !== S.lastBcast) sfx.chime();
  S.lastBcast = bc ? bc.ts : null;
  $("#stage").innerHTML = stage(g);
  $("#dplayers").innerHTML = tiles(g);
  const rc = g.reveal?.items?.length || 0;
  if (prev && g.phase === "reveal" && rc > S.lastRevealCount) sfx.reveal();
  S.lastRevealCount = rc;
  tickTimer();
}

function tiles(g) {
  const voted = new Set(g.vote?.open ? g.vote.submitted || [] : []);
  return g.order.map((p) => {
    const pl = g.players[p];
    const cls = [pl.status, voted.has(p) ? "voted" : "", g.phase === "lobby" ? (pl.joined ? "joined" : "waiting") : ""].join(" ");
    const mark = pl.status === "murdered" ? "🔪" : pl.status === "banished" ? "⚖️" : pl.shieldPublic ? "🛡" : "";
    return `<div class="d-tile ${cls}">${mark ? `<span class="mark">${mark}</span>` : ""}${avatarHTML(pl.name)}<span class="nm">${esc(pl.name)}</span>${pl.revealedRole && pl.status !== "alive" ? roleBadge(pl.revealedRole) : ""}</div>`;
  }).join("");
}

function stage(g) {
  const v = g.vote, r = g.reveal;
  switch (g.phase) {
    case "lobby": {
      const url = pageUrl("play.html", { g: g.code });
      const joined = g.order.filter((p) => g.players[p].joined).length;
      return `<h1 class="gold">THE TRAITORS</h1><p class="lead">Scan to join with your phone, then enter your secret PIN.</p>
        <div class="d-join"><img class="d-qr" src="${qrUrl(url, 240)}" alt="QR code"><div style="text-align:left"><div class="muted">Or open</div><div class="url">${esc(url)}</div>
        <p style="font-size:1.6rem;margin-top:20px"><b class="gold">${joined}</b> / ${g.order.length} players logged in</p></div></div>`;
    }
    case "roles":
      return `<div style="font-size:6rem">🎭</div><h1>The roles have been chosen</h1><p class="lead">Look at your phone — <b>privately</b>. Among you walk the <span class="red">Traitors</span>…<br>Everyone else is <span style="color:#9cc2ff">Faithful</span>.</p>`;
    case "breakfast": {
      if (!g.breakfastDone) return `<div style="font-size:6rem">☕</div><h1>Breakfast</h1><p class="lead">Good morning. One by one, the players arrive… but who is missing?</p>`;
      const a = g.announce || {};
      if (a.kind === "murder") return `${avatarHTML(a.name || "", "xl")}<h1 class="red">${esc(a.name)}</h1><p class="lead" style="font-size:2rem">was murdered in the night.</p>`;
      return `<div style="font-size:6rem">🌅</div><h1>Everyone survived the night</h1><p class="lead">…this time.</p>`;
    }
    case "mission": {
      const ms = (g.missions || []).filter((m) => m.day === g.day);
      return `<div style="font-size:6rem">⚔️</div><h1>Mission</h1><p class="lead">Earn money for the prize pot.</p>
        ${ms.map((m) => `<p style="font-size:1.8rem">⚔️ ${esc(m.title)} — <b class="gold">+${money(m.amount, g.currency)}</b></p>`).join("")}`;
    }
    case "roundtable":
      return `<h1>The Round Table</h1>${g.timer ? `<div class="d-timer" data-timer></div>` : `<div style="font-size:7rem">🪑</div>`}<p class="lead">Accuse. Defend. Decide who to banish.</p>`;
    case "voting": {
      const n = (v?.submitted || []).length, t = v?.voters?.length || 0;
      return `<div style="font-size:5rem">${v?.kind === "endgame" ? "🔥" : "🗳"}</div>
        <h1>${v?.kind === "endgame" ? "END the game — or BANISH again?" : "Cast your votes"}</h1>
        ${v?.label ? `<p class="lead gold">${esc(v.label)}</p>` : ""}
        <p class="lead">Vote secretly on your phone.</p>
        <div class="d-timer" style="font-size:8rem">${n}<span class="muted" style="font-size:4rem"> / ${t}</span></div>`;
    }
    case "reveal": {
      const items = r?.items || [];
      const t = {}; items.forEach((i) => { if (i.target) t[i.target] = (t[i.target] || 0) + (i.weight || 1); });
      const max = Math.max(1, ...Object.values(t));
      const latest = items[items.length - 1];
      let res = "";
      if (r?.done) {
        if (r.kind === "endgame") res = r.result?.unanimousEnd ? `<h1 class="gold">The players have chosen to END the game</h1>` : `<h1>Not unanimous — the hunt continues</h1>`;
        else if (r.result?.type === "tie") res = `<h1 class="gold">⚖️ It's a tie!</h1>`;
      }
      return `<h1 style="font-size:3rem">📜 The Reveal</h1>
        <div class="d-votes">
          <div>${latest ? card(g, latest, true) : `<p class="lead">The votes will now be revealed…</p>`}
            ${items.slice(0, -1).reverse().slice(0, 5).map((i) => card(g, i, false)).join("")}</div>
          <div class="tally">${Object.entries(t).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<div class="tally-row"><span>${esc(pname(g, p))}</span><div class="tally-bar"><div style="width:${(n / max) * 100}%"></div></div><b>${n}</b></div>`).join("")}
            <p class="muted">${items.length} / ${r?.total || 0} revealed</p></div>
        </div>${res}`;
    }
    case "banishment": {
      const b = g.banish || {};
      if (!b.pid) return `<h1>No one was banished</h1><p class="lead">The Round Table could not decide…</p>`;
      const nm = pname(g, b.pid), role = g.players[b.pid]?.revealedRole;
      return `${avatarHTML(nm, "xl")}<h1>${esc(nm)}</h1>
        ${b.roleRevealed ? `<p class="lead" style="font-size:2rem">was…</p><div class="d-big-role ${role === "Traitor" ? "traitor" : "faithful"}">${role === "Traitor" ? "A TRAITOR" : "FAITHFUL"}</div>`
          : `<p class="lead" style="font-size:2rem">has been banished.</p><p class="lead">Final words… and then the truth.</p>`}`;
    }
    case "night":
      return `<div class="d-moon">🌙</div><h1 style="color:#cfd8ff">Night falls</h1><p class="lead">Faithfuls — close your eyes and sleep.<br>Traitors — to the Turret…</p>`;
    case "endgame": {
      const al = alive(g);
      return `<div style="font-size:6rem">🔥</div><h1>The Endgame</h1><p class="lead">${al.length} remain. If a single Traitor survives to the end, they steal the entire pot.</p>
        ${g.timer ? `<div class="d-timer" data-timer></div>` : ""}`;
    }
    case "finished": {
      const fr = g.finalRoles || {};
      return `<div class="winner-banner ${g.winner === "Traitors" ? "red" : ""}" style="${g.winner === "Traitors" ? "" : "color:#9cc2ff"}">${g.winner === "Traitors" ? "🗡 THE TRAITORS WIN" : "🛡 THE FAITHFUL WIN"}</div>
        <p class="lead" style="font-size:1.8rem">${(g.winners || []).map((p) => `<b class="gold">${esc(pname(g, p))}</b>`).join(", ")} ${g.winners?.length === 1 ? `takes the whole pot — ${money(g.share, g.currency)}` : g.winners?.length ? `take ${money(g.share, g.currency)} each` : "Nobody survived to claim the pot"}</p>
        <div class="roles-grid">${g.order.map((p) => `<div class="rg ${fr[p] === "Traitor" ? "traitor" : ""}">${avatarHTML(pname(g, p))}<b>${esc(pname(g, p))}</b>${roleBadge(fr[p])}</div>`).join("")}</div>`;
    }
  }
  return `<h1>${esc(PHASES[g.phase]?.title || g.phase)}</h1>`;
}

function card(g, i, latest) {
  return `<div class="d-votecard ${latest ? "latest" : ""}">${avatarHTML(pname(g, i.voter))}<b>${esc(pname(g, i.voter))}</b><span class="gold">➜</span>
    ${i.target ? `<b>${esc(pname(g, i.target))}</b>${i.weight === 2 ? ` <span class="badge badge-traitor">🗡 ×2</span>` : ""}` : `<span class="muted">${esc(i.note || "No vote")}</span>`}</div>`;
}

// ---------------------------------------------------------------- timer
function tickTimer() {
  const t = S.game?.timer; const el = $("[data-timer]"); if (!el || !t) return;
  const s = timerRemaining(t);
  el.textContent = fmtTime(s); el.classList.toggle("urgent", s <= 30);
  if (S.lastTimerSec !== s) {
    if (t.running && s > 0 && s <= 10) sfx.tick();
    if (t.running && s === 0 && S.lastTimerSec > 0) sfx.gong();
    S.lastTimerSec = s;
  }
}

// ---------------------------------------------------------------- dramatic overlays
function handleAnnounce() {
  const a = S.game.announce; if (!a) return;
  if (S.lastAnn === null) { S.lastAnn = a.ts; return; }
  if (a.ts <= S.lastAnn) return; S.lastAnn = a.ts;
  if (Date.now() - a.ts > 120000) return;
  clearTimeout(S.overlayTimer); $(".overlay")?.remove();
  const ov = h(`<div class="overlay"></div>`); document.body.append(ov);
  const close = (ms) => (S.overlayTimer = setTimeout(() => ov.remove(), ms));
  ov.onclick = () => ov.remove();
  switch (a.kind) {
    case "role": {
      sfx.drum();
      ov.innerHTML = `${avatarHTML(a.name, "xl")}<h1>${esc(a.name)}</h1><p class="sub">was…</p>`;
      setTimeout(() => {
        const t = a.role === "Traitor";
        ov.insertAdjacentHTML("beforeend", `<div class="d-big-role ${t ? "traitor" : "faithful"}" style="animation:fadeIn .8s">${t ? "A TRAITOR" : "FAITHFUL"}</div>`);
        t ? sfx.sting() : sfx.gong();
      }, 2600);
      close(9000); break;
    }
    case "murder":
      sfx.sting();
      ov.innerHTML = `<div style="font-size:5rem">🔪</div>${avatarHTML(a.name, "xl")}<h1 class="red">${esc(a.name)}</h1><p class="sub">was murdered in the night.</p>`;
      close(8000); break;
    case "nomurder":
      sfx.chime(); ov.innerHTML = `<div style="font-size:6rem">🌅</div><h1>Everyone survived the night</h1><p class="sub">…this time.</p>`; close(6000); break;
    case "banish":
      sfx.gong(); ov.innerHTML = `<div style="font-size:5rem">⚖️</div>${avatarHTML(a.name, "xl")}<h1>${esc(a.name)}</h1><p class="sub">has been banished.</p>`; close(6000); break;
    case "night":
      sfx.gong(); ov.style.background = "radial-gradient(circle at 50% 30%,#1b2440,#020308 70%)";
      ov.innerHTML = `<div class="d-moon">🌙</div><h1 style="color:#cfd8ff">Night falls</h1><p class="sub">Faithfuls, sleep. Traitors, awaken.</p>`; close(6000); break;
    case "win":
      sfx.heroic(); ov.innerHTML = `<div class="winner-banner ${a.winner === "Traitors" ? "red" : ""}" style="${a.winner === "Traitors" ? "" : "color:#9cc2ff"}">${esc(a.text)}</div>`; close(9000); break;
    default:
      sfx.chime(); ov.innerHTML = `<h1 style="font-size:clamp(2rem,5vw,4rem)">${esc(a.text || "")}</h1>`; close(5500);
  }
}
