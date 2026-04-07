import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import GradientBackground from '../components/GradientBackground';
import { collection, doc, getDoc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import TankaScroll from '../components/TankaScroll';
import { TankaCard, MyPostDoc, BookmarkDoc, PostDoc } from '../types';

export default function KashuScreen({ navigation }: any) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'myPosts' | 'bookmarks'>('myPosts');
  const [myPosts, setMyPosts] = useState<TankaCard[]>([]);
  const [bookmarks, setBookmarks] = useState<TankaCard[]>([]);
  const baseCardsRef = useRef<TankaCard[]>([]);

  const enrichPosts = useCallback(async (cards: TankaCard[]) => {
    const enriched = (await Promise.all(cards.map(async (card) => {
      try {
        const postSnap = await getDoc(doc(db, 'posts', card.postId));
        if (postSnap.exists()) {
          const postData = postSnap.data() as PostDoc;
          return { ...card, reactionSummary: postData.reactionSummary || {}, commentCount: postData.commentCount || 0, ...(postData.hogo ? { hogo: true, hogoReason: postData.hogoReason } : {}) };
        }
      } catch {}
      return null;
    }))).filter((c): c is TankaCard => c !== null);
    setMyPosts(enriched);
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'users', user.uid, 'myPosts'), orderBy('createdAt', 'desc')), (snap) => {
      const baseCards = snap.docs.map(d => {
        const data = d.data() as MyPostDoc;
        return { postId: data.postId, groupId: data.groupId, body: data.tankaBody, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: {} as any, commentCount: 0, groupName: data.groupName, batchId: data.batchId };
      });
      baseCardsRef.current = baseCards;
      enrichPosts(baseCards);
    });
  }, [user, enrichPosts]);

  // 画面に戻ったときにリアクション・評を再取得
  useEffect(() => {
    return navigation.addListener('focus', () => {
      if (baseCardsRef.current.length > 0) {
        enrichPosts(baseCardsRef.current);
      }
    });
  }, [navigation, enrichPosts]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'users', user.uid, 'bookmarks'), orderBy('createdAt', 'desc')), (snap) => {
      setBookmarks(snap.docs.map(d => { const data = d.data() as BookmarkDoc; return { postId: d.id, groupId: data.groupId, body: data.tankaBody, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: {}, commentCount: 0, groupName: data.groupName, bookmarkedAt: data.createdAt?.toDate() || new Date() }; }));
    });
  }, [user]);

  const handleTap = (postId: string, groupId: string, batchId?: string) => navigation.navigate('TankaDetail', { postId, groupId, batchId, fromMyPosts: tab === 'myPosts' });

  return (
    <GradientBackground style={styles.container}>
      <View style={styles.segmentBar}>
        <TouchableOpacity style={[styles.segment, tab === 'myPosts' && styles.segmentActive]} onPress={() => setTab('myPosts')}><Text style={[styles.segmentText, tab === 'myPosts' && styles.segmentTextActive]}>自分の歌</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.segment, tab === 'bookmarks' && styles.segmentActive]} onPress={() => setTab('bookmarks')}><Text style={[styles.segmentText, tab === 'bookmarks' && styles.segmentTextActive]}>栞</Text></TouchableOpacity>
      </View>
      <TankaScroll cards={tab === 'myPosts' ? myPosts : bookmarks} onTap={handleTap} mode={tab} />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  segmentBar: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: '#E8E0D0', borderRadius: 8, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: '#FFFDF8' },
  segmentText: { fontSize: 15, color: '#8B7E6A', fontFamily: 'NotoSerifJP_400Regular' }, segmentTextActive: { color: '#2C2418', fontWeight: '500', fontFamily: 'NotoSerifJP_500Medium' },
});
