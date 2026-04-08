import { collection, getDocs, limit, onSnapshot, orderBy, query, QueryDocumentSnapshot, startAfter, Unsubscribe, where } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
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
    revealedAuthorName: data.revealedAuthorName,
    revealedAuthorCode: data.revealedAuthorCode,
  };
}

export function usePaginatedPosts(groupId: string) {
  const [cards, setCards] = useState<TankaCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [newArrivals, setNewArrivals] = useState<TankaCard[]>([]);
  const [arrivalGen, setArrivalGen] = useState(0);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);
  const unsubRef = useRef<Unsubscribe | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    unsubRef.current?.();
    unsubRef.current = null;
    setLoading(true);
    lastDocRef.current = null;

    const q = query(
      collection(db, 'posts'),
      where('groupId', '==', groupId),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    );

    // getDocs で確実にデータを取得（空フラッシュなし）
    const snap = await getDocs(q);
    const initialCards = snap.docs.map(docToCard);
    knownIdsRef.current = new Set(snap.docs.map(d => d.id));

    setCards(initialCards);
    lastDocRef.current = snap.docs[snap.docs.length - 1] || null;
    setHasMore(snap.docs.length >= PAGE_SIZE);
    setGeneration(g => g + 1);
    setLoading(false);

    // その後 onSnapshot でリアルタイム新着を監視
    unsubRef.current = onSnapshot(q, (rtSnap) => {
      const added: TankaCard[] = [];
      rtSnap.docChanges().forEach(change => {
        if (change.type === 'added' && !knownIdsRef.current.has(change.doc.id)) {
          knownIdsRef.current.add(change.doc.id);
          added.push(docToCard(change.doc));
        }
      });
      if (added.length > 0) {
        added.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setCards(prev => {
          if (prev.length === 0) {
            setGeneration(g => g + 1);
            return added;
          }
          // 重複排除
          const existingIds = new Set(prev.map(c => c.postId));
          const unique = added.filter(c => !existingIds.has(c.postId));
          if (unique.length === 0) return prev;
          setNewArrivals(unique);
          setArrivalGen(g => g + 1);
          return [...unique, ...prev];
        });
      }
    }, () => {});
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
      snap.docs.forEach(d => knownIdsRef.current.add(d.id));
      setCards(prev => [...prev, ...newCards]);
      lastDocRef.current = snap.docs[snap.docs.length - 1] || lastDocRef.current;
      setHasMore(snap.docs.length >= PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [groupId, loading, hasMore]);

  useEffect(() => {
    return () => { unsubRef.current?.(); };
  }, [groupId]);

  return { cards, loading, hasMore, refresh, loadMore, generation, newArrivals, arrivalGen };
}
