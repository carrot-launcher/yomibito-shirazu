import { MaterialCommunityIcons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import TankaScroll from '../components/TankaScroll';
import { db } from '../config/firebase';
import { usePaginatedPosts } from '../hooks/usePaginatedPosts';

export default function TimelineScreen({ route, navigation }: any) {
  const { groupId, groupName } = route.params;
  const { alert } = useAlert();
  const { cards, loading, hasMore, refresh, loadMore, generation } = usePaginatedPosts(groupId);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const updateHeader = async () => {
      let name = groupName;
      try {
        const snap = await getDoc(doc(db, 'groups', groupId));
        if (snap.exists()) name = snap.data().name || groupName;
      } catch {}
      navigation.setOptions({
        title: name,
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 4 }}>
            <TouchableOpacity onPress={() => navigation.navigate('GroupSettings', { groupId })} hitSlop={8} style={{ padding: 8 }}>
              <MaterialCommunityIcons name="cog-outline" size={22} color="#2C2418" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Compose', { preselectedGroupId: groupId })} hitSlop={8} style={{ padding: 8 }}>
              <MaterialCommunityIcons name="pen" size={22} color="#2C2418" />
            </TouchableOpacity>
          </View>
        ),
      });
    };
    updateHeader();
    refresh().catch((error: any) => {
      if (error?.code === 'permission-denied') {
        alert('この歌会にアクセスできません', '追放されたか、歌会が解散された可能性があります。', [
          { text: 'OK', onPress: () => navigation.popToTop() },
        ]);
      }
    });
    const unsub = navigation.addListener('focus', () => { updateHeader(); refresh(); });
    return unsub;
  }, [groupId, groupName, refresh, navigation, alert]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  return (
    <GradientBackground>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A69880" colors={['#A69880']} />}
      >
        <TankaScroll
          cards={cards}
          onTap={(postId, gId) => navigation.navigate('TankaDetail', { postId, groupId: gId })}
          mode="timeline"
          onLoadMore={hasMore && !loading ? loadMore : undefined}
          generation={generation}
        />
      </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { flex: 1 },
});
