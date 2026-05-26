# ⚽ Torneo Agnosine - Versione Statica (HTML + JS + Firebase)

App di gestione torneo calcistico **interamente client-side**: solo HTML, CSS e JavaScript. Nessun server, nessun Python. Database: **Firebase Firestore**.

## 📁 Struttura

```
.
├── index.html              # 🏠 Calendario partite (pubblico)
├── login.html              # 🔑 Login
├── distinta.html           # 📋 Distinta squadra (ruolo: squadra)
├── commissario.html        # 🧑‍⚖️ Modifica giocatori (ruolo: commissario)
├── tv.html                 # 📺 Scoreboard live (pubblico)
├── telecomando.html        # 🎮 Lista partite (ruolo: campo / admin)
├── telecomando-match.html  # 🕹 Telecomando partita
├── admin.html              # ⚙️ Pannello admin (ruolo: admin)
├── css/
│   └── style.css
└── js/
    ├── firebase-config.js  # <-- DA CONFIGURARE
    ├── auth.js
    ├── navbar.js
    ├── home.js
    ├── login.js
    ├── distinta.js
    ├── commissario.js
    ├── tv.js
    ├── telecomando.js
    ├── telecomando-match.js
    └── admin.js
```

---

## 🚀 Setup Firebase (5 minuti)

### 1. Crea progetto Firebase

1. Vai su [console.firebase.google.com](https://console.firebase.google.com/)
2. Clicca **"Aggiungi progetto"** → segui la procedura
3. Nel progetto → **Build → Firestore Database** → **Crea database**
   - Scegli "**Avvia in modalità test**" (per ora)
   - Seleziona la regione (es. `europe-west`)

### 2. Crea l'app web

1. Nella home del progetto clicca l'icona **`</>`** (Web)
2. Dai un nome (es. "Torneo")
3. **NON** spuntare hosting (opzionale)
4. Copia l'oggetto `firebaseConfig`

### 3. Configura il progetto

Apri `js/firebase-config.js` e sostituisci l'oggetto `firebaseConfig` con quello copiato:

```js
const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "tuoprogetto.firebaseapp.com",
    projectId: "tuoprogetto",
    storageBucket: "tuoprogetto.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abc123"
};
```

### 4. Crea il primo utente admin

Nella console Firebase → **Firestore Database** → **Inizia raccolta**:

- Nome raccolta: `users`
- Aggiungi un documento (ID automatico) con i campi:
  - `username` (string) → `admin`
  - `password` (string) → `admin123`
  - `role` (string) → `admin`
  - `teamId` (string) → lascia vuoto

> ⚠️ Le password sono in chiaro per semplicità (come nell'app originale). Se metti il sito in produzione, usa **Firebase Authentication** vero (vedi sezione opzionale in fondo).

### 5. Avvia l'app

Apri `index.html` con un server locale (NON aprire `file://` direttamente perché i moduli ES6 non funzionano):

**Opzione A** – Python:
```bash
python3 -m http.server 8080
```

**Opzione B** – Node:
```bash
npx serve .
```

**Opzione C** – VSCode: estensione "Live Server"

Poi vai su `http://localhost:8080`.

---

## 📊 Schema dati Firestore

### `teams` (collezione)
```js
{ name: "Juventus" }
```

### `users` (collezione)
```js
{
    username: "mister1",
    password: "passwordinChiaro",
    role: "squadra" | "commissario" | "campo" | "admin",
    teamId: "<id squadra>" // solo per role="squadra"
}
```

### `matches` (collezione)
```js
{
    team1Id: "...", team1Name: "Juventus",
    team2Id: "...", team2Name: "Milan",
    score1: 0, score2: 0,
    status: "upcoming" | "live" | "paused" | "finished",
    matchDate: Timestamp,
    giornata: 1,
    elapsedSeconds: 0,
    startTime: Timestamp | null
}
```

### `lineups` (collezione, ID = `{matchId}__{teamId}`)
```js
{
    matchId: "...",
    teamId: "...",
    players: [
        { name: "Rossi Mario", number: 10, role: "player", order: 0 },
        { name: "Bianchi",     number: null, role: "dirigente" }
    ]
}
```

---

## 🔐 Regole di sicurezza Firestore (consigliate)

Per ora, in modalità test, Firestore consente accesso libero. Quando l'app è pronta, vai su **Firestore → Regole** e incolla:

```
rules_version = '2';
service cloud.firestore {
    match /databases/{database}/documents {

        // Lettura libera per scoreboard pubblico
        match /matches/{id}      { allow read: if true; allow write: if true; }
        match /teams/{id}        { allow read: if true; allow write: if true; }
        match /lineups/{id}      { allow read: if true; allow write: if true; }

        // ⚠️ Gli utenti sono leggibili (perché facciamo login lato client).
        // In produzione passa a Firebase Auth.
        match /users/{id}        { allow read: if true; allow write: if true; }
    }
}
```

> 📝 Queste regole sono **PERMISSIVE**. Vanno bene per uso interno/torneo amatoriale. Per produzione vera vedi sotto.

---

## ▶️ Flusso utilizzo

1. **Admin** → `login.html` con utente admin → crea **squadre**, **utenti** (squadra/commissario/campo) e **partite**
2. Ogni **squadra** fa login → `distinta.html` → compila distinta giocatori e staff
3. Il **commissario** fa login → `commissario.html` → seleziona partita, modifica nomi e assegna numeri di maglia
4. L'**addetto campo** fa login → `telecomando.html` → seleziona partita → gestisce timer e gol
5. Su un secondo dispositivo apri `tv.html` come **scoreboard pubblico** (si aggiorna in real-time)

---

## ✨ Differenze rispetto alla versione Flask

- ✅ **Real-time**: niente più `setInterval(reload, 3000)`. Tutto si aggiorna istantaneamente con `onSnapshot` di Firestore.
- ✅ **Zero server da gestire**: solo file statici.
- ✅ **Funziona offline su Firebase Hosting** (se configuri persistence).
- ⚠️ Le password restano in chiaro: stesso comportamento del codice originale.

---

## 🔒 (Opzionale) Migrare a Firebase Authentication

Per avere password hashate gestite da Google:

1. Abilita **Authentication → Sign-in method → Email/Password**
2. Modifica `js/auth.js` per usare `signInWithEmailAndPassword`
3. Crea i `users` con email invece di username, e mantieni in Firestore solo `{ role, teamId }` indicizzati per UID

(Non incluso di default per restare 1:1 con l'app originale.)
