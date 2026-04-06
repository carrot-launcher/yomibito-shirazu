import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

function generateUserCode(): string {
  // 6桁の数字コード（Discord風）
  return String(Math.floor(100000 + Math.random() * 900000));
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  userCode: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, userCode: '',
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userCode, setUserCode] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          const code = generateUserCode();
          await setDoc(userRef, {
            userCode: code,
            fcmToken: '',
            joinedGroups: [],
            notificationSettings: { newPost: true, reaction: true, comment: true },
            createdAt: serverTimestamp(),
          });
          setUserCode(code);
        } else {
          const data = userSnap.data();
          // 既存ユーザーで userCode がなければ生成
          if (!data.userCode) {
            const code = generateUserCode();
            await setDoc(userRef, { userCode: code }, { merge: true });
            setUserCode(code);
          } else {
            setUserCode(data.userCode);
          }
        }
      } else {
        setUserCode('');
      }
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, userCode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
