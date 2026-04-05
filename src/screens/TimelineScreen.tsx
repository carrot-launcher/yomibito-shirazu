import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import TankaScroll from '../components/TankaScroll';
import { TankaCard, PostDoc } from '../types';

export default function TimelineScreen({ route, navigation }: any) {
  const { groupId, groupName } = route.params;
  const [cards, setCards] = useState<TankaCard[]>([]);

  useEffect(() => {
    navigation.setOptions({ title: groupName });
    const q = query(collection(db, 'posts'), where('groupId', '==', groupId), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setCards(snap.docs.map(d => {
        const data = d.data() as PostDoc;
        return { postId: d.id, groupId: data.groupId, body: data.body, createdAt: data.createdAt?.toDate() || new Date(), reactionSummary: data.reactionSummary || {}, commentCount: data.commentCount || 0 };
      }));
    });
    return unsub;
  }, [groupId]);

  return (
    <View style={styles.container}>
      <TankaScroll cards={cards} onTap={(postId, gId) => navigation.navigate('TankaDetail', { postId, groupId: gId })} mode="timeline" />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('Compose', { preselectedGroupId: groupId })}><Text style={styles.fabText}>筆</Text></TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: '#2C2418', justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 4 },
  fabText: { color: '#F5F0E8', fontSize: 20 },
});
