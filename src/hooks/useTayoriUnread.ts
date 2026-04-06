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
    let notifications: { createdAt: Date }[] = [];

    const compute = () => {
      if (!lastReadAt) {
        setUnreadCount(notifications.length);
      } else {
        setUnreadCount(notifications.filter(n => n.createdAt > lastReadAt!).length);
      }
    };

    // ユーザーの lastReadAt を監視
    const unsubUser = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      lastReadAt = snap.data()?.tayoriLastReadAt?.toDate() || null;
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
      compute();
    }, () => {});

    return () => { unsubUser(); unsubNotifs(); };
  }, [user]);

  return unreadCount;
}
