import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppText } from '../components/AppText';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';
import { fs } from '../utils/scale';

type TabKey = 'new' | 'active' | 'large';

type PublicGroup = {
  id: string;
  name: string;
  purpose?: string;
  memberCount: number;
  postCount?: number;
  lastPostAt?: Timestamp;
  createdAt?: Timestamp;
  ownerDisplayName?: string;
  ownerUserCode?: string;
};

const TABS: { key: TabKey; label: string }[] = [
  { key: 'new', label: '新着' },
  { key: 'active', label: '活発' },
  { key: 'large', label: '大きな歌会' },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default function UtakaiDiscoveryScreen({ navigation }: any) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [tab, setTab] = useState<TabKey>('new');
  const [groups, setGroups] = useState<PublicGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [disabledMessage, setDisabledMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  const fetchGroups = useCallback(async (which: TabKey) => {
    setLoading(true);
    setErrorMessage('');
    try {
      // kill switch
      const cfgSnap = await getDoc(doc(db, 'config', 'publicGroups'));
      const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
      if (cfg?.enabled === false) {
        setDisabled(true);
        setDisabledMessage(typeof cfg?.message === 'string' && cfg.message ? cfg.message : '公開歌会は現在停止しています');
        setGroups([]);
        return;
      }
      setDisabled(false);

      let q;
      if (which === 'new') {
        q = query(collection(db, 'groups'),
          where('isPublic', '==', true),
          orderBy('createdAt', 'desc'),
          limit(40));
      } else if (which === 'active') {
        q = query(collection(db, 'groups'),
          where('isPublic', '==', true),
          orderBy('lastPostAt', 'desc'),
          limit(40));
      } else {
        q = query(collection(db, 'groups'),
          where('isPublic', '==', true),
          orderBy('memberCount', 'desc'),
          limit(40));
      }

      const snap = await getDocs(q);
      let list: PublicGroup[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

      // 新着以外は memberCount>=3 でフィルタ（新着は生まれたて歓迎）
      if (which !== 'new') {
        list = list.filter(g => (g.memberCount || 0) >= 3);
      }
      // 活発タブはさらに 30日以内の投稿があるものに絞る
      if (which === 'active') {
        const cutoff = Date.now() - THIRTY_DAYS_MS;
        list = list.filter(g => {
          const t = g.lastPostAt?.toMillis?.();
          return typeof t === 'number' && t >= cutoff;
        });
      }

      setGroups(list.slice(0, 30));
    } catch (e: any) {
      console.warn('[UtakaiDiscovery] fetch error', e);
      setErrorMessage(e?.message || '読み込みに失敗しました');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGroups(tab); }, [tab, fetchGroups]);

  // ログイン中ユーザーの所属歌会を取得（参加済みバッジ用）
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      const ids: string[] = snap.data()?.joinedGroups || [];
      setJoinedIds(new Set(ids));
    }).catch(() => {});
  }, [user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchGroups(tab);
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: PublicGroup }) => {
    const joined = joinedIds.has(item.id);
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('UtakaiPreview', { groupId: item.id })}
        activeOpacity={0.75}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
          {joined && (
            <View style={[styles.joinedBadge, { backgroundColor: colors.border }]}>
              <Text style={[styles.joinedBadgeText, { color: colors.textSecondary }]}>参加中</Text>
            </View>
          )}
        </View>
        {item.purpose ? (
          <Text style={[styles.cardPurpose, { color: colors.textSecondary }]} numberOfLines={3}>
            {item.purpose}
          </Text>
        ) : null}
        <View style={styles.cardFooter}>
          <MaterialCommunityIcons name="account-multiple-outline" size={14} color={colors.textTertiary} />
          <Text style={[styles.cardMeta, { color: colors.textTertiary }]}>{item.memberCount}人</Text>
          <Text style={[styles.cardMetaSep, { color: colors.textTertiary }]}> ・ </Text>
          <MaterialCommunityIcons name="feather" size={14} color={colors.textTertiary} />
          <Text style={[styles.cardMeta, { color: colors.textTertiary }]}>{item.postCount ?? 0}首</Text>
        </View>
        {item.ownerDisplayName ? (
          <View style={styles.cardOwnerRow}>
            <Text style={[styles.cardOwnerLabel, { color: colors.textTertiary }]}>主宰</Text>
            <Text style={[styles.cardOwnerName, { color: colors.textTertiary }]} numberOfLines={1}>
              {item.ownerDisplayName}
              {item.ownerUserCode ? ` #${item.ownerUserCode}` : ''}
            </Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <GradientBackground style={styles.container}>
      {/* タブバー */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && { borderBottomColor: colors.accent }]}
            onPress={() => setTab(t.key)}
          >
            <AppText variant="buttonLabel" weight={tab === t.key ? 'medium' : 'regular'} tone={tab === t.key ? 'primary' : 'tertiary'}>
              {t.label}
            </AppText>
          </TouchableOpacity>
        ))}
      </View>

      {disabled ? (
        <View style={styles.emptyBox}>
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>{disabledMessage}</Text>
        </View>
      ) : loading ? (
        <View style={styles.emptyBox}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : errorMessage ? (
        <View style={styles.emptyBox}>
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>{errorMessage}</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            {tab === 'new' ? 'まだ公開歌会がありません' : '条件に合う歌会がありません'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
        />
      )}
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  list: { padding: 16, paddingBottom: 24 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardName: { flex: 1, fontSize: fs(17), fontFamily: 'NotoSerifJP_500Medium' },
  joinedBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginLeft: 8 },
  joinedBadgeText: { fontSize: 11, fontFamily: 'NotoSerifJP_400Regular' },
  cardPurpose: { fontSize: 13, lineHeight: 20, fontFamily: 'NotoSerifJP_400Regular', marginBottom: 10 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMeta: { fontSize: 12, fontFamily: 'NotoSerifJP_400Regular' },
  cardMetaSep: { fontSize: 12 },
  cardOwnerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  cardOwnerLabel: { fontSize: 11, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 2 },
  cardOwnerName: { flex: 1, fontSize: 12, fontFamily: 'NotoSerifJP_400Regular' },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22, fontFamily: 'NotoSerifJP_400Regular' },
});
