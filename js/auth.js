// =====================================================
// AUTH HELPERS (sessione semplice via localStorage)
// =====================================================

import {
    db,
    collection,
    query,
    where,
    getDocs
} from "./firebase-config.js";

const SESSION_KEY = "torneo_session";

export function getSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

export async function loginUser(username, password) {
    const usersRef = collection(db, "users");
    const q = query(
        usersRef,
        where("username", "==", username),
        where("password", "==", password)
    );

    const snap = await getDocs(q);

    if (snap.empty) return null;

    const docSnap = snap.docs[0];
    const data = docSnap.data();

    const user = {
        id: docSnap.id,
        username: data.username,
        role: data.role,
        teamId: data.teamId || null
    };

    setSession(user);
    return user;
}

export function logout() {
    clearSession();
    window.location.href = "login.html";
}

export function requireRole(role) {
    const s = getSession();

    if (!s) {
        window.location.href = "login.html";
        return null;
    }

    if (role && s.role !== role) {
        document.body.innerHTML =
            '<div style="color:white;text-align:center;margin-top:80px;font-size:22px">⛔ Accesso negato</div>';
        return null;
    }

    return s;
}
