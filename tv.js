// =====================================================
// TV LIVE - scoreboard real-time
// =====================================================

import {
    db,
    collection,
    doc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    getDoc
} from "./firebase-config.js";

const tvContainer = document.getElementById("tvContainer");

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

let currentMatch = null;
let team1Lineup  = null;
let team2Lineup  = null;

function lineupId(matchId, teamId) {
    return `${matchId}__${teamId}`;
}

function computeSeconds(match) {
    const base = match.elapsedSeconds || 0;
    if (match.status === "live" && match.startTime) {
        const start = match.startTime.toDate
            ? match.startTime.toDate()
            : new Date(match.startTime);
        const diff = Math.floor((Date.now() - start.getTime()) / 1000);
        return base + diff;
    }
    return base;
}

function render() {
    if (!currentMatch) {
        tvContainer.innerHTML = '<div class="empty-msg">NESSUNA PARTITA IN CORSO</div>';
        return;
    }

    const m = currentMatch;
    const seconds = computeSeconds(m);

    const renderTeam = (lineup, teamName) => {
        const players = (lineup?.players || [])
            .filter(p => p.role === "player")
            .sort((a, b) => (a.number || 0) - (b.number || 0) || (a.order || 0) - (b.order || 0));
        const staff = (lineup?.players || []).filter(p => p.role !== "player");

        let html = `<div class="box"><h3>${escapeHtml(teamName)}</h3>`;
        for (const p of players) {
            html += `
            <div class="player">
                <div class="number">${p.number ?? ""}</div>
                <div class="name">${escapeHtml(p.name)}</div>
            </div>`;
        }
        for (const s of staff) {
            html += `
            <div class="player">
                <div class="number">👤</div>
                <div class="name">${escapeHtml(s.name)} (${escapeHtml(s.role)})</div>
            </div>`;
        }
        html += `</div>`;
        return html;
    };

    const liveBadge = m.status === "live" ? "🔴 LIVE"
                   : m.status === "paused"   ? "⏸ PAUSA"
                   : m.status === "finished" ? "✅ FINITA" : "🕒 IN ATTESA";

    tvContainer.innerHTML = `
        <div class="scoreboard">
            <div class="teams">
                <div class="team">${escapeHtml(m.team1Name)}</div>
                <div class="score">${m.score1 || 0} - ${m.score2 || 0}</div>
                <div class="team">${escapeHtml(m.team2Name)}</div>
            </div>
            <div class="status">⏱ <span class="time">${formatTime(seconds)}</span> • ${liveBadge}</div>
        </div>

        <div class="lineups">
            ${renderTeam(team1Lineup, m.team1Name)}
            ${renderTeam(team2Lineup, m.team2Name)}
        </div>
    `;
}

setInterval(() => {
    if (currentMatch) render();
}, 1000);

const q = query(
    collection(db, "matches"),
    where("status", "in", ["live", "paused", "upcoming"]),
    orderBy("matchDate"),
    limit(1)
);

let unsubMatch = null;

onSnapshot(q, async (snap) => {
    if (snap.empty) {
        currentMatch = null;
        render();
        return;
    }

    const docSnap = snap.docs[0];
    currentMatch = { id: docSnap.id, ...docSnap.data() };

    const [l1, l2] = await Promise.all([
        getDoc(doc(db, "lineups", lineupId(currentMatch.id, currentMatch.team1Id))),
        getDoc(doc(db, "lineups", lineupId(currentMatch.id, currentMatch.team2Id)))
    ]);

    team1Lineup = l1.exists() ? l1.data() : null;
    team2Lineup = l2.exists() ? l2.data() : null;

    render();

    if (unsubMatch) unsubMatch();
    unsubMatch = onSnapshot(doc(db, "matches", currentMatch.id), (s) => {
        if (s.exists()) {
            currentMatch = { id: s.id, ...s.data() };
            render();
        }
    });
});
