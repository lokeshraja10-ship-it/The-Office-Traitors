# 🗡️ The Traitors — Office Edition

A real-time, multi-device web app for playing **The Traitors** at the office.
Pure HTML/CSS/JavaScript (no build step), hosted on **GitHub Pages**, data in **Firebase (Firestore + Anonymous Auth)**.

| Screen | File | Who uses it |
|---|---|---|
| Landing + rules | `index.html` | Everyone |
| 👑 Game Master console | `gm.html` | The one Game Master (laptop) |
| 📱 Player app | `play.html` | Every player (their own phone) |
| 📺 Big screen | `display.html` | Meeting-room TV / projector |

---

## 1. One-time setup (≈ 15 minutes)

### A. Create the Firebase project
1. Go to <https://console.firebase.google.com> → **Add project** (Google Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**
3. **Build → Firestore Database → Create database** → choose a region (e.g. `asia-south1` Mumbai) → **Start in production mode**.
4. Firestore → **Rules** tab → delete everything → paste the full contents of **`firestore.rules`** → **Publish**.
5. **Project settings (⚙️) → General → Your apps → Web (`</>`)** → register an app (no hosting needed) → copy the `firebaseConfig` values.
6. Open **`js/config.js`** and paste your values (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).

> The Firebase web `apiKey` is not a secret — security comes from the Firestore rules you published in step 4.

### B. Publish on GitHub Pages
1. Create a new GitHub repository (e.g. `office-traitors`). It can be public.
2. Upload **all files and folders exactly as they are** (`index.html`, `gm.html`, `play.html`, `display.html`, `css/`, `js/`, `firestore.rules`, `.nojekyll`, `README.md`).
3. Repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
4. After 1–2 minutes your site is live at `https://<your-username>.github.io/<repo-name>/`.
5. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain →** `<your-username>.github.io`.

### C. Test before game day
- Open the site on your laptop → **Game Master** → create a test game with 4 dummy names.
- Open each invite link in a different browser / incognito window / phone and play through one round.
- ⚠️ **Office networks:** some corporate networks/proxies block `firebaseio`/`googleapis`/`gstatic`. Test on the actual office Wi-Fi. If blocked, players can use mobile data.

> To test locally instead: run `python -m http.server 8000` in the folder and open `http://localhost:8000` (ES modules don't work from `file://`). `localhost` is authorised in Firebase by default.

---

## 2. Running a game (Game Master guide)

**Before the event**
1. Open `gm.html` on your laptop → **Create game** (name, currency, starting pot).
   *Keep using this same laptop + browser — it is permanently the GM for this game.*
2. **Lobby:** paste player names (one per line) → **Add players**. Each player gets a secret 6-character **PIN**.
3. **Invite:** *Copy all invites* (personal one-tap links incl. PIN — send each privately on Teams/WhatsApp) or *Print PIN slips* (QR codes to cut and hand out).
4. Choose settings: number of Traitors (Auto recommended), Dagger on/off, endgame size, etc.
5. Open **📺 Big screen** on the meeting-room TV. The lobby shows a QR code and who has logged in.

**Game flow** (the GM console always shows the right buttons for the current phase)

| Phase | What the GM does | What players see |
|---|---|---|
| 🎭 Assign roles | Random or manual Traitors → *Assign roles & start* | Press-and-hold role card. Traitors see each other + get the **Turret** tab |
| ⚔️ Mission | Run any office challenge. Record money earned, secretly award 🛡 Shields / 🗡 Dagger | Pot rises; winners privately see their item |
| 🪑 Round Table | Start discussion timer → *Open banishment vote* | Secret vote on phone (can change until closed); Dagger holders can double their vote |
| 📜 Reveal | *Reveal next vote* one at a time (or all) | Big screen shows each vote + live tally |
| ⚖️ Banishment | *Banish* → let them speak → *Reveal role* | Big screen drum-roll: "…was A TRAITOR / FAITHFUL" |
| 🌙 Night | Choose murder / recruit / ultimatum; Traitors nominate in the Turret; GM confirms | Traitors chat & nominate; recruited player gets a secret Accept/Refuse prompt |
| ☕ Breakfast | *Reveal the night's outcome* | "X was murdered" — or "Everyone survived" (shields block silently) |
| 🔥 Endgame | *Open END-or-BANISH vote* (unanimous END needed) | If any Traitor survives → Traitors take the pot; else Faithfuls split it |

**Handy GM tools**
- **Privacy toggle (👁/🙈)** hides roles, PINs, nominations and the Turret on your screen if others can see your laptop.
- **📣 Broadcast** any message to all phones and the big screen.
- **Player ⋯ menu:** copy invite, rename, reset login, issue new PIN, manual status/role corrections, remove.
- **Tie votes:** revote between tied players (they don't vote), random draw, GM decides, or no banishment.
- **No Traitors left:** declare Faithful victory, or secretly appoint a new Traitor.
- **Secret GM log** records every hidden action (who got shields, who the Traitors chose, etc.).
- **Play again** resets the game with the same players and PINs.

---

## 3. Security & privacy design
- Each player's role lives in a private document whose ID is `SHA-256(gameCode | playerId | PIN)`. Firestore rules allow reading a document by ID but **never listing** the collection, so only someone with the PIN (and the GM) can find a role.
- A phone must prove it knows the PIN before it can vote as that player. Votes can only be cast while voting is open, only by eligible voters, and only the GM can read ballots until they are revealed.
- The Traitors' chamber (chat + nominations) lives under a random 128-bit key given only to Traitors.
- The GM is identified by the anonymous Firebase account that created the game; nobody else can change game state.
- This is designed for a friendly office game. A technically skilled player with the browser developer tools could still learn **their own** data only.

## 4. Data & cost
Uses a handful of Firestore reads/writes per action — a 20-person game comfortably fits in Firebase's free **Spark** plan. Old games can be deleted from the Firestore console (`games/<CODE>`).

## 5. Troubleshooting
| Symptom | Fix |
|---|---|
| "Setup needed: Firebase is not configured" | Fill in `js/config.js` |
| "Anonymous sign-in is disabled" | Firebase → Authentication → Sign-in method → enable Anonymous |
| "This domain is not authorised" | Add `<username>.github.io` under Authentication → Settings → Authorized domains |
| "Permission denied" | Re-publish `firestore.rules`; GM must use the same browser that created the game |
| Player sees "PIN doesn't match" | GM → player ⋯ → copy invite again (or issue a new PIN) |
| Player switched phone | Just log in on the new phone with the same PIN |
| Big-screen sound silent | Click "Enable sound" once (browsers require a click) |

## File structure
```
index.html        Landing page + how to play
gm.html           Game Master console
play.html         Player app (mobile)
display.html      Big-screen / projector view
css/style.css     Theme
js/config.js      ← your Firebase config goes here
js/core.js        Firebase init, references, shared helpers, sounds
js/gm.js          Game Master logic (phases, votes, nights, missions, endgame)
js/play.js        Player logic (login, role, voting, Turret)
js/display.js     Big-screen logic (timer, reveals, dramatic overlays)
firestore.rules   Security rules — paste into Firebase console
.nojekyll         Tells GitHub Pages to serve files as-is
```
