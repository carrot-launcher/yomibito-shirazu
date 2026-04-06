import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import TankaScroll from '../components/TankaScroll';
import { db } from '../config/firebase';
import { PostDoc, TankaCard } from '../types';

export default function TimelineScreen({ route, navigation }: any) {
  const { groupId, groupName } = route.params;
  const [cards, setCards] = useState<TankaCard[]>([]);

  useEffect(() => {
    navigation.setOptions({
      title: groupName,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 4 }}>
          <TouchableOpacity onPress={() => navigation.navigate('Compose', { preselectedGroupId: groupId })} hitSlop={8} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="pen" size={22} color="#2C2418" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('GroupSettings', { groupId })} hitSlop={8} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="cog-outline" size={22} color="#2C2418" />
          </TouchableOpacity>
        </View>
      ),
    });
    const q = query(collection(db, 'posts'), where('groupId', '==', groupId), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setCards(snap.docs.map(d => {
        const data = d.data() as PostDoc;
        return { postId: d.id, groupId: data.groupId, body: data.body, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: data.reactionSummary || {}, commentCount: data.commentCount || 0 };
      }));
    }, (error) => {
      if (error.code === 'permission-denied') {
        Alert.alert('この歌会にアクセスできません', '追放されたか、歌会が解散された可能性があります。', [
          { text: 'OK', onPress: () => navigation.popToTop() },
        ]);
      }
    });
    return unsub;
  }, [groupId]);

  return (
    <View style={styles.container}>
      <TankaScroll cards={cards} onTap={(postId, gId) => navigation.navigate('TankaDetail', { postId, groupId: gId })} mode="timeline" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
});