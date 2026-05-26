// =====================================================
// CONFIG FIREBASE
// Sostituisci con i dati del TUO progetto Firebase.
// Console: https://console.firebase.google.com/
// =====================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    serverTimestamp,
    Timestamp,
    increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "REPLACE_WITH_YOUR_API_KEY",
    authDomain: "REPLACE.firebaseapp.com",
    projectId: "REPLACE_PROJECT_ID",
    storageBucket: "REPLACE.appspot.com",
    messagingSenderId: "REPLACE",
    appId: "REPLACE"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export {
    db,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    serverTimestamp,
    Timestamp,
    increment
};
