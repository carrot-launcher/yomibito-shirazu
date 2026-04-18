import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import GradientBackground from '../components/GradientBackground';
import { collection, doc, getDoc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import TankaScroll from '../components/TankaScroll';
import { TankaCard, MyPostDoc, BookmarkDoc, PostDoc } from '../types';
import { useTheme } from '../theme/ThemeContext';

export default function KashuScreen({ navigation }: any) {
  const { user } = useAuth();
  const { colors } = useTheme();
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
          return { ...card, reactionSummary: postData.reactionSummary || {}, commentCount: postData.commentCount || 0, ...(postData.hogo ? { hogo: true, hogoReason: postData.hogoReason, hogoType: postData.hogoType } : {}) };
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
        return { postId: data.postId, groupId: data.groupId, body: data.tankaBody, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: {} as any, commentCount: 0, groupName: data.groupName, batchId: data.batchId, convertHalfSpace: data.convertHalfSpace, convertLineBreak: data.convertLineBreak };
      });
      baseCardsRef.current = baseCards;
      enrichPosts(baseCards);
    }, () => {});
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
    return onSnapshot(query(collection(db, 'users', user.uid, 'bookmarks'), orderBy('createdAt', 'desc')), async (snap) => {
      const cards = await Promise.all(snap.docs.map(async (d) => {
        const data = d.data() as BookmarkDoc;
        const card: TankaCard = { postId: d.id, groupId: data.groupId, body: data.tankaBody, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: {}, commentCount: 0, groupName: data.groupName, bookmarkedAt: data.createdAt?.toDate() || new Date() };
        try {
          const postSnap = await getDoc(doc(db, 'posts', d.id));
          if (postSnap.exists()) {
            const postData = postSnap.data() as PostDoc;
            return { ...card, reactionSummary: postData.reactionSummary || {}, commentCount: postData.commentCount || 0, ...(postData.hogo ? { hogo: true, hogoReason: postData.hogoReason, hogoType: postData.hogoType } : {}), revealedAuthorName: postData.revealedAuthorName, revealedAuthorCode: postData.revealedAuthorCode };
          }
        } catch {}
        return card;
      }));
      setBookmarks(cards);
    }, () => {});
  }, [user]);

  const handleTap = (postId: string, groupId: string, batchId?: string) => navigation.navigate('TankaDetail', { postId, groupId, batchId, fromMyPosts: tab === 'myPosts' });

  const dynamicStyles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    segmentBar: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: colors.segmentBg, borderRadius: 8, padding: 3 },
    segmentActive: { backgroundColor: colors.segmentActive },
  }), [colors]);

  return (
    <GradientBackground style={dynamicStyles.container}>
      <View style={dynamicStyles.segmentBar}>
        <TouchableOpacity style={[styles.segment, tab === 'myPosts' && dynamicStyles.segmentActive]} onPress={() => setTab('myPosts')}><AppText variant="buttonLabel" weight={tab === 'myPosts' ? 'medium' : 'regular'} tone={tab === 'myPosts' ? 'primary' : 'secondary'}>自分の詠草</AppText></TouchableOpacity>
        <TouchableOpacity style={[styles.segment, tab === 'bookmarks' && dynamicStyles.segmentActive]} onPress={() => setTab('bookmarks')}><AppText variant="buttonLabel" weight={tab === 'bookmarks' ? 'medium' : 'regular'} tone={tab === 'bookmarks' ? 'primary' : 'secondary'}>栞</AppText></TouchableOpacity>
      </View>
      <TankaScroll cards={tab === 'myPosts' ? myPosts : bookmarks} onTap={handleTap} mode={tab} />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
});
