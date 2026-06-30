// ============================================
// FIREBASE SETUP
// Reuses the SAME Firebase project as the live R32 app, but writes to a
// completely separate document ('worldcup2026_r16_test/shared') so nothing
// here can ever touch or appear in the real game data.
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyApfMg-55DRSjQcWtq4Ml2B1yGh3MvZ_TM",
  authDomain: "worldcup2026-a5bd7.firebaseapp.com",
  projectId: "worldcup2026-a5bd7",
  storageBucket: "worldcup2026-a5bd7.firebasestorage.app",
  messagingSenderId: "358912564554",
  appId: "1:358912564554:web:5ae46c7c186a4918f2b5b3"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const TEST_DOC = doc(db, 'worldcup2026_r16_test', 'shared'); // <-- isolated from real game

// ============================================
// PLAYERS
// ============================================
const PLAYERS = [
  { name: 'Micole',   icon: '🍓' },
  { name: 'Eve',      icon: '🍐' },
  { name: 'Zac',      icon: '🍎' },
  { name: 'Sean',     icon: '🍍' },
];

// Pool of teams to randomly assign 6 each (24 needed minimum for 4 players x 6)
const TEAM_POOL = [
  { id:'morocco',     name:'Morocco',     flag:'🇲🇦' },
  { id:'paraguay',    name:'Paraguay',    flag:'🇵🇾' },
  { id:'brazil',      name:'Brazil',      flag:'🇧🇷' },
  { id:'argentina',   name:'Argentina',   flag:'🇦🇷' },
  { id:'france',      name:'France',      flag:'🇫🇷' },
  { id:'germany',     name:'Germany',     flag:'🇩🇪' },
  { id:'spain',       name:'Spain',       flag:'🇪🇸' },
  { id:'england',     name:'England',     flag:'🏴' },
  { id:'portugal',    name:'Portugal',    flag:'🇵🇹' },
  { id:'netherlands', name:'Netherlands', flag:'🇳🇱' },
  { id:'belgium',     name:'Belgium',     flag:'🇧🇪' },
  { id:'usa',         name:'USA',         flag:'🇺🇸' },
  { id:'mexico',      name:'Mexico',      flag:'🇲🇽' },
  { id:'croatia',     name:'Croatia',     flag:'🇭🇷' },
  { id:'japan',       name:'Japan',       flag:'🇯🇵' },
  { id:'senegal',     name:'Senegal',     flag:'🇸🇳' },
  { id:'colombia',    name:'Colombia',    flag:'🇨🇴' },
  { id:'switzerland', name:'Switzerland', flag:'🇨🇭' },
  { id:'sweden',      name:'Sweden',      flag:'🇸🇪' },
  { id:'austria',     name:'Austria',     flag:'🇦🇹' },
  { id:'canada',      name:'Canada',      flag:'🇨🇦' },
  { id:'ecuador',     name:'Ecuador',     flag:'🇪🇨' },
  { id:'norway',      name:'Norway',      flag:'🇳🇴' },
  { id:'australia',   name:'Australia',   flag:'🇦🇺' },
];

function getTeam(teamId) {
  return TEAM_POOL.find(t => t.id === teamId) || null;
}

// ============================================
// STATE
// ============================================
let currentUser = null;
let state = {
  collection: {},     // { username: [teamId, teamId, ...] } — REAL, live ownership
  publicSnapshot: {},  // { username: [teamId, teamId, ...] } — what others can SEE when browsing
                       // who to trade with. Only updated by admin "reveal", not automatically
                       // when trades complete — this is what keeps trades genuinely secret.
  pendingOffers: {}, // { offerId: { from, to, give:[teamIds], want:[teamIds], status } }
  tradeLog: [],      // completed trades, for leaderboard reveal
};

let unsubscribe = null;

// ============================================
// FIREBASE HELPERS
// ============================================
async function saveState(partial) {
  try { await setDoc(TEST_DOC, partial, { merge: true }); }
  catch (e) { showToast('Save failed','error'); }
}

async function loadState() {
  try {
    const snap = await getDoc(TEST_DOC);
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

function startListener() {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(TEST_DOC, snap => {
    if (snap.exists()) {
      const d = snap.data();
      const newOffers = d.pendingOffers || {};
      notifyOnOfferChanges(state.pendingOffers, newOffers);
      state.collection     = d.collection     || {};
      // No fallback to d.collection here on purpose — login() guarantees a
      // real, persisted publicSnapshot exists before the listener starts.
      // Falling back to live data here would silently defeat the secrecy.
      state.publicSnapshot = d.publicSnapshot || {};
      state.pendingOffers  = newOffers;
      state.tradeLog       = d.tradeLog       || [];
      refreshAll();
    }
  });
}

// Compares the previous and incoming pendingOffers and pops a toast for any
// of the current user's OWN sent offers that just resolved (accepted or
// denied) since the last update — so you find out live, without needing to
// be sitting on the Inbox tab.
let notifiedOfferIds = new Set();
function notifyOnOfferChanges(oldOffers, newOffers) {
  if (!currentUser || !oldOffers) return;
  Object.entries(newOffers).forEach(([id, offer]) => {
    if (offer.from !== currentUser) return;
    const prevStatus = oldOffers[id]?.status;
    if (prevStatus !== 'pending') return;
    if (offer.status !== 'accepted' && offer.status !== 'denied') return;
    if (notifiedOfferIds.has(id)) return;
    notifiedOfferIds.add(id);

    const giveNames = offer.give.map(tid => getTeam(tid)?.name).join(' + ');
    const wantNames  = offer.want.map(tid => getTeam(tid)?.name).join(' + ');
    if (offer.status === 'accepted') {
      showToast(`✅ Your trade with ${offer.to} went through — ${giveNames} for ${wantNames}!`, 'success');
    } else {
      showToast(`❌ Your offer to ${offer.to} for ${wantNames} was denied.`, 'error');
    }
  });
}

function refreshAll() {
  updateHeader();
  updateInboxBadge();
  if (!document.getElementById('mypicks').classList.contains('hidden'))     renderMyPicks();
  if (!document.getElementById('trade').classList.contains('hidden'))       renderTrade();
  if (!document.getElementById('inbox').classList.contains('hidden'))       renderInbox();
  if (!document.getElementById('leaderboard').classList.contains('hidden')) renderLeaderboard();
}

// Shows the count of pending incoming offers as a small badge on the Inbox
// nav button, so you can tell at a glance you have offers waiting without
// having to click in.
function updateInboxBadge() {
  const badge = document.getElementById('inbox-badge');
  if (!badge || !currentUser) return;
  const count = Object.values(state.pendingOffers).filter(o => o.to === currentUser && o.status === 'pending').length;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ============================================
// SIMULATION SETUP
// ============================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateRandomSquads() {
  const shuffled = shuffle(TEAM_POOL).map(t => t.id);
  const collection = {};
  PLAYERS.forEach((p, i) => {
    collection[p.name] = shuffled.slice(i * 6, i * 6 + 6);
  });
  return collection;
}

window.resetSimulation = async function() {
  if (!confirm('Re-roll everyone\'s random squads and clear all pending/completed trades?')) return;
  const squads = generateRandomSquads();
  const fresh = {
    collection: squads,
    publicSnapshot: { ...squads }, // public knowledge starts identical to reality
    pendingOffers: {},
    tradeLog: [],
  };
  await setDoc(TEST_DOC, fresh);
  state = fresh;
  showToast('🔁 Squads re-rolled!','success');
  if (currentUser) refreshAll();
};

// ============================================
// LOGIN / LOGOUT
// ============================================
function renderLoginButtons() {
  const wrap = document.getElementById('player-buttons');
  wrap.innerHTML = PLAYERS.map(p =>
    `<button class="player-btn" onclick="login('${p.name}')">${p.icon} ${p.name}</button>`
  ).join('');
}

async function login(name) {
  let d = await loadState();
  if (!d || !d.collection || Object.keys(d.collection).length === 0) {
    const squads = generateRandomSquads();
    d = { collection: squads, publicSnapshot: { ...squads }, pendingOffers: {}, tradeLog: [] };
    await setDoc(TEST_DOC, d);
  } else if (!d.publicSnapshot) {
    // Existing test data predates the snapshot feature — freeze a copy NOW
    // and save it, so it stops silently mirroring live data on every load.
    d.publicSnapshot = JSON.parse(JSON.stringify(d.collection));
    await saveState({ publicSnapshot: d.publicSnapshot });
  }
  state.collection     = d.collection     || {};
  state.publicSnapshot = d.publicSnapshot || {};
  state.pendingOffers  = d.pendingOffers  || {};
  state.tradeLog        = d.tradeLog       || [];

  currentUser = name;
  // Don't notify for offers that were already resolved before this login —
  // only fire toasts for changes that happen DURING this session.
  notifiedOfferIds = new Set(
    Object.entries(state.pendingOffers)
      .filter(([id, o]) => o.from === currentUser && o.status !== 'pending')
      .map(([id]) => id)
  );

  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateHeader();
  updateInboxBadge();
  showSection('mypicks', { target: document.getElementById('nav-mypicks') });
  startListener();
}
window.login = login;

function logout() {
  if (unsubscribe) unsubscribe();
  currentUser = null;
  notifiedOfferIds = new Set();
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}
window.logout = logout;

function updateHeader() {
  const el = document.getElementById('welcome-msg');
  if (!el || !currentUser) return;
  const count = (state.collection[currentUser] || []).length;
  el.textContent = `${currentUser} · ${count} teams`;
}

// ============================================
// NAVIGATION
// ============================================
function showSection(id, e) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (e && e.target) e.target.classList.add('active');
  if (id === 'mypicks')     renderMyPicks();
  if (id === 'trade')       renderTrade();
  if (id === 'inbox')       renderInbox();
  if (id === 'leaderboard') renderLeaderboard();
}
window.showSection = showSection;

// ============================================
// MY SQUAD
// ============================================
function renderMyPicks() {
  const container = document.getElementById('mypicks-container');
  if (!container) return;
  const myTeams = (state.collection[currentUser] || []).map(getTeam).filter(Boolean);
  container.innerHTML = `<div class="squad-grid">${myTeams.map(t =>
    `<div class="squad-card"><div class="squad-flag">${t.flag}</div><div class="squad-name">${t.name}</div></div>`
  ).join('')}</div>`;
}

// ============================================
// TRADE LOCK HELPERS
// A player is "busy" (locked) if they have ANY pending offer addressed to
// them. While busy, nobody else can open a new trade with them — keeps
// trades strictly sequential, no racing offers on the same team.
// ============================================
// No busy-lock — multiple players can propose trades to the same person at
// once. The recipient sees all pending offers and picks one to accept; every
// other pending offer that becomes impossible as a result is auto-denied,
// with no explanation given to the sender (they just see "denied" — same as
// if the recipient had simply declined). This keeps trades genuinely secret:
// nobody outside the two parties in an ACCEPTED trade ever learns it happened
// until the leaderboard's trade log reflects it.

// ============================================
// PROPOSE TRADE
// ============================================
let tradeSelection = { give: new Set(), want: new Set() };

function renderTrade() {
  const container = document.getElementById('trade-container');
  if (!container) return;

  const otherPlayers = PLAYERS.filter(p => p.name !== currentUser);
  const lastTarget = container.dataset.target || otherPlayers[0]?.name;
  const isAdmin = currentUser === 'Micole';

  container.innerHTML = `
    <div class="trade-pick">
      <label>Trade with</label>
      <select id="trade-target-select" onchange="onTradeTargetChange()">
        ${otherPlayers.map(p => `<option value="${p.name}" ${p.name===lastTarget?'selected':''}>${p.icon} ${p.name}</option>`).join('')}
      </select>
    </div>
    <div id="trade-body"></div>
    ${isAdmin ? `<button class="logout-btn" style="margin-top:24px" onclick="revealPublicSnapshot()">🔁 Reveal trades to date (admin)</button>` : ''}
  `;
  container.dataset.target = lastTarget;
  renderTradeBody(lastTarget);
}

// Admin-only: catches the "public knowledge" snapshot up to real ownership —
// stands in for the real game's rule that a traded team's ownership only
// becomes visible to everyone once that team plays its next match.
window.revealPublicSnapshot = async function() {
  if (!confirm('Reveal all trades made so far to everyone? (simulates traded teams playing their next match)')) return;
  state.publicSnapshot = JSON.parse(JSON.stringify(state.collection));
  await saveState({ publicSnapshot: state.publicSnapshot });
  showToast('🔁 Public knowledge updated!','success');
  renderTrade();
};

window.onTradeTargetChange = function() {
  const select = document.getElementById('trade-target-select');
  const target = select.value;
  document.getElementById('trade-container').dataset.target = target;
  tradeSelection = { give: new Set(), want: new Set() };
  renderTradeBody(target);
};

function renderTradeBody(targetName) {
  const body = document.getElementById('trade-body');
  if (!body) return;

  const myTeams    = (state.collection[currentUser] || []).map(getTeam).filter(Boolean);
  // Deliberately uses publicSnapshot, NOT the live state.collection — this is
  // what keeps trades secret. If targetName secretly traded a team away, it
  // still shows here until an admin "reveal" catches the snapshot up; if you
  // try to request it anyway, sendTradeOffer will catch that at send-time.
  const theirTeams = (state.publicSnapshot[targetName] || []).map(getTeam).filter(Boolean);

  body.innerHTML = `
    <div class="trade-cols">
      <div class="trade-col">
        <h3>YOUR TEAMS — offer</h3>
        <div id="trade-give-list">${myTeams.map(t => tradeRowHTML(t,'give')).join('')}</div>
      </div>
      <div class="trade-col">
        <h3>${targetName.toUpperCase()}'S TEAMS — request</h3>
        <div id="trade-want-list">${theirTeams.map(t => tradeRowHTML(t,'want')).join('')}</div>
      </div>
    </div>
    <button class="cta-btn" id="trade-send-btn" onclick="sendTradeOffer('${targetName}')" disabled>Send Offer</button>
  `;
}

function tradeRowHTML(team, side) {
  return `<div class="trade-team-row" data-side="${side}" data-id="${team.id}" onclick="toggleTradeSelect('${side}','${team.id}')">
    <input type="checkbox"/> ${team.flag} ${team.name}
  </div>`;
}

window.toggleTradeSelect = function(side, teamId) {
  const set = tradeSelection[side];
  if (set.has(teamId)) set.delete(teamId); else set.add(teamId);
  document.querySelectorAll(`.trade-team-row[data-side="${side}"]`).forEach(row => {
    const checked = set.has(row.dataset.id);
    row.classList.toggle('selected', checked);
    row.querySelector('input').checked = checked;
  });
  const sendBtn = document.getElementById('trade-send-btn');
  if (sendBtn) sendBtn.disabled = !(tradeSelection.give.size > 0 && tradeSelection.want.size > 0);
};

window.sendTradeOffer = async function(targetName) {
  const give = [...tradeSelection.give];
  const want = [...tradeSelection.want];
  if (give.length === 0 || want.length === 0) { showToast('Select at least one team on each side.','error'); return; }

  // Validate against REAL ownership, not the public snapshot the picker was
  // built from — if targetName secretly traded away a requested team, this
  // catches it. No detail is given about why, same as elsewhere.
  const theirRealTeams = state.collection[targetName] || [];
  const stillHasAll = want.every(tid => theirRealTeams.includes(tid));
  if (!stillHasAll) {
    showToast(`One of those teams is no longer available from ${targetName}.`,'error');
    renderTrade();
    return;
  }

  const alreadyPending = Object.values(state.pendingOffers).some(o =>
    o.from === currentUser && o.to === targetName && o.status === 'pending'
  );
  if (alreadyPending) {
    showToast(`You already have a pending offer to ${targetName} — withdraw it first if you want to change it.`,'error');
    return;
  }

  const giveNames = give.map(id => getTeam(id)?.name).join(', ');
  const wantNames = want.map(id => getTeam(id)?.name).join(', ');
  if (!confirm(`Offer ${giveNames} for ${targetName}'s ${wantNames}?`)) return;

  const offerId = `offer_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  state.pendingOffers[offerId] = { from: currentUser, to: targetName, give, want, status: 'pending', ts: Date.now() };
  await saveState({ pendingOffers: state.pendingOffers });
  showToast('Offer sent! 📨','success');
  tradeSelection = { give: new Set(), want: new Set() };
  renderTrade();
};

// ============================================
// INBOX — accept / decline
// ============================================
function renderInbox() {
  const container = document.getElementById('inbox-container');
  if (!container) return;

  const myOffers     = Object.entries(state.pendingOffers).filter(([id, o]) => o.to === currentUser && o.status === 'pending');
  const mySentOffers = Object.entries(state.pendingOffers).filter(([id, o]) => o.from === currentUser && o.status === 'pending');
  const myResolvedSent = Object.entries(state.pendingOffers)
    .filter(([id, o]) => o.from === currentUser && (o.status === 'denied' || o.status === 'cancelled' || o.status === 'accepted'))
    .sort((a,b) => (b[1].ts||0) - (a[1].ts||0));

  let html = '';

  if (mySentOffers.length > 0) {
    html += `<h3 style="font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--text2);margin-bottom:10px;">Offers you've sent</h3>`;
    mySentOffers.forEach(([id, o]) => {
      html += `
        <div class="offer-card">
          <div class="offer-from">Sent to <strong>${o.to}</strong> — awaiting response</div>
          <div class="offer-row">
            <div class="offer-side">
              <div class="offer-side-label">You give</div>
              <div class="offer-teams">${o.give.map(tid => { const t=getTeam(tid); return `<span class="offer-team-badge">${t?.flag} ${t?.name}</span>`; }).join('')}</div>
            </div>
            <div class="offer-arrow">⇄</div>
            <div class="offer-side">
              <div class="offer-side-label">You want</div>
              <div class="offer-teams">${o.want.map(tid => { const t=getTeam(tid); return `<span class="offer-team-badge">${t?.flag} ${t?.name}</span>`; }).join('')}</div>
            </div>
          </div>
          <div class="offer-btns">
            <button class="offer-btn-decline" onclick="cancelMyOffer('${id}')">✖ Withdraw offer</button>
          </div>
        </div>`;
    });
  }

  if (myResolvedSent.length > 0) {
    html += `<h3 style="font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--text3);margin:18px 0 10px;">Recently resolved</h3>`;
    myResolvedSent.slice(0,5).forEach(([id, o]) => {
      const giveNames = o.give.map(tid => getTeam(tid)?.name).join(', ');
      const wantNames = o.want.map(tid => getTeam(tid)?.name).join(', ');
      if (o.status === 'accepted') {
        html += `<div class="offer-card" style="border-color:rgba(0,212,170,.3)"><div class="offer-from">✅ Trade with <strong>${o.to}</strong> went through — ${giveNames} for ${wantNames}</div></div>`;
      } else if (o.status === 'cancelled') {
        html += `<div class="offer-card" style="opacity:.6"><div class="offer-from">Offer to <strong>${o.to}</strong> — withdrawn by you</div></div>`;
      } else {
        html += `<div class="offer-card" style="opacity:.6"><div class="offer-from">Offer to <strong>${o.to}</strong> (${giveNames} for ${wantNames}) — denied</div></div>`;
      }
    });
  }

  if (mySentOffers.length > 0 || myResolvedSent.length > 0) {
    html += `<div style="height:1px;background:var(--border);margin:24px 0;"></div>`;
  }

  if (myOffers.length === 0) {
    html += `<div class="offer-empty">No incoming offers right now.</div>`;
  }

  html += myOffers.map(([id, o]) => `
    <div class="offer-card">
      <div class="offer-from">Offer from <strong>${o.from}</strong></div>
      <div class="offer-row">
        <div class="offer-side">
          <div class="offer-side-label">They give you</div>
          <div class="offer-teams">${o.give.map(tid => { const t=getTeam(tid); return `<span class="offer-team-badge">${t?.flag} ${t?.name}</span>`; }).join('')}</div>
        </div>
        <div class="offer-arrow">⇄</div>
        <div class="offer-side">
          <div class="offer-side-label">They want</div>
          <div class="offer-teams">${o.want.map(tid => { const t=getTeam(tid); return `<span class="offer-team-badge">${t?.flag} ${t?.name}</span>`; }).join('')}</div>
        </div>
      </div>
      <div class="offer-btns">
        <button class="offer-btn-accept" onclick="respondToOffer('${id}', true)">✅ Accept</button>
        <button class="offer-btn-decline" onclick="respondToOffer('${id}', false)">✖ Decline</button>
      </div>
    </div>
  `).join('');

  const myResolvedIncoming = Object.entries(state.pendingOffers).filter(([id, o]) =>
    o.to === currentUser && (o.status === 'denied' || o.status === 'accepted')
  ).sort((a,b) => (b[1].ts||0) - (a[1].ts||0)).slice(0, 5);

  if (myResolvedIncoming.length > 0) {
    html += `<div style="height:1px;background:var(--border);margin:24px 0;"></div>
      <h3 style="font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--text3);margin-bottom:10px;">Recently resolved</h3>`;
    myResolvedIncoming.forEach(([id, o]) => {
      const giveNames = o.give.map(tid => getTeam(tid)?.name).join(', ');
      const wantNames = o.want.map(tid => getTeam(tid)?.name).join(', ');
      const label = o.status === 'accepted' ? 'accepted' : 'denied';
      html += `<div class="offer-card" style="opacity:.6"><div class="offer-from">Offer from <strong>${o.from}</strong> (${giveNames} for ${wantNames}) — ${label}</div></div>`;
    });
  }

  container.innerHTML = html;
}

window.cancelMyOffer = async function(offerId) {
  if (!confirm('Withdraw this offer?')) return;
  if (state.pendingOffers[offerId]) state.pendingOffers[offerId].status = 'cancelled';
  await saveState({ pendingOffers: state.pendingOffers });
  showToast('Offer withdrawn.','');
  refreshAll();
};

window.respondToOffer = async function(offerId, accept) {
  const offer = state.pendingOffers[offerId];
  if (!offer) return;

  if (!accept) {
    state.pendingOffers[offerId].status = 'denied';
    await saveState({ pendingOffers: state.pendingOffers });
    showToast('Offer declined.','');
    renderInbox();
    return;
  }

  // Validate both sides still actually own what's being traded
  const fromCol = state.collection[offer.from] || [];
  const toCol   = state.collection[offer.to]   || [];
  const fromHasGive = offer.give.every(tid => fromCol.includes(tid));
  const toHasWant    = offer.want.every(tid => toCol.includes(tid));
  if (!fromHasGive || !toHasWant) {
    showToast('This trade is no longer valid — teams have changed hands.','error');
    state.pendingOffers[offerId].status = 'invalid';
    await saveState({ pendingOffers: state.pendingOffers });
    renderInbox();
    return;
  }

  state.collection[offer.from] = fromCol.filter(tid => !offer.give.includes(tid)).concat(offer.want);
  state.collection[offer.to]   = toCol.filter(tid => !offer.want.includes(tid)).concat(offer.give);
  state.pendingOffers[offerId].status = 'accepted';

  // Any other pending offer that touches a team that just changed hands is
  // now impossible — auto-deny it. The sender just sees "denied", with no
  // way to tell whether it was a deliberate decline or this collision, which
  // is exactly the secrecy you want (e.g. Sean never learns Zac traded
  // Sweden to Micole — he just learns his own offer didn't go through).
  const movedTeams = new Set([...offer.give, ...offer.want]);
  Object.entries(state.pendingOffers).forEach(([otherId, otherOffer]) => {
    if (otherId === offerId || otherOffer.status !== 'pending') return;
    const touchesMoved = [...otherOffer.give, ...otherOffer.want].some(tid => movedTeams.has(tid));
    if (touchesMoved) {
      state.pendingOffers[otherId].status = 'denied';
    }
  });

  if (!state.tradeLog) state.tradeLog = [];
  state.tradeLog.unshift({
    from: offer.from, to: offer.to, give: offer.give, want: offer.want, ts: Date.now()
  });

  await saveState({ collection: state.collection, pendingOffers: state.pendingOffers, tradeLog: state.tradeLog });
  showToast('Trade completed! 🎉','success');
  refreshAll();
};

// ============================================
// LEADERBOARD (simple team count + trade log)
// ============================================
function renderLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  if (!container) return;

  const sorted = [...PLAYERS].sort((a,b) => (state.collection[b.name]||[]).length - (state.collection[a.name]||[]).length);
  let html = sorted.map(p => `
    <div class="leaderboard-row">
      <span class="lb-name">${p.icon} ${p.name}</span>
      <span class="lb-count">${(state.collection[p.name]||[]).length}</span>
    </div>
  `).join('');

  if (state.tradeLog && state.tradeLog.length > 0) {
    html += `<div style="height:1px;background:var(--border);margin:24px 0;"></div>
      <h3 style="font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--teal);margin-bottom:12px;">🔁 Completed Trades</h3>`;
    state.tradeLog.forEach(t => {
      const giveNames = t.give.map(id => getTeam(id)?.name).join(', ');
      const wantNames = t.want.map(id => getTeam(id)?.name).join(', ');
      html += `<div class="offer-card"><div class="offer-from">${t.from} traded ${giveNames} to ${t.to} for ${wantNames}</div></div>`;
    });
  }

  container.innerHTML = html;
}

// ============================================
// TOAST
// ============================================
function showToast(msg, type='') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ============================================
// INIT
// ============================================
renderLoginButtons();
