import { collection, getDocs, limit, orderBy, query, QueryDocumentSnapshot, startAfter, where } from 'firebase/firestore';
import { useCallback, useRef, useState } from 'react';
import { db } from '../config/firebase';
import { PostDoc, TankaCard } from '../types';

const PAGE_SIZE = 20;

function docToCard(d: QueryDocumentSnapshot): TankaCard {
  const data = d.data() as PostDoc;
  return {
    postId: d.id,
    groupId: data.groupId,
    body: data.body,
    createdAt: data.createdAt?.toDate() || new Date(),
    reactionSummary: data.reactionSummary || {},
    commentCount: data.commentCount || 0,
    hogo: data.hogo,
    hogoReason: data.hogoReason,
  };
}

export function usePaginatedPosts(groupId: string) {
  const [cards, setCards] = useState<TankaCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [generation, setGeneration] = useState(0);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    lastDocRef.current = null;
    try {
      const q = query(
        collection(db, 'posts'),
        where('groupId', '==', groupId),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      setCards(snap.docs.map(docToCard));
      lastDocRef.current = snap.docs[snap.docs.length - 1] || null;
      setHasMore(snap.docs.length >= PAGE_SIZE);
      setGeneration(g => g + 1);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !lastDocRef.current) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'posts'),
        where('groupId', '==', groupId),
        orderBy('createdAt', 'desc'),
        startAfter(lastDocRef.current),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const newCards = snap.docs.map(docToCard);
      setCards(prev => [...prev, ...newCards]);
      lastDocRef.current = snap.docs[snap.docs.length - 1] || lastDocRef.current;
      setHasMore(snap.docs.length >= PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [groupId, loading, hasMore]);

  return { cards, loading, hasMore, refresh, loadMore, generation };
}
