// =====================================================
// NAVBAR: inietta header/footer condivisi in ogni pagina
// =====================================================

import { getSession, logout } from "./auth.js";

export function renderNavbar() {
    const session = getSession();

    const loginLink = session
        ? `<a class="nav-link" href="#" id="logoutBtn">🚪 Logout (${session.username})</a>`
        : `<a class="nav-link" href="login.html">🔑 Login</a>`;

    const adminLink = session && session.role === "admin"
        ? `<li><a class="nav-link" href="admin.html">⚙️ Admin</a></li>` : "";

    const html = `
    <nav class="navbar-custom">
        <a class="navbar-brand" href="index.html">⚽ Torneo Agnosine</a>
        <button class="nav-toggler" id="navToggler">☰</button>
        <ul class="nav-links" id="navLinks">
            <li><a class="nav-link" href="index.html">🏠 Home</a></li>
            <li><a class="nav-link" href="tv.html">📺 LIVE</a></li>
            <li><a class="nav-link" href="distinta.html">📋 Distinta</a></li>
            ${adminLink}
            <li>${loginLink}</li>
        </ul>
    </nav>

    <div class="bottom-nav">
        <a href="index.html" class="bottom-link"><div>🏠</div>Home</a>
        <a href="distinta.html" class="bottom-link"><div>📋</div>Distinta</a>
        <a href="tv.html" class="bottom-link"><div>🔴</div>Live</a>
    </div>
    `;

    const mount = document.getElementById("navbar-mount");
    if (mount) mount.innerHTML = html;

    const toggler = document.getElementById("navToggler");
    const links = document.getElementById("navLinks");

    if (toggler && links) {
        toggler.addEventListener("click", () => links.classList.toggle("open"));
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", (e) => {
            e.preventDefault();
            logout();
        });
    }
}

document.addEventListener("DOMContentLoaded", renderNavbar);
