// =====================================================
// ADMIN PANEL - crea squadre/utenti/partite
// =====================================================

import { requireRole } from "./auth.js";
import {
    db,
    collection,
    doc,
    addDoc,
    deleteDoc,
    onSnapshot,
    orderBy,
    query,
    Timestamp
} from "./firebase-config.js";

const session = requireRole("admin");
if (!session) throw new Error("not authorized");

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

const teamNameInp     = document.getElementById("teamName");
const addTeamBtn      = document.getElementById("addTeamBtn");
const teamsList       = document.getElementById("teamsList");

const userUsername    = document.getElementById("userUsername");
const userPassword    = document.getElementById("userPassword");
const userRole        = document.getElementById("userRole");
const userTeam        = document.getElementById("userTeam");
const addUserBtn      = document.getElementById("addUserBtn");
const usersList       = document.getElementById("usersList");

const matchTeam1      = document.getElementById("matchTeam1");
const matchTeam2      = document.getElementById("matchTeam2");
const matchDate       = document.getElementById("matchDate");
const matchGiornata   = document.getElementById("matchGiornata");
const addMatchBtn     = document.getElementById("addMatchBtn");
const matchesTable    = document.getElementById("matchesTable");

let teamsCache = [];

addTeamBtn.addEventListener("click", async () => {
    const name = teamNameInp.value.trim();
    if (!name) return;
    await addDoc(collection(db, "teams"), { name });
    teamNameInp.value = "";
});

addUserBtn.addEventListener("click", async () => {
    const username = userUsername.value.trim();
    const password = userPassword.value;
    const role     = userRole.value;
    const teamId   = userTeam.value || null;

    if (!username || !password) return;

    await addDoc(collection(db, "users"), { username, password, role, teamId });
    userUsername.value = "";
    userPassword.value = "";
});

addMatchBtn.addEventListener("click", async () => {
    const t1 = matchTeam1.value;
    const t2 = matchTeam2.value;
    const dateStr = matchDate.value;
    const giornata = Number(matchGiornata.value) || 1;

    if (!t1 || !t2) return;
    if (t1 === t2) {
        alert("Le squadre devono essere diverse");
        return;
    }

    const team1 = teamsCache.find(t => t.id === t1);
    const team2 = teamsCache.find(t => t.id === t2);

    await addDoc(collection(db, "matches"), {
        team1Id: t1,
        team2Id: t2,
        team1Name: team1?.name || "",
        team2Name: team2?.name || "",
        score1: 0,
        score2: 0,
        status: "upcoming",
        matchDate: dateStr ? Timestamp.fromDate(new Date(dateStr)) : Timestamp.now(),
        giornata,
        elapsedSeconds: 0,
        startTime: null
    });

    matchDate.value = "";
    matchGiornata.value = "";
});

onSnapshot(collection(db, "teams"), (snap) => {
    teamsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    teamsList.innerHTML = teamsCache.map(t => `
        <li>
            <span>${escapeHtml(t.name)}</span>
            <button class="btn btn-danger" data-del-team="${t.id}">🗑</button>
        </li>
    `).join("");

    const opts = ['<option value="">-- Nessuna squadra --</option>',
                  ...teamsCache.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)];
    userTeam.innerHTML = opts.join("");

    const opts2 = teamsCache.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
    matchTeam1.innerHTML = opts2;
    matchTeam2.innerHTML = opts2;

    teamsList.querySelectorAll("[data-del-team]").forEach(btn => {
        btn.addEventListener("click", () =>
            deleteDoc(doc(db, "teams", btn.dataset.delTeam))
        );
    });
});

onSnapshot(collection(db, "users"), (snap) => {
    usersList.innerHTML = snap.docs.map(d => {
        const u = d.data();
        return `
        <li>
            <span>${escapeHtml(u.username)} - <em>${escapeHtml(u.role)}</em></span>
            <button class="btn btn-danger" data-del-user="${d.id}">🗑</button>
        </li>`;
    }).join("");

    usersList.querySelectorAll("[data-del-user]").forEach(btn => {
        btn.addEventListener("click", () =>
            deleteDoc(doc(db, "users", btn.dataset.delUser))
        );
    });
});

onSnapshot(query(collection(db, "matches"), orderBy("giornata")), (snap) => {
    matchesTable.innerHTML = snap.docs.map(d => {
        const m = d.data();
        return `
        <tr>
            <td>${escapeHtml(m.team1Name)} vs ${escapeHtml(m.team2Name)}</td>
            <td>${m.giornata ?? "-"}</td>
            <td>${escapeHtml(m.status)}</td>
            <td><button class="btn btn-danger" data-del-match="${d.id}">🗑</button></td>
        </tr>`;
    }).join("");

    matchesTable.querySelectorAll("[data-del-match]").forEach(btn => {
        btn.addEventListener("click", () =>
            deleteDoc(doc(db, "matches", btn.dataset.delMatch))
        );
    });
});
