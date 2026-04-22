import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, runTransaction, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { getMessaging, getToken, registerDeviceForRemoteMessages } from '@react-native-firebase/messaging';
import { getCrashlytics, setUserId as setCrashlyticsUserId } from '@react-native-firebase/crashlytics';
import { auth, db } from '../config/firebase';

const crashlyticsInstance = getCrashlytics();
const messagingInstance = getMessaging();

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

    // iOS では APNs 登録を明示的に実行 (FCM が APNs 経由で配信するため)
    if (Platform.OS === 'ios') {
      try {
        await registerDeviceForRemoteMessages(messagingInstance);
      } catch {
        // 既に登録済みの場合は無視
      }
    }

    // FCM トークン取得（iOS / Android 共通）
    // expo-notifications の getDevicePushTokenAsync は iOS だと APNs トークンを返すため、
    // Firebase Admin SDK の messaging.send() では使えない。@react-native-firebase/messaging
    // の getToken() を使うと両プラットフォームで FCM レジストレーショントークンが得られる。
    const fcmToken = await getToken(messagingInstance);
    if (fcmToken) {
      await updateDoc(doc(db, 'users', uid), { fcmToken });
    }
  } catch (e) {
    console.warn('[registerForPushNotifications] failed', e);
  }
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
  blockedByHandles: Record<string, { blockedAt: any }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, userCode: '', onboardingDone: true, setOnboardingDone: () => {},
  myAuthorHandle: '', blockedHandles: {}, blockedByHandles: {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userCode, setUserCode] = useState('');
  const [onboardingDone, setOnboardingDoneState] = useState(true);
  const [myAuthorHandle, setMyAuthorHandle] = useState('');
  const [blockedHandles, setBlockedHandles] = useState<Record<string, { blockedAt: any; sampleBody?: string }>>({});
  const [blockedByHandles, setBlockedByHandles] = useState<Record<string, { blockedAt: any }>>({});

  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // 切替時にユーザードキュメント購読を停止
      unsubUserDoc?.();
      unsubUserDoc = null;

      // Crashlytics に uid を紐付ける（以降のエラーレポートに uid が乗る）。
      // ログアウト時は空文字をセットして切り離す。
      try { setCrashlyticsUserId(crashlyticsInstance, firebaseUser?.uid || ''); } catch {}

      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        // 新規作成と userCode 補完をトランザクションで原子化する。
        // 複数デバイスで同時サインインしても "読み込み → 作成" の隙間で
        // userCode が上書きされることが無くなる（後勝ちの片方は no-op に落ちる）。
        const codeIfNew = generateUserCode();
        const result = await runTransaction(db, async (tx) => {
          const snap = await tx.get(userRef);
          if (!snap.exists()) {
            tx.set(userRef, {
              userCode: codeIfNew,
              fcmToken: '',
              joinedGroups: [],
              notificationSettings: { newPost: true, reaction: true, comment: true },
              createdAt: serverTimestamp(),
              // LoginScreen のチェックボックスで同意した時点で作成されるので、同時に記録
              termsAcceptedAt: serverTimestamp(),
            });
            return { userCode: codeIfNew, onboardingDone: false };
          }
          const data = snap.data() as any;
          if (!data.userCode) {
            // 既存 doc で userCode 欠落のレアケース: 補完
            tx.update(userRef, { userCode: codeIfNew });
            return { userCode: codeIfNew, onboardingDone: data.onboardingDone ?? true };
          }
          return { userCode: data.userCode as string, onboardingDone: data.onboardingDone ?? true };
        });
        setUserCode(result.userCode);
        setOnboardingDoneState(result.onboardingDone);

        // blockedHandles / blockedByHandles をリアルタイム購読
        unsubUserDoc = onSnapshot(userRef, (snap) => {
          const data = snap.data();
          setBlockedHandles((data?.blockedHandles as Record<string, { blockedAt: any; sampleBody?: string }>) || {});
          setBlockedByHandles((data?.blockedByHandles as Record<string, { blockedAt: any }>) || {});
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
        setBlockedByHandles({});
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
    <AuthContext.Provider value={{ user, loading, userCode, onboardingDone, setOnboardingDone, myAuthorHandle, blockedHandles, blockedByHandles }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
