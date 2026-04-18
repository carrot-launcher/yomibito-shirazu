import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './useAuth';

// タブ切替時のバッジのちらつき防止用：Firestore反映を待たずに即時で「既読」扱いにする
let _isTayoriFocused = false;
let _localReadAt: Date | null = null;
const _listeners = new Set<() => void>();

export function setTayoriFocused(focused: boolean) {
  _isTayoriFocused = focused;
  if (!focused) {
    // 離脱時点を即座にローカル既読時刻として記録
    _localReadAt = new Date();
  }
  _listeners.forEach(l => l());
}

export function useTayoriUnread(): number {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
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

      // FirestoreのtayoriLastReadAtと、ローカルの離脱時刻の新しい方を採用
      const effectiveLastRead =
        lastReadAt && _localReadAt
          ? (lastReadAt > _localReadAt ? lastReadAt : _localReadAt)
          : (lastReadAt || _localReadAt);

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
