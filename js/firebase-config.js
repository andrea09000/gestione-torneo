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
    apiKey: "AIzaSyCtNYAa7WlQjWCn-1Mr73w82H_PUhSbnXY",
    authDomain: "gestionetorneo-f0984.firebaseapp.com",
    projectId: "gestionetorneo-f0984",
    storageBucket: "gestionetorneo-f0984.firebasestorage.app",
    messagingSenderId: "654451650463",
    appId: "1:654451650463:web:37ad22bb60704ef60397aa",
    measurementId: "G-M4ZHTS6WQE"
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
