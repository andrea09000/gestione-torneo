// =====================================================
// HOME - calendario partite raggruppate per giornata
// =====================================================

import {
    db,
    collection,
    query,
    orderBy,
    onSnapshot
} from "./firebase-config.js";

function statusBadge(status) {
    switch (status) {
        case "live":     return '<span class="badge live">LIVE</span>';
        case "paused":   return '<span class="badge paused">PAUSA</span>';
        case "finished": return '<span class="badge finished">FINITA</span>';
        default:         return '<span class="badge upcoming">ATTESA</span>';
    }
}

function liveMinute(match) {
    const base = match.elapsedSeconds || 0;
    let total = base;

    if (match.status === "live" && match.startTime) {
        const start = match.startTime.toDate
            ? match.startTime.toDate()
            : new Date(match.startTime);
        const diff = Math.floor((Date.now() - start.getTime()) / 1000);
        total = base + diff;
    }

    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function render(matches) {
    const container = document.getElementById("calendar");

    if (!matches.length) {
        container.innerHTML = '<div class="empty">Nessuna partita inserita</div>';
        return;
    }

    const byGiornata = {};
    for (const m of matches) {
        const g = m.giornata || 1;
        if (!byGiornata[g]) byGiornata[g] = [];
        byGiornata[g].push(m);
    }

    const giornate = Object.keys(byGiornata).sort((a, b) => Number(a) - Number(b));

    let html = "";
    for (const g of giornate) {
        html += `
        <div class="giornata-block">
            <div class="giornata-title">🏟 Giornata ${g}</div>
            <table class="match-table">
                <thead>
                    <tr>
                        <th>Partita</th>
                        <th>Risultato</th>
                        <th>Minuto</th>
                        <th>Stato</th>
                    </tr>
                </thead>
                <tbody>
                    ${byGiornata[g].map(m => `
                        <tr>
                            <td class="match-name">${m.team1Name} vs ${m.team2Name}</td>
                            <td class="match-score">${m.score1 || 0} - ${m.score2 || 0}</td>
                            <td>⏱ ${liveMinute(m)}</td>
                            <td>${statusBadge(m.status)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>`;
    }

    container.innerHTML = html;
}

let cachedMatches = [];

const q = query(
    collection(db, "matches"),
    orderBy("giornata"),
    orderBy("matchDate")
);

onSnapshot(
    q,
    (snap) => {
        cachedMatches = snap.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));

        render(cachedMatches);
    },
    (err) => {
        console.error("Errore Firestore:", err);
    }
);

setInterval(() => render(cachedMatches), 1000);
