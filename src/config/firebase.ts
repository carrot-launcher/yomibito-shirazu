import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// ★ Firebase Console からコピーして置き換えてください
const firebaseConfig = {
  apiKey: "AIzaSyDgkHl-ypOEwZjMjdp0Ny5qxn1CApB8SA8",
  authDomain: "yomibito-shirazu-9e7fe.firebaseapp.com",
  projectId: "yomibito-shirazu-9e7fe",
  storageBucket: "yomibito-shirazu-9e7fe.firebasestorage.app",
  messagingSenderId: "295815869327",
  appId: "1:295815869327:web:882f1219cdc081ea6851fa",
  measurementId: "G-RX7FV4PKZ0"
};

// ★ Google Cloud Console の OAuth 2.0 Web Client ID
export const WEB_CLIENT_ID = "295815869327-q3ebjdo3ulaaiiker2s2og0m2kkldt9o.apps.googleusercontent.com";

const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
export const db = getFirestore(app);
export const functions = getFunctions(app, 'asia-northeast1');
