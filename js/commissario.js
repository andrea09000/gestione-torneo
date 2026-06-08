// =====================================================
// COMMISSARIO - modifica nomi/numeri giocatori
// =====================================================

import { requireRole } from "./auth.js";
import {
    db,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc
} from "./firebase-config.js";

const session = requireRole("commissario");
if (!session) throw new Error("not authorized");

const matchSelect = document.getElementById("matchSelect");
const loadBtn     = document.getElementById("loadBtn");
const saveBtn     = document.getElementById("saveBtn");
const teamsArea   = document.getElementById("teamsArea");
const team1Box    = document.getElementById("team1Box");
const team2Box    = document.getElementById("team2Box");

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function lineupId(matchId, teamId) {
    return `${matchId}__${teamId}`;
}

let team1LineupData = null;
let team2LineupData = null;
let currentMatch = null;

async function loadMatches() {
    const snap = await getDocs(collection(db, "matches"));
    const matches = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
            const da = a.matchDate?.toMillis?.() || 0;
            const db_ = b.matchDate?.toMillis?.() || 0;
            return da - db_;
        });

    matchSelect.innerHTML = matches
        .map(m => `<option value="${m.id}">${escapeHtml(m.team1Name)} vs ${escapeHtml(m.team2Name)}</option>`)
        .join("");
}

function renderTeam(box, lineupData, teamLabel, sideColor) {

    const players = (lineupData?.players || [])
        .filter(p => p.role === "player")
        .sort((a, b) =>
            (a.number || 0) - (b.number || 0) ||
            (a.order || 0) - (b.order || 0)
        );

    const staff = (lineupData?.players || [])
        .filter(p => p.role !== "player");

    let html = `
        <div class="team-header">
            ${sideColor} ${escapeHtml(teamLabel)}
        </div>
    `;

    html += `<div class="players-container">`;

    players.forEach((p, idx) => {
        html += `
            <div class="player-row" data-idx="${idx}">
                <input
                    class="input-name"
                    value="${escapeHtml(p.name)}"
                    placeholder="Nome giocatore">

                <input
                    class="input-number"
                    type="number"
                    value="${p.number ?? ""}"
                    placeholder="N°">

                <button
                    class="btn-remove-player"
                    data-player="${idx}">
                    ❌
                </button>
            </div>
        `;
    });

    html += `</div>`;

    html += `
        <button class="btn-add-player">
            ➕ Aggiungi giocatore
        </button>
    `;

    html += `
        <div class="staff-box">
            <div class="staff-title">
                🧑‍💼 Staff
            </div>
    `;

    staff.forEach((s, idx) => {

        html += `
            <div class="staff-row" data-staff="${idx}">

                <input
                    class="staff-role-input"
                    value="${escapeHtml(s.role)}"
                    placeholder="Ruolo">

                <input
                    class="input-name"
                    value="${escapeHtml(s.name)}"
                    placeholder="Nome">

                <button
                    class="btn-remove-staff"
                    data-staff="${idx}">
                    ❌
                </button>

            </div>
        `;
    });

    html += `
        <button class="btn-add-staff">
            ➕ Aggiungi dirigente
        </button>
    `;

    html += `</div>`;

    box.innerHTML = html;

    // ======================
    // AGGIUNGI GIOCATORE
    // ======================

    box.querySelector(".btn-add-player")
        ?.addEventListener("click", () => {

            lineupData.players.push({
                role: "player",
                name: "",
                number: null,
                order: Date.now()
            });

            renderTeam(
                box,
                lineupData,
                teamLabel,
                sideColor
            );
        });

    // ======================
    // AGGIUNGI STAFF
    // ======================

    box.querySelector(".btn-add-staff")
        ?.addEventListener("click", () => {

            lineupData.players.push({
                role: "dirigente",
                name: ""
            });

            renderTeam(
                box,
                lineupData,
                teamLabel,
                sideColor
            );
        });

    // ======================
    // ELIMINA GIOCATORE
    // ======================

    box.querySelectorAll(".btn-remove-player")
        .forEach(btn => {

            btn.addEventListener("click", () => {

                const index =
                    Number(btn.dataset.player);

                const playerList =
                    lineupData.players
                        .filter(p => p.role === "player");

                const playerToRemove =
                    playerList[index];

                const realIndex =
                    lineupData.players.indexOf(playerToRemove);

                if (realIndex >= 0) {
                    lineupData.players.splice(realIndex, 1);
                }

                renderTeam(
                    box,
                    lineupData,
                    teamLabel,
                    sideColor
                );
            });
        });

    // ======================
    // ELIMINA STAFF
    // ======================

    box.querySelectorAll(".btn-remove-staff")
        .forEach(btn => {

            btn.addEventListener("click", () => {

                const index =
                    Number(btn.dataset.staff);

                const staffList =
                    lineupData.players
                        .filter(p => p.role !== "player");

                const staffToRemove =
                    staffList[index];

                const realIndex =
                    lineupData.players.indexOf(staffToRemove);

                if (realIndex >= 0) {
                    lineupData.players.splice(realIndex, 1);
                }

                renderTeam(
                    box,
                    lineupData,
                    teamLabel,
                    sideColor
                );
            });
        });
}

async function loadLineupsForMatch(matchId) {
    const matchSnap = await getDoc(doc(db, "matches", matchId));
    if (!matchSnap.exists()) return;
    currentMatch = { id: matchId, ...matchSnap.data() };

    const ref1 = doc(db, "lineups", lineupId(matchId, currentMatch.team1Id));
    const ref2 = doc(db, "lineups", lineupId(matchId, currentMatch.team2Id));

    const [snap1, snap2] = await Promise.all([getDoc(ref1), getDoc(ref2)]);

    team1LineupData = snap1.exists() ? snap1.data() : { matchId, teamId: currentMatch.team1Id, players: [] };
    team2LineupData = snap2.exists() ? snap2.data() : { matchId, teamId: currentMatch.team2Id, players: [] };

    renderTeam(team1Box, team1LineupData, currentMatch.team1Name, "🔵");
    renderTeam(team2Box, team2LineupData, currentMatch.team2Name, "🔴");

    teamsArea.style.display = "block";
}

function readUpdatedLineup(box, lineupData) {

    const result = [];

    // ======================
    // GIOCATORI
    // ======================

    const playerRows =
        box.querySelectorAll(".player-row");

    playerRows.forEach((row, idx) => {

        const name =
            row.querySelector(".input-name")
                .value
                .trim();

        const numberRaw =
            row.querySelector(".input-number")
                .value;

        const number =
            numberRaw === ""
                ? null
                : Number(numberRaw);

        if (!name) return;

        result.push({
            role: "player",
            name,
            number,
            order: idx
        });
    });

    // ======================
    // STAFF
    // ======================

    const staffRows =
        box.querySelectorAll(".staff-row");

    staffRows.forEach(row => {

        const role =
            row.querySelector(".staff-role-input")
                .value
                .trim() || "dirigente";

        const name =
            row.querySelector(".input-name")
                .value
                .trim();

        if (!name) return;

        result.push({
            role,
            name
        });
    });

    return result;
}

loadBtn.addEventListener("click", () => {
    const matchId = matchSelect.value;
    if (matchId) loadLineupsForMatch(matchId);
});

saveBtn.addEventListener("click", async () => {
    if (!currentMatch) return;

    team1LineupData.players = readUpdatedLineup(team1Box, team1LineupData);
    team2LineupData.players = readUpdatedLineup(team2Box, team2LineupData);

    await Promise.all([
        setDoc(doc(db, "lineups", lineupId(currentMatch.id, currentMatch.team1Id)), team1LineupData),
        setDoc(doc(db, "lineups", lineupId(currentMatch.id, currentMatch.team2Id)), team2LineupData)
    ]);

    saveBtn.textContent = "✅ Salvato!";
    setTimeout(() => saveBtn.textContent = "💾 Salva modifiche", 2000);
});

loadMatches();
