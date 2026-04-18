import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './useAuth';

// タブ切替時のバッジのちらつき防止用：Firestore反映を待たずに即時で「既読」扱いにする。
// ただし _localReadAt は client 側の JS Date なので、clock skew があると
// 「ずっと先の時刻」を指して以降の通知を永遠に既読扱いしてしまう恐れがある。
// → 30 秒の有効期限を設け、それを過ぎたら server の lastReadAt だけを信用する。
let _isTayoriFocused = false;
let _localReadAt: Date | null = null;
const LOCAL_READ_GRACE_MS = 30 * 1000;
const _listeners = new Set<() => void>();

function effectiveLocalReadAt(): Date | null {
  if (!_localReadAt) return null;
  if (Date.now() - _localReadAt.getTime() > LOCAL_READ_GRACE_MS) return null;
  return _localReadAt;
}

export function setTayoriFocused(focused: boolean) {
  _isTayoriFocused = focused;
  if (!focused) {
    // 離脱時点を即座にローカル既読時刻として記録（30秒で失効）
    _localReadAt = new Date();
  }
  _listeners.forEach(l => l());
}

export function useTayoriUnread(): number {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // ユーザー変化（初回ログイン / ログアウト / アカウント切替）のたびに
    // モジュールレベルの状態を前ユーザーから持ち越さないように初期化する
    _localReadAt = null;
    _isTayoriFocused = false;

    if (!user) { setUnreadCount(0); return; }

    let lastReadAt: Date | null = null;
    let clearedAt: Date | null = null;
    let notifications: { createdAt: Date }[] = [];
    let userLoaded = false;
    let notifsLoaded = false;

    const compute = () => {
      if (!userLoaded || !notifsLoaded) return;

      // たよりタブを表示中はバッジを常に0に
      if (_isTayoriFocused) {
        setUnreadCount(0);
        return;
      }

      const visible = clearedAt
        ? notifications.filter(n => n.createdAt > clearedAt!)
        : notifications;

      // FirestoreのtayoriLastReadAt と、有効期限内のローカル離脱時刻の新しい方を採用
      const localRead = effectiveLocalReadAt();
      const effectiveLastRead =
        lastReadAt && localRead
          ? (lastReadAt > localRead ? lastReadAt : localRead)
          : (lastReadAt || localRead);

      if (!effectiveLastRead) {
        setUnreadCount(visible.length);
      } else {
        setUnreadCount(visible.filter(n => n.createdAt > effectiveLastRead).length);
      }
    };

    _listeners.add(compute);

    // ユーザーの lastReadAt, clearedAt を監視
    const unsubUser = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data();
      lastReadAt = data?.tayoriLastReadAt?.toDate() || null;
      clearedAt = data?.tayoriClearedAt?.toDate() || null;
      userLoaded = true;
      compute();
    }, () => {});

    // 通知一覧を監視
    const q = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc')
    );
    const unsubNotifs = onSnapshot(q, (snap) => {
      notifications = snap.docs
        .map(d => ({ createdAt: d.data().createdAt?.toDate() }))
        .filter(n => n.createdAt);
      notifsLoaded = true;
      compute();
    }, () => {});

    return () => {
      _listeners.delete(compute);
      unsubUser();
      unsubNotifs();
    };
  }, [user]);

  return unreadCount;
}
