import { MaterialCommunityIcons } from '@expo/vector-icons';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import TankaScroll from '../components/TankaScroll';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { usePaginatedPosts } from '../hooks/usePaginatedPosts';
import { useTheme } from '../theme/ThemeContext';

// タイムライン上部に「公開」バッジ＋趣意書ストリップを表示するか
// 要らなくなったら false に切り替え（実装はそのまま残す）
const SHOW_PUBLIC_PURPOSE_STRIP = true;

export default function TimelineScreen({ route, navigation }: any) {
  const { groupId, groupName } = route.params;
  const { user, blockedHandles, blockedByHandles } = useAuth();
  const { alert } = useAlert();
  const { colors } = useTheme();
  const { cards, loading, hasMore, refresh, loadMore, generation, newArrivals, arrivalGen, changedCards, removedIds, updateGen } = usePaginatedPosts(groupId);
  const filterBlocked = useCallback(<T extends { authorHandle?: string }>(list: T[]) => {
    // 双方向：自分がブロックしている相手、および自分をブロックしている相手の投稿を除外
    const hasAny = Object.keys(blockedHandles).length + Object.keys(blockedByHandles).length;
    if (!hasAny) return list;
    return list.filter(c => !c.authorHandle
      || (!blockedHandles[c.authorHandle] && !blockedByHandles[c.authorHandle]));
  }, [blockedHandles, blockedByHandles]);
  const visibleCards = useMemo(() => filterBlocked(cards), [cards, filterBlocked]);
  const visibleNewArrivals = useMemo(() => filterBlocked(newArrivals), [newArrivals, filterBlocked]);
  const visibleChangedCards = useMemo(() => filterBlocked(changedCards), [changedCards, filterBlocked]);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadSince, setUnreadSince] = useState<Date | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [purposeExpanded, setPurposeExpanded] = useState(false);

  useEffect(() => {
    const updateHeader = async () => {
      let name = groupName;
      try {
        const snap = await getDoc(doc(db, 'groups', groupId));
        if (snap.exists()) {
          const gd = snap.data();
          name = gd.name || groupName;
          setIsPublic(gd.isPublic === true);
          setPurpose(typeof gd.purpose === 'string' ? gd.purpose : '');
        }
      } catch {}
      navigation.setOptions({
        title: name,
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 4 }}>
            <TouchableOpacity onPress={() => navigation.navigate('GroupSettings', { groupId })} hitSlop={8} style={{ padding: 8 }}>
              <MaterialCommunityIcons name="cog-outline" size={24} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Compose', { preselectedGroupId: groupId })} hitSlop={8} style={{ padding: 8 }}>
              <MaterialCommunityIcons name="pen" size={24} color={colors.text} />
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
        {SHOW_PUBLIC_PURPOSE_STRIP && isPublic && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setPurposeExpanded(v => !v)}
            style={[styles.purposeStrip, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
          >
            <View style={[styles.publicBadge, { borderColor: colors.border }]}>
              <Text style={[styles.publicBadgeText, { color: colors.textSecondary }]}>公開</Text>
            </View>
            {purpose ? (
              <AppText
                variant="meta"
                tone="secondary"
                style={styles.purposeText}
                numberOfLines={purposeExpanded ? undefined : 1}
              >
                {purpose}
              </AppText>
            ) : null}
          </TouchableOpacity>
        )}
        <TankaScroll
          cards={visibleCards}
          onTap={(postId, gId) => navigation.navigate('TankaDetail', { postId, groupId: gId })}
          mode="timeline"
          onLoadMore={hasMore && !loading ? loadMore : undefined}
          generation={generation}
          newArrivals={visibleNewArrivals}
          arrivalGen={arrivalGen}
          unreadSince={unreadSince}
          changedCards={visibleChangedCards}
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
  purposeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  publicBadge: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  publicBadgeText: { fontSize: 9, lineHeight: 13, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 1 },
  purposeText: { flex: 1 },
});
