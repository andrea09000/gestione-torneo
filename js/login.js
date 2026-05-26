// =====================================================
// LOGIN
// =====================================================

import { loginUser } from "./auth.js";

const form = document.getElementById("loginForm");
const errorBox = document.getElementById("error");

function redirectByRole(role) {
    switch (role) {
        case "squadra":     window.location.href = "distinta.html"; break;
        case "commissario": window.location.href = "commissario.html"; break;
        case "campo":       window.location.href = "telecomando.html"; break;
        case "admin":       window.location.href = "admin.html"; break;
        default:            window.location.href = "index.html";
    }
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.style.display = "none";

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    try {
        const user = await loginUser(username, password);

        if (!user) {
            errorBox.textContent = "Credenziali non valide";
            errorBox.style.display = "block";
            return;
        }

        redirectByRole(user.role);
    } catch (err) {
        console.error(err);
        errorBox.textContent = "Errore: " + err.message;
        errorBox.style.display = "block";
    }
});
