import { MaterialCommunityIcons } from '@expo/vector-icons';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import TankaScroll from '../components/TankaScroll';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { usePaginatedPosts } from '../hooks/usePaginatedPosts';
import { useTheme } from '../theme/ThemeContext';

export default function TimelineScreen({ route, navigation }: any) {
  const { groupId, groupName } = route.params;
  const { user } = useAuth();
  const { alert } = useAlert();
  const { colors } = useTheme();
  const { cards, loading, hasMore, refresh, loadMore, generation, newArrivals, arrivalGen, changedCards, removedIds, updateGen } = usePaginatedPosts(groupId);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadSince, setUnreadSince] = useState<Date | null>(null);

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
              <MaterialCommunityIcons name="cog-outline" size={22} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Compose', { preselectedGroupId: groupId })} hitSlop={8} style={{ padding: 8 }}>
              <MaterialCommunityIcons name="pen" size={22} color={colors.text} />
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
    // focus 時は refresh しない（スクロール位置維持のため）
    // onSnapshot がリアルタイム更新を担うので、戻ってきても新着・変更・削除は反映される
    const unsub = navigation.addListener('focus', () => { updateHeader(); });
    return unsub;
  }, [groupId, groupName, refresh, navigation, alert, colors]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // 未読管理:
  // - 初回マウント時: getDocで「以前の」lastReadAt を取得 → unreadSince に保持
  //   完了後にmarkReadを呼ぶ（getDocが新しい時刻を読まないように直列化）
  // - blur時: 既読更新
  // - リアルタイム新着到着時: 既読更新（タイムラインを見ている間に来た投稿も既読扱いに）
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const memberRef = doc(db, 'groups', groupId, 'members', user.uid);
    const markRead = () => {
      updateDoc(memberRef, { lastReadAt: serverTimestamp() }).catch(() => {});
    };
    getDoc(memberRef).then(snap => {
      if (cancelled) return;
      // 未取得の場合は 1970年 を入れる（全カードが「未読」になる）
      const prev = snap.data()?.lastReadAt?.toDate?.() || new Date(0);
      setUnreadSince(prev);
      markRead();
    }).catch(() => {
      if (cancelled) return;
      markRead();
    });
    const unsub = navigation.addListener('blur', markRead);
    return () => { cancelled = true; unsub(); };
  }, [navigation, user, groupId]);

  // タイムライン表示中にリアルタイム新着が来たら、それも既読扱い
  useEffect(() => {
    if (!user || !arrivalGen) return;
    updateDoc(doc(db, 'groups', groupId, 'members', user.uid), {
      lastReadAt: serverTimestamp(),
    }).catch(() => {});
  }, [arrivalGen, user, groupId]);

  return (
    <GradientBackground>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textTertiary} colors={[colors.textTertiary]} />}
      >
        <TankaScroll
          cards={cards}
          onTap={(postId, gId) => navigation.navigate('TankaDetail', { postId, groupId: gId })}
          mode="timeline"
          onLoadMore={hasMore && !loading ? loadMore : undefined}
          generation={generation}
          newArrivals={newArrivals}
          arrivalGen={arrivalGen}
          unreadSince={unreadSince}
          changedCards={changedCards}
          removedIds={removedIds}
          updateGen={updateGen}
        />
      </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { flex: 1 },
});
