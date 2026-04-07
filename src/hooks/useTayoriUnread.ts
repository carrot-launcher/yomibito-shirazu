import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './useAuth';

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

      const visible = clearedAt
        ? notifications.filter(n => n.createdAt > clearedAt!)
        : notifications;

      if (!lastReadAt) {
        setUnreadCount(visible.length);
      } else {
        setUnreadCount(visible.filter(n => n.createdAt > lastReadAt!).length);
      }
    };

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

    return () => { unsubUser(); unsubNotifs(); };
  }, [user]);

  return unreadCount;
}
