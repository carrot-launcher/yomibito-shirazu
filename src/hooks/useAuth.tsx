import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { auth, db } from '../config/firebase';

async function registerForPushNotifications(uid: string) {
  try {
    // Android通知チャネル設定
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('new-tanka', {
        name: '新しい歌',
        importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.setNotificationChannelAsync('reactions', {
        name: 'リアクション',
        importance: Notifications.AndroidImportance.LOW,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.setNotificationChannelAsync('comments', {
        name: '評',
        importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.setNotificationChannelAsync('judgments', {
        name: '裁き',
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.setNotificationChannelAsync('other', {
        name: 'その他',
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }

    const { status } = await Notifications.getPermissionsAsync();
    let finalStatus = status;
    if (status !== 'granted') {
      const { status: newStatus } = await Notifications.requestPermissionsAsync();
      finalStatus = newStatus;
    }
    if (finalStatus !== 'granted') return;

    const token = await Notifications.getDevicePushTokenAsync();
    await updateDoc(doc(db, 'users', uid), { fcmToken: token.data });
  } catch {}
}

function generateUserCode(): string {
  // 6桁の数字コード（Discord風）
  return String(Math.floor(100000 + Math.random() * 900000));
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  userCode: string;
  onboardingDone: boolean;
  setOnboardingDone: (done: boolean) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, userCode: '', onboardingDone: true, setOnboardingDone: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userCode, setUserCode] = useState('');
  const [onboardingDone, setOnboardingDoneState] = useState(true);

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
          setOnboardingDoneState(false);
        } else {
          const data = userSnap.data();
          if (!data.userCode) {
            const code = generateUserCode();
            await setDoc(userRef, { userCode: code }, { merge: true });
            setUserCode(code);
          } else {
            setUserCode(data.userCode);
          }
          setOnboardingDoneState(data.onboardingDone ?? true);
        }
      } else {
        setUserCode('');
      }
      if (!firebaseUser) setOnboardingDoneState(true);
      setUser(firebaseUser);
      setLoading(false);

      // FCMトークン登録 + 通知チャネル設定
      if (firebaseUser && Device.isDevice) {
        registerForPushNotifications(firebaseUser.uid);
      }
    });
    return unsubscribe;
  }, []);

  const setOnboardingDone = async (done: boolean) => {
    setOnboardingDoneState(done);
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), { onboardingDone: done }).catch(() => {});
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, userCode, onboardingDone, setOnboardingDone }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
