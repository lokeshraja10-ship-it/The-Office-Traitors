// =====================================================================
//  THE TRAITORS — shared core (Firebase init, refs, helpers, UI utils)
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection,
  query, where, orderBy, writeBatch, deleteField, arrayUnion, arrayRemove, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export {
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection,
  query, where, orderBy, writeBatch, deleteField, arrayUnion, arrayRemove, increment
};

// ---------- Firebase ----------
export function configOk() {
  return !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("PASTE"));
}
let app = null, auth = null, db = null;
if (configOk()) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}
export { app, auth, db };

export function ensureAuth() {
  if (!configOk()) return Promise.reject(new Error("Firebase is not configured. Open js/config.js and paste your Firebase web config."));
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) { unsub(); resolve(user); return; }
      try { await signInAnonymously(auth); } catch (e) { unsub(); reject(e); }
    });
  });
}

// ---------- Firestore references ----------
export const R = {
  game:    (c)        => doc(db, "games", c),
  secret:  (c)        => doc(db, "games", c, "gm", "secret"),
  priv:    (c, k)     => doc(db, "games", c, "private", k),
  claim:   (c, p)     => doc(db, "games", c, "claims", p),
  claims:  (c)        => collection(db, "games", c, "claims"),
  vote:    (c, v, p)  => doc(db, "games", c, "votes", `${v}_${p}`),
  votes:   (c)        => collection(db, "games", c, "votes"),
  chamber: (c, k)     => doc(db, "games", c, "chamber", k),
  msgs:    (c, k)     => collection(db, "games", c, "chamber", k, "messages"),
  newMsg:  (c, k)     => doc(collection(db, "games", c, "chamber", k, "messages")),
  noms:    (c, k)     => collection(db, "games", c, "chamber", k, "nominations"),
  nom:     (c, k, p)  => doc(db, "games", c, "chamber", k, "nominations", p),
  gmAccess:(c, k)     => doc(db, "games", c, "gmAccess", k),
  gmDev:   (c, u)     => doc(db, "games", c, "gmDevices", u),
};

// ---------- Random / crypto ----------
export const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
export function randStr(n, alpha = ALPHA) {
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return Array.from(a, (x) => alpha[x % alpha.length]).join("");
}
export function randHex(bytes = 16) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
}
/** The secret document id of a player = hash(code, playerId, PIN). Only the PIN holder (and GM) can compute it. */
export const playerKey = (code, pid, pin) => sha256hex(`traitors|${code}|${pid}|${String(pin).toUpperCase().trim()}`);
/** Game Master password key = hash(code, password). Password is case-sensitive. */
export const gmPassKey = (code, pw) => sha256hex(`traitors-gm|${code}|${String(pw)}`);
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    const j = r[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function recommendedTraitors(n) {
  if (n <= 5) return 1;
  if (n <= 10) return 2;
  if (n <= 16) return 3;
  if (n <= 24) return 4;
  return 5;
}

// ---------- DOM ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function toast(msg, type = "info", ms = 3500) {
  let box = $("#toasts");
  if (!box) { box = h(`<div id="toasts"></div>`); document.body.append(box); }
  const t = h(`<div class="toast toast-${type}"></div>`); t.textContent = msg;
  box.append(t);
  setTimeout(() => t.classList.add("out"), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function modal({ title, body, actions = [{ label: "OK", value: true, cls: "btn-primary" }], dismissable = true, cls = "" }) {
  return new Promise((res) => {
    const wrap = h(`<div class="modal-backdrop"><div class="modal ${cls}"><h3></h3><div class="modal-body"></div><div class="modal-actions"></div></div></div>`);
    wrap.querySelector("h3").textContent = title || "";
    const b = wrap.querySelector(".modal-body");
    if (typeof body === "string") b.innerHTML = body; else if (body) b.append(body);
    const acts = wrap.querySelector(".modal-actions");
    const close = (v) => { wrap.remove(); res(v); };
    actions.forEach((a) => {
      const btn = h(`<button class="btn ${a.cls || ""}"></button>`); btn.textContent = a.label;
      btn.onclick = () => close(typeof a.value === "function" ? a.value(wrap) : a.value);
      acts.append(btn);
    });
    if (dismissable) wrap.addEventListener("click", (e) => { if (e.target === wrap) close(null); });
    document.body.append(wrap);
    const first = wrap.querySelector("input,select,textarea"); if (first) first.focus();
  });
}
export const confirmBox = (title, body, ok = "Confirm", danger = false) =>
  modal({ title, body, actions: [{ label: "Cancel", value: false, cls: "btn-ghost" }, { label: ok, value: true, cls: danger ? "btn-danger" : "btn-primary" }] });
export async function promptBox(title, label, value = "") {
  const v = await modal({
    title, body: `<label class="form">${esc(label)}<input id="promptInput" value="${esc(value)}" maxlength="60"></label>`,
    actions: [{ label: "Cancel", value: null, cls: "btn-ghost" }, { label: "Save", value: (w) => w.querySelector("#promptInput").value, cls: "btn-primary" }]
  });
  return v == null ? null : String(v).trim();
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard", "ok"); }
  catch {
    const ta = h(`<textarea style="position:fixed;opacity:0"></textarea>`); ta.value = text; document.body.append(ta);
    ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied to clipboard", "ok");
  }
}

// ---------- Display helpers ----------
export function initials(n) { return String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(""); }
export function hue(n) { let x = 7; for (const c of String(n || "")) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
export function avatarHTML(name, cls = "") { return `<span class="avatar ${cls}" style="--h:${hue(name)}">${esc(initials(name))}</span>`; }
export function money(n, cur = "₹") { return `${cur || ""}${Number(n || 0).toLocaleString("en-IN")}`; }
export function roleBadge(role) {
  if (role === "Traitor") return `<span class="badge badge-traitor">🗡 Traitor</span>`;
  if (role === "Faithful") return `<span class="badge badge-faithful">🛡 Faithful</span>`;
  return `<span class="badge">—</span>`;
}
export function statusBadge(pl) {
  if (!pl) return "";
  if (pl.status === "murdered") return `<span class="badge badge-murdered">🔪 Murdered${pl.eliminatedDay ? ` · Day ${pl.eliminatedDay}` : ""}</span>`;
  if (pl.status === "banished") return `<span class="badge badge-banished">⚖️ Banished${pl.eliminatedDay ? ` · Day ${pl.eliminatedDay}` : ""}</span>`;
  return `<span class="badge badge-alive">Alive</span>`;
}

export const PHASES = {
  lobby:      { title: "Lobby",            icon: "🏰", desc: "Gathering the players" },
  roles:      { title: "Roles Assigned",   icon: "🎭", desc: "Check your role in private" },
  breakfast:  { title: "Breakfast",        icon: "☕", desc: "Who didn't make it through the night?" },
  mission:    { title: "Mission",          icon: "⚔️", desc: "Earn money for the prize pot" },
  roundtable: { title: "Round Table",      icon: "🪑", desc: "Accuse. Defend. Decide." },
  voting:     { title: "Voting",           icon: "🗳", desc: "Cast your vote in secret" },
  reveal:     { title: "The Reveal",       icon: "📜", desc: "Votes revealed one by one" },
  banishment: { title: "Banishment",       icon: "⚖️", desc: "Who were they really?" },
  night:      { title: "Night",            icon: "🌙", desc: "The Traitors are choosing…" },
  endgame:    { title: "The Endgame",      icon: "🔥", desc: "End it — or banish again?" },
  finished:   { title: "Game Over",        icon: "🏆", desc: "The truth is revealed" },
};

export const alive = (g) => (g?.order || []).filter((p) => g.players?.[p]?.status === "alive");
export const pname = (g, p) => (p === "END" ? "END THE GAME" : p === "BANISH" ? "BANISH AGAIN" : g?.players?.[p]?.name || "—");
export function timerRemaining(t) {
  if (!t) return 0;
  if (t.running) return Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
  return Math.max(0, t.remaining || 0);
}
export function fmtTime(s) { s = Math.max(0, s | 0); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

export function pageUrl(page, params = {}) {
  const u = new URL(page, location.href);
  u.search = "";
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.href;
}
export const qrUrl = (data, size = 240) => `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`;

export function errMsg(e) {
  const c = String(e?.code || "");
  if (c.includes("permission-denied")) return "Permission denied. Check that the Firestore rules are published, and that you are logged in with the correct PIN / GM password.";
  if (c.includes("admin-restricted-operation") || c.includes("operation-not-allowed")) return "Anonymous sign-in is disabled. Enable it in Firebase → Authentication → Sign-in method.";
  if (c.includes("unauthorized-domain")) return "This domain is not authorised. Add it in Firebase → Authentication → Settings → Authorized domains.";
  if (c.includes("unavailable") || c.includes("network")) return "Network problem — check your connection (office networks may block Firebase).";
  return e?.message || String(e);
}

// ---------- Sound (Web Audio, no files needed) ----------
let actx = null;
export function enableSound() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); return true; } catch { return false; }
}
function tone(freq, dur, type = "sine", vol = 0.2, when = 0, slide = 0) {
  if (!actx) return;
  const t = actx.currentTime + when;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
}
export const sfx = {
  gong()   { tone(98, 3, "sine", 0.4); tone(196, 2.4, "triangle", 0.12); tone(147, 2.6, "sine", 0.1); },
  sting()  { tone(70, 1.8, "sawtooth", 0.12, 0, -20); tone(73, 1.8, "sawtooth", 0.1, 0, -20); tone(35, 2, "sine", 0.3); },
  reveal() { [0, 0.1, 0.2].forEach((w, i) => tone(330 + i * 110, 0.3, "triangle", 0.15, w)); },
  chime()  { tone(880, 0.7, "sine", 0.15); tone(1320, 0.9, "sine", 0.08, 0.12); },
  tick()   { tone(1100, 0.05, "square", 0.04); },
  drum()   { for (let i = 0; i < 20; i++) tone(60 + (i % 2) * 6, 0.09, "triangle", 0.12 + i * 0.01, i * 0.11); },
  heroic() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.6, "triangle", 0.15, i * 0.15)); },
};

// ---------- Extra styles (broadcast banner + notes tab) ----------
(function injectExtraStyles() {
  if (typeof document === "undefined" || document.getElementById("traitors-extra-css")) return;
  const st = document.createElement("style"); st.id = "traitors-extra-css";
  st.textContent = `
  .bcast{display:flex;gap:10px;align-items:flex-start;margin:10px 0;padding:12px 14px;border-radius:12px;
    background:linear-gradient(90deg,rgba(212,162,76,.22),rgba(212,162,76,.06));border:1px solid rgba(212,162,76,.55);
    border-left:5px solid #d4a24c;color:#fff3d6;font-weight:600;line-height:1.35;animation:fadeIn .4s}
  .bcast .bi{font-size:1.3rem}.bcast .bl{display:block;font-size:.7rem;letter-spacing:.15em;text-transform:uppercase;color:#d4a24c;font-weight:700}
  .bcast .bt{white-space:pre-wrap;word-break:break-word}
  .d-bcast{margin:6px 24px 0}.d-bcast .bcast{font-size:clamp(1.3rem,2.6vw,2.2rem);padding:16px 22px}.d-bcast .bcast .bl{font-size:.9rem}
  .gm-bcast{margin:6px 0 10px}.gm-bcast .bcast{margin:0}.gm-bcast .row-r{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  .notes-title{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:default;margin-bottom:4px}
  .notes-area{width:100%;min-height:180px;resize:vertical;font:inherit;padding:10px;border-radius:10px}
  .sec-box{margin-top:12px}
  .sec-box .sec-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
  `;
  document.head.append(st);
})();
export function broadcastHTML(b) {
  if (!b || !b.text) return "";
  return `<div class="bcast"><span class="bi">📣</span><div><span class="bl">Message from the Game Master</span><span class="bt">${esc(b.text)}</span></div></div>`;
}

// ---------- Config warning ----------
export function configBanner() {
  if (configOk()) return "";
  return `<div class="alert alert-red" style="max-width:900px;margin:16px auto"><b>Setup needed:</b> Firebase is not configured yet. Edit <code>js/config.js</code> with your Firebase web config (see README.md).</div>`;
}
