// =====================================================
// DISTINTA - gestione lineup squadra
// =====================================================

import { requireRole } from "./auth.js";
import {
    db,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    query,
    where,
    orderBy
} from "./firebase-config.js";

const session = requireRole("squadra");
if (!session) throw new Error("not authorized");

const matchSelect   = document.getElementById("matchSelect");
const playersList   = document.getElementById("playersList");
const dirigenteIn   = document.getElementById("dirigente");
const accompIn      = document.getElementById("accompagnatore");
const guardiaIn     = document.getElementById("guardialinee");
const form          = document.getElementById("distintaForm");
const successAlert  = document.getElementById("successAlert");

const NUM_PLAYERS = 12;

function renderPlayerInputs(values = []) {
    let html = "";
    for (let i = 0; i < NUM_PLAYERS; i++) {
        const v = values[i] || "";
        html += `<input class="player-input" placeholder="Cognome e Nome giocatore" value="${escapeHtml(v)}">`;
    }
    playersList.innerHTML = html;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

async function loadMatches() {
    const teamId = session.teamId;
    if (!teamId) {
        matchSelect.innerHTML = '<option>Nessuna squadra associata</option>';
        return;
    }

    const matchesRef = collection(db, "matches");
    const snap = await getDocs(matchesRef);

    const myMatches = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(m =>
        (m.team1Id === teamId || m.team2Id === teamId) &&
        m.status === "upcoming"
    )
    .sort((a, b) => {
        const da = a.matchDate?.toMillis?.() || 0;
        const db_ = b.matchDate?.toMillis?.() || 0;
        return da - db_;
    });

    if (!myMatches.length) {
        matchSelect.innerHTML = '<option>Nessuna partita</option>';
        return;
    }

    matchSelect.innerHTML = myMatches
    .map(m => {
        const data = m.matchDate?.toDate?.();

        const ora = data
            ? data.toLocaleString("it-IT", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
              })
            : "";

        return `
            <option value="${m.id}">
                G${m.giornata} - ${ora} - ${escapeHtml(m.team1Name)} vs ${escapeHtml(m.team2Name)}
            </option>
        `;
    })
    .join("");

    matchSelect.addEventListener("change", loadLineup);
    await loadLineup();
}

function lineupId(matchId, teamId) {
    return `${matchId}__${teamId}`;
}

async function loadLineup() {
    const matchId = matchSelect.value;
    const teamId  = session.teamId;
    if (!matchId) return;

    renderPlayerInputs([]);
    dirigenteIn.value = "";
    accompIn.value    = "";
    guardiaIn.value   = "";

    const ref = doc(db, "lineups", lineupId(matchId, teamId));
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data();
    const players = (data.players || []).filter(p => p.role === "player").map(p => p.name);

    renderPlayerInputs(players);

    const staff = (data.players || []).filter(p => p.role !== "player");
    for (const s of staff) {
        if (s.role === "dirigente")      dirigenteIn.value = s.name;
        if (s.role === "accompagnatore") accompIn.value    = s.name;
        if (s.role === "guardialinee")   guardiaIn.value   = s.name;
    }
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const matchId = matchSelect.value;
    const teamId  = session.teamId;
    if (!matchId || !teamId) return;

    const inputs = playersList.querySelectorAll(".player-input");
    const players = [];

    inputs.forEach((inp, idx) => {
        const name = inp.value.trim();
        if (name) {
            players.push({ name, number: null, role: "player", order: idx });
        }
    });

    if (dirigenteIn.value.trim())
        players.push({ name: dirigenteIn.value.trim(), number: null, role: "dirigente" });
    if (accompIn.value.trim())
        players.push({ name: accompIn.value.trim(), number: null, role: "accompagnatore" });
    if (guardiaIn.value.trim())
        players.push({ name: guardiaIn.value.trim(), number: null, role: "guardialinee" });

    const ref = doc(db, "lineups", lineupId(matchId, teamId));
    await setDoc(ref, {
        matchId,
        teamId,
        players
    });

    successAlert.classList.add("show");
    setTimeout(() => successAlert.classList.remove("show"), 2500);
});

renderPlayerInputs([]);
loadMatches();
