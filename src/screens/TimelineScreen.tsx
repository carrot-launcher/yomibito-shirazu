import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import TankaScroll from '../components/TankaScroll';
import { useAlert } from '../components/CustomAlert';
import { db } from '../config/firebase';
import { PostDoc, TankaCard } from '../types';

export default function TimelineScreen({ route, navigation }: any) {
  const { groupId, groupName } = route.params;
  const { alert } = useAlert();
  const [cards, setCards] = useState<TankaCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPosts = useCallback(async () => {
    try {
      const q = query(collection(db, 'posts'), where('groupId', '==', groupId), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setCards(snap.docs.map(d => {
        const data = d.data() as PostDoc;
        return { postId: d.id, groupId: data.groupId, body: data.body, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: data.reactionSummary || {}, commentCount: data.commentCount || 0 };
      }));
    } catch (error: any) {
      if (error.code === 'permission-denied') {
        alert('この歌会にアクセスできません', '追放されたか、歌会が解散された可能性があります。', [
          { text: 'OK', onPress: () => navigation.popToTop() },
        ]);
      }
    }
  }, [groupId, alert, navigation]);

  useEffect(() => {
    navigation.setOptions({
      title: groupName,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 4 }}>
          <TouchableOpacity onPress={() => navigation.navigate('GroupSettings', { groupId })} hitSlop={8} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="cog-outline" size={22} color="#2C2418" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Compose', { preselectedGroupId: groupId })} hitSlop={8} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="pen" size={22} color="#2C2418" />
          </TouchableOpacity>
        </View>
      ),
    });
    fetchPosts();
    const unsub = navigation.addListener('focus', fetchPosts);
    return unsub;
  }, [groupId, fetchPosts, navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPosts();
    setRefreshing(false);
  }, [fetchPosts]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A69880" colors={['#A69880']} />}
    >
      <TankaScroll cards={cards} onTap={(postId, gId) => navigation.navigate('TankaDetail', { postId, groupId: gId })} mode="timeline" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  content: { flex: 1 },
});