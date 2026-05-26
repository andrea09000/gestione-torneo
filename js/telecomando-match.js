// =====================================================
// TELECOMANDO PARTITA - timer/gol con sync real-time
// =====================================================

import { requireRole } from "./auth.js";
import {
    db,
    collection,
    doc,
    getDocs,
    updateDoc,
    onSnapshot,
    serverTimestamp,
    Timestamp,
    increment,
    query,
    orderBy
} from "./firebase-config.js";

const session = requireRole();
if (!session) throw new Error("not authorized");
if (session.role !== "campo" && session.role !== "admin") {
    document.body.innerHTML = '<div style="color:white;text-align:center;margin-top:80px">⛔ Accesso negato</div>';
    throw new Error("not authorized");
}

const root = document.getElementById("root");

const urlParams = new URLSearchParams(window.location.search);
const matchId = urlParams.get("id");
if (!matchId) {
    root.innerHTML = '<h3 style="text-align:center;margin-top:100px">Partita non specificata</h3>';
    throw new Error("missing id");
}

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function computeSeconds(m) {
    const base = m.elapsedSeconds || 0;
    if (m.status === "live" && m.startTime) {
        const start = m.startTime.toDate
            ? m.startTime.toDate()
            : new Date(m.startTime);
        const diff = Math.floor((Date.now() - start.getTime()) / 1000);
        return base + diff;
    }
    return base;
}

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

let currentMatch = null;
let nextMatchId  = null;

async function loadNextMatchId() {
    const snap = await getDocs(query(collection(db, "matches"), orderBy("matchDate")));
    const ids = snap.docs.map(d => d.id);
    const idx = ids.indexOf(matchId);
    nextMatchId = (idx >= 0 && idx < ids.length - 1) ? ids[idx + 1] : null;
}

function render() {
    if (!currentMatch) {
        root.innerHTML = '<h3 style="text-align:center;margin-top:100px">Partita non trovata</h3>';
        return;
    }

    const m = currentMatch;
    const seconds = computeSeconds(m);

    const nextBtn = nextMatchId
        ? `<a href="telecomando-match.html?id=${nextMatchId}" class="btn-next">⏭ PARTITA SUCCESSIVA</a>`
        : "";

    root.innerHTML = `
        <div class="match-card">
            <div class="match-title">${escapeHtml(m.team1Name)} vs ${escapeHtml(m.team2Name)}</div>
            <div class="score">${m.score1 || 0} - ${m.score2 || 0}</div>
            <div class="timer">⏱ <span id="timeDisplay">${formatTime(seconds)}</span> (${m.status})</div>
        </div>

        <div class="section">
            <h4>⏱ Timer</h4>
            <div class="grid">
                <button class="btn start"  data-action="start">▶ START</button>
                <button class="btn stop"   data-action="stop">⏸ STOP</button>
                <button class="btn reset"  data-action="reset">🔄 RESET</button>
            </div>
        </div>

        <div class="section">
            <h4>🏠 Casa</h4>
            <div class="grid">
                <button class="btn home"  data-action="goal1">⚽ +1 GOL</button>
                <button class="btn minus" data-action="goal1_minus">❌ -1 GOL</button>
            </div>
        </div>

        <div class="section">
            <h4>✈️ Ospite</h4>
            <div class="grid">
                <button class="btn away"  data-action="goal2">⚽ +1 GOL</button>
                <button class="btn minus" data-action="goal2_minus">❌ -1 GOL</button>
            </div>
        </div>

        <button class="btn finish" data-action="finish">⏭ FINE PARTITA</button>

        ${nextBtn}
    `;

    root.querySelectorAll("button[data-action]").forEach(btn => {
        btn.addEventListener("click", () => handleAction(btn.dataset.action));
    });
}

async function handleAction(action) {
    if (!currentMatch) return;
    const ref = doc(db, "matches", matchId);

    if (action === "start") {
        await updateDoc(ref, {
            status: "live",
            startTime: Timestamp.now()
        });
    } else if (action === "stop") {
        const seconds = computeSeconds(currentMatch);
        await updateDoc(ref, {
            elapsedSeconds: seconds,
            startTime: null,
            status: "paused"
        });
    } else if (action === "reset") {
        await updateDoc(ref, {
            elapsedSeconds: 0,
            startTime: null,
            status: "upcoming"
        });
    } else if (action === "finish") {
        const seconds = computeSeconds(currentMatch);
        await updateDoc(ref, {
            status: "finished",
            startTime: null,
            elapsedSeconds: seconds
        });
    } else if (action === "goal1") {
        await updateDoc(ref, { score1: increment(1) });
    } else if (action === "goal2") {
        await updateDoc(ref, { score2: increment(1) });
    } else if (action === "goal1_minus") {
        const newVal = Math.max(0, (currentMatch.score1 || 0) - 1);
        await updateDoc(ref, { score1: newVal });
    } else if (action === "goal2_minus") {
        const newVal = Math.max(0, (currentMatch.score2 || 0) - 1);
        await updateDoc(ref, { score2: newVal });
    }
}

setInterval(() => {
    if (!currentMatch) return;
    const el = document.getElementById("timeDisplay");
    if (el) el.textContent = formatTime(computeSeconds(currentMatch));
}, 1000);

onSnapshot(doc(db, "matches", matchId), (snap) => {
    if (!snap.exists()) {
        currentMatch = null;
        render();
        return;
    }
    currentMatch = { id: snap.id, ...snap.data() };
    render();
});

loadNextMatchId();
