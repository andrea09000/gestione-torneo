// =====================================================
// TELECOMANDO - lista partite per scegliere quale gestire
// =====================================================

import { requireRole } from "./auth.js";
import {
    db,
    collection,
    onSnapshot,
    orderBy,
    query
} from "./firebase-config.js";

const session = requireRole();
if (!session) throw new Error("not authorized");
if (session.role !== "campo" && session.role !== "admin") {
    document.body.innerHTML = '<div style="color:white;text-align:center;margin-top:80px">⛔ Accesso negato</div>';
    throw new Error("not authorized");
}

const list = document.getElementById("matchesList");

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function statusBadge(status) {
    switch (status) {
        case "live":     return '<span class="match-status live">LIVE</span>';
        case "paused":   return '<span class="match-status paused">PAUSA</span>';
        case "finished": return '<span class="match-status finished">FINITA</span>';
        default:         return '<span class="match-status upcoming">ATTESA</span>';
    }
}

const q = query(collection(db, "matches"), orderBy("matchDate"));

onSnapshot(q, (snap) => {
    if (snap.empty) {
        list.innerHTML = '<div style="text-align:center;opacity:0.7;margin-top:40px">Nessuna partita</div>';
        return;
    }

    list.innerHTML = snap.docs.map(d => {
        const m = d.data();
        return `
        <a class="match-card" href="telecomando-match.html?id=${d.id}">
            <div class="match-info">${escapeHtml(m.team1Name)} vs ${escapeHtml(m.team2Name)}</div>
            ${statusBadge(m.status)}
        </a>`;
    }).join("");
});
