// Firebase client configuration & initialization
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC2366CHQdrTehbt3PfgnQJE7HEiCM5G6E",
  authDomain: "zenzy-b1ac0.firebaseapp.com",
  projectId: "zenzy-b1ac0",
  storageBucket: "zenzy-b1ac0.firebasestorage.app",
  messagingSenderId: "47905404174",
  appId: "1:47905404174:web:2edb57fdc42213b769d35f",
  measurementId: "G-SNLNE6VFFZ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
