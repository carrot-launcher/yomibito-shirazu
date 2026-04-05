import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import TankaScroll from '../components/TankaScroll';
import { TankaCard, MyPostDoc, BookmarkDoc } from '../types';

export default function KashuScreen({ navigation }: any) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'myPosts' | 'bookmarks'>('myPosts');
  const [myPosts, setMyPosts] = useState<TankaCard[]>([]);
  const [bookmarks, setBookmarks] = useState<TankaCard[]>([]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'users', user.uid, 'myPosts'), orderBy('createdAt', 'desc')), (snap) => {
      setMyPosts(snap.docs.map(d => { const data = d.data() as MyPostDoc; return { postId: data.postId, groupId: data.groupId, body: data.tankaBody, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: {}, commentCount: 0, groupName: data.groupName, batchId: data.batchId }; }));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'users', user.uid, 'bookmarks'), orderBy('createdAt', 'desc')), (snap) => {
      setBookmarks(snap.docs.map(d => { const data = d.data() as BookmarkDoc; return { postId: d.id, groupId: data.groupId, body: data.tankaBody, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: {}, commentCount: 0, groupName: data.groupName, bookmarkedAt: data.createdAt?.toDate() || new Date() }; }));
    });
  }, [user]);

  const handleTap = (postId: string, groupId: string) => navigation.navigate('TankaDetail', { postId, groupId });

  return (
    <View style={styles.container}>
      <View style={styles.segmentBar}>
        <TouchableOpacity style={[styles.segment, tab === 'myPosts' && styles.segmentActive]} onPress={() => setTab('myPosts')}><Text style={[styles.segmentText, tab === 'myPosts' && styles.segmentTextActive]}>自分の歌</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.segment, tab === 'bookmarks' && styles.segmentActive]} onPress={() => setTab('bookmarks')}><Text style={[styles.segmentText, tab === 'bookmarks' && styles.segmentTextActive]}>栞</Text></TouchableOpacity>
      </View>
      <TankaScroll cards={tab === 'myPosts' ? myPosts : bookmarks} onTap={handleTap} mode={tab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  segmentBar: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: '#E8E0D0', borderRadius: 8, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: '#FFFDF8' },
  segmentText: { fontSize: 14, color: '#8B7E6A' }, segmentTextActive: { color: '#2C2418', fontWeight: '500' },
});
