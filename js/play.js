// ---------------------------------------------------------------- NOTES (same for everyone; Traitors' room hidden inside)
const notesKey = () => `traitors.notes.${S.code}.${S.pid}`;
const ACT_LABEL = { murder: "🔪 Murder", recruit: "🤝 Recruit", ultimatum: "⚠️ Blackmail", none: "— None" };
document.addEventListener("visibilitychange", () => { if (document.hidden && S.secretOpen) { S.secretOpen = false; render(); } });

// Win-chance bar (blue = Faithful, red = Traitors). Same for every player.
function oddsHTML() {
  const g = S.game || {}, o = g.odds;
  if (!o) return `<p class="tiny muted" style="margin:0">${g.phase === "lobby" ? "Win chances appear once roles are assigned." : "Win chances are hidden by the Game Master."}</p>`;
  const f = Math.max(0, Math.min(100, Math.round(Number(o.f) || 0))), t = 100 - f;
  return `<div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:6px">
      <span style="color:#5b9bff">🛡 Faithful ${f}%</span><span style="color:#ff5a6a">${t}% Traitors 🗡</span></div>
    <div role="img" aria-label="Faithful ${f} percent, Traitors ${t} percent" style="display:flex;height:18px;border-radius:999px;overflow:hidden;background:#222;border:1px solid rgba(255,255,255,.18)">
      <div style="width:${f}%;background:linear-gradient(90deg,#1f5fbf,#4f8fff)"></div>
      <div style="width:${t}%;background:linear-gradient(90deg,#c2283a,#ff4d5e)"></div>
    </div>
    <p class="tiny muted" style="margin:6px 0 0">Updated at breakfast and after each banishment.</p>`;
}

function renderNotes(v) {
  if (!S.notesBuilt) {
    S.notesBuilt = true; S.secBuilt = false;
    v.innerHTML = `
      <div class="card">
        <h3 style="margin:0 0 8px">📊 Who's winning?</h3>
        <div id="oddsBox"></div>
      </div>
      <div class="card">
        <h3 class="notes-title" id="notesTitle">📝 My notes</h3>
        <p class="tiny muted">Private to this phone. Jot down suspicions, votes and alibis.</p>
        <textarea class="notes-area" id="notesText" placeholder="Who's acting strange? Who voted for whom?"></textarea>
      </div>
      <div id="secBox"></div>`;
    const ta = $("#notesText", v);
    ta.value = localStorage.getItem(notesKey()) || "";
    ta.oninput = () => localStorage.setItem(notesKey(), ta.value);
    // Hidden gesture: press-and-hold the title for 1 s. Silently does nothing for Faithfuls.
    const t = $("#notesTitle", v); let timer = null;
    const cancel = () => { clearTimeout(timer); timer = null; };
    t.addEventListener("pointerdown", (e) => {
      e.preventDefault(); cancel();
      timer = setTimeout(() => { timer = null; if (isTraitor()) { S.secretOpen = !S.secretOpen; S.secBuilt = false; navigator.vibrate?.(30); renderNotes(v); } }, 1000);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => t.addEventListener(ev, cancel));
    t.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  const ob = $("#oddsBox", v), oh = oddsHTML();
  if (ob && ob.dataset.sig !== oh) { ob.dataset.sig = oh; ob.innerHTML = oh; }
  const box = $("#secBox", v);
  if (isTraitor() && S.secretOpen) renderSecret(box);
  else if (box.innerHTML) { box.innerHTML = ""; S.secBuilt = false; }
}

const actState = (a) => a.type === "none" ? "agreed"
  : a.type === "murder" ? (a.blocked ? "🛡 blocked by a Shield" : "confirmed")
  : a.state === "accepted" ? "✅ accepted" : a.state === "refused" ? (a.type === "ultimatum" ? "❌ refused — they will not wake up" : "❌ refused")
  : "⏳ awaiting their answer";

function renderSecret(box) {
  const g = S.game, ch = S.chamber || {};
  if (!S.secBuilt) {
    S.secBuilt = true;
    box.innerHTML = `
      <div class="card sec-box">
        <div class="sec-head"><h3 style="margin:0">🗒 Shared notes</h3><button class="btn btn-sm btn-ghost" id="secHide">Done</button></div>
        <div data-t="status"></div>
        <div data-t="nominate"></div>
        <div class="chat" data-t="chat" style="margin-top:10px"></div>
        <form class="chat-form" id="tChat"><input id="tChatText" maxlength="300" placeholder="Add a note…" autocomplete="off"><button class="btn">Add</button></form>
      </div>`;
    $("#secHide", box).onclick = () => { S.secretOpen = false; render(); };
    $("#tChat", box).onsubmit = async (e) => {
      e.preventDefault(); const t = $("#tChatText").value.trim(); if (!t) return;
      if (!amAlive()) return toast("You can only read now.", "error");
      try { await setDoc(R.newMsg(S.code, S.chamberKey), { from: S.pid, name: me().name, text: t, ts: Date.now() }); $("#tChatText").value = ""; }
      catch (err) { toast(errMsg(err), "error"); }
    };
  }
  const fellows = (S.priv.fellows || []);
  $('[data-t="status"]', box).innerHTML = `<p class="small" style="margin:8px 0">With: ${fellows.map((f) => `<b class="${g.players[f.pid]?.status === "alive" ? "" : "dim"}">${esc(f.name)}${f.pid === S.pid ? " (you)" : ""}</b>`).join(", ")}</p>
    ${ch.status ? `<div class="alert">${esc(ch.status)}</div>` : ""}`;

  let nom = "";
  if (g.phase === "night" && ch.nightId && amAlive()) {
    if (S.pickNight !== ch.nightId) { S.pickNight = ch.nightId; S.pickType = {}; }
    const acts = ch.acts || {};
    const noms = S.noms.filter((n) => n.nightId === ch.nightId)
      .map((n) => ({ by: n.by || n.id, slot: Number(n.slot) || 1, type: n.type || n.mode || "murder", target: n.target || "" }));
    const ids = new Set(fellows.map((f) => f.pid));
    const targetsAll = alive(g).filter((p) => !ids.has(p));
    nom = `<h3 style="margin-top:12px">Tonight's plan</h3>
      <p class="tiny">You may take up to <b>2 actions</b> — any mix of murder, recruit or blackmail (join or die). Pick an action and a name for each, agree with your partners, and the Game Master confirms.</p>`;
    for (const slot of [1, 2]) {
      const a = acts[slot] && acts[slot].nightId === ch.nightId ? acts[slot] : null;
      const mine = noms.find((n) => n.by === S.pid && n.slot === slot);
      const type = S.pickType[slot] || mine?.type || "murder";
      const picks = noms.filter((n) => n.slot === slot);
      nom += `<div style="border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:10px;margin:10px 0"><b>Action ${slot}</b>`;
      if (a) {
        nom += `<p class="small" style="margin:6px 0 0">✔ ${a.type === "none" ? "No action" : `${ACT_LABEL[a.type] || esc(a.type)}: <b>${esc(a.name || pname(g, a.pid))}</b>`} — ${actState(a)}</p></div>`;
        continue;
      }
      const other = acts[slot === 1 ? 2 : 1];
      const targets = targetsAll.filter((p) => !(other && other.nightId === ch.nightId && other.pid === p));
      nom += `<div class="chips" style="margin:8px 0">${["murder", "recruit", "ultimatum", "none"].map((tp) =>
        `<button class="chip ${type === tp ? "sel" : ""}" data-ptype="${tp}" data-slot="${slot}" style="${type === tp ? "outline:2px solid currentColor;font-weight:700" : ""}">${ACT_LABEL[tp]}</button>`).join("")}</div>`;
      if (type !== "none") {
        nom += `<div class="cand-grid">${targets.map((p) => {
          const c = picks.filter((n) => n.target === p && n.type === type).length;
          return `<button class="cand ${mine?.target === p && mine?.type === type ? "sel" : ""}" data-nom="${p}" data-slot="${slot}" data-type="${type}">${avatarHTML(pname(g, p), "lg")}${esc(pname(g, p))}${c ? `<span class="badge">${c}</span>` : ""}</button>`;
        }).join("")}</div>`;
      }
      if (picks.length) nom += `<ul class="log" style="margin-top:8px">${picks.map((n) => `<li>${esc(n.by === S.pid ? "You" : pname(g, n.by))} ➜ ${ACT_LABEL[n.type] || esc(n.type)}${n.type !== "none" && n.target ? ` <b>${esc(pname(g, n.target))}</b>` : ""}</li>`).join("")}</ul>`;
      nom += `</div>`;
    }
  }
  $('[data-t="nominate"]', box).innerHTML = nom;

  $$("[data-ptype]", box).forEach((b) => (b.onclick = async () => {
    const slot = Number(b.dataset.slot), tp = b.dataset.ptype;
    S.pickType[slot] = tp;
    if (tp === "none") {
      try { await setDoc(R.nom(S.code, S.chamberKey, `${S.pid}_${slot}`), { by: S.pid, slot, type: "none", target: "", nightId: ch.nightId, ts: Date.now() }); }
      catch (e) { toast(errMsg(e), "error"); }
    }
    renderSecret(box);
  }));
  $$("[data-nom]", box).forEach((b) => (b.onclick = async () => {
    const slot = Number(b.dataset.slot);
    try {
      await setDoc(R.nom(S.code, S.chamberKey, `${S.pid}_${slot}`), { by: S.pid, slot, type: b.dataset.type || "murder", target: b.dataset.nom, nightId: ch.nightId, ts: Date.now() });
      navigator.vibrate?.(50);
    } catch (e) { toast(errMsg(e), "error"); }
  }));

  const chat = $('[data-t="chat"]', box);
  const atBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 30;
  chat.innerHTML = S.msgs.map((m) => `<div class="msg ${m.system ? "sys" : ""}"><b>${esc(m.from === S.pid ? "You" : m.name)}:</b> ${esc(m.text)}</div>`).join("") || `<p class="muted small">No notes yet.</p>`;
  if (atBottom || !chat.dataset.init) { chat.scrollTop = chat.scrollHeight; chat.dataset.init = "1"; }
  const inp = $("#tChatText"); if (inp) inp.disabled = !amAlive();
}
