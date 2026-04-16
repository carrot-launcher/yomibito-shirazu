import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
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
      await Notifications.setNotificationChannelAsync('other', {
        name: 'その他',
        importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }

    const perm = await Notifications.getPermissionsAsync() as any;
    let finalStatus = perm.status;
    if (finalStatus !== 'granted') {
      const newPerm = await Notifications.requestPermissionsAsync() as any;
      finalStatus = newPerm.status;
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
  myAuthorHandle: string;
  blockedHandles: Record<string, { blockedAt: any; sampleBody?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, userCode: '', onboardingDone: true, setOnboardingDone: () => {},
  myAuthorHandle: '', blockedHandles: {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userCode, setUserCode] = useState('');
  const [onboardingDone, setOnboardingDoneState] = useState(true);
  const [myAuthorHandle, setMyAuthorHandle] = useState('');
  const [blockedHandles, setBlockedHandles] = useState<Record<string, { blockedAt: any; sampleBody?: string }>>({});

  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // 切替時にユーザードキュメント購読を停止
      unsubUserDoc?.();
      unsubUserDoc = null;

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
            // LoginScreen のチェックボックスで同意した時点で作成されるので、同時に記録
            termsAcceptedAt: serverTimestamp(),
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

        // blockedHandles をリアルタイム購読
        unsubUserDoc = onSnapshot(userRef, (snap) => {
          const data = snap.data();
          setBlockedHandles((data?.blockedHandles as Record<string, { blockedAt: any; sampleBody?: string }>) || {});
        });

        // 自分の authorHandle を取得（キャッシュ）
        try {
          const fns = getFunctions(undefined, 'asia-northeast1');
          const res = await httpsCallable(fns, 'getMyAuthorHandle')({});
          const handle = (res.data as any)?.handle as string;
          if (handle) setMyAuthorHandle(handle);
        } catch {
          // 取得失敗時は空のまま（フィルタが効かないだけで致命的ではない）
        }
      } else {
        setUserCode('');
        setMyAuthorHandle('');
        setBlockedHandles({});
      }
      if (!firebaseUser) setOnboardingDoneState(true);
      setUser(firebaseUser);
      setLoading(false);

      // FCMトークン登録 + 通知チャネル設定
      if (firebaseUser && Device.isDevice) {
        registerForPushNotifications(firebaseUser.uid);
      }
    });
    return () => {
      unsubUserDoc?.();
      unsubscribe();
    };
  }, []);

  const setOnboardingDone = async (done: boolean) => {
    setOnboardingDoneState(done);
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), { onboardingDone: done }).catch(() => {});
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, userCode, onboardingDone, setOnboardingDone, myAuthorHandle, blockedHandles }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
