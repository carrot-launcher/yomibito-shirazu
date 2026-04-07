import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, orderBy, query, updateDoc, serverTimestamp } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { NotificationDoc } from '../types';
import { stripRuby } from '../utils/formatTanka';

interface TayoriItem extends NotificationDoc {
  id: string;
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}日前`;
  return `${Math.floor(day / 30)}ヶ月前`;
}

type FilterType = 'all' | 'new_post' | 'reaction' | 'comment';

export default function TayoriScreen({ navigation }: any) {
  const { user } = useAuth();
  const { alert } = useAlert();
  const [items, setItems] = useState<TayoriItem[]>([]);
  const [lastReadAt, setLastReadAt] = useState<Date | null | undefined>(undefined);
  const [clearedAt, setClearedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');

  // 通知一覧をリアルタイムで取得
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      } as TayoriItem)));
    }, () => {});
  }, [user]);

  // lastReadAt を取得
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data();
      setLastReadAt(data?.tayoriLastReadAt?.toDate() || null);
      setClearedAt(data?.tayoriClearedAt?.toDate() || null);
    }, () => {});
  }, [user]);

  const visibleItems = useMemo(() => items.filter(i => {
    if (!clearedAt) return true;
    const itemDate = i.createdAt?.toDate?.();
    return itemDate ? itemDate > clearedAt : false;
  }), [items, clearedAt]);

  const handleDeleteAll = useCallback(() => {
    if (!user || visibleItems.length === 0) return;
    alert('たよりを全て削除', '全てのたよりを削除しますか？', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '削除', style: 'destructive', onPress: async () => {
          try {
            await updateDoc(doc(db, 'users', user.uid), { tayoriClearedAt: serverTimestamp() });
          } catch {}
        },
      },
    ]);
  }, [user, visibleItems.length, alert]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => visibleItems.length > 0 ? (
        <TouchableOpacity onPress={handleDeleteAll} hitSlop={8} style={{ padding: 8 }}>
          <MaterialCommunityIcons name="delete-outline" size={22} color="#8B7E6A" />
        </TouchableOpacity>
      ) : null,
    });
  }, [navigation, visibleItems.length, handleDeleteAll]);

  // 画面を離れた時に既読更新（focusだと未読が即座に消えてしまう）
  useEffect(() => {
    const unsub = navigation.addListener('blur', () => {
      if (!user) return;
      updateDoc(doc(db, 'users', user.uid), {
        tayoriLastReadAt: serverTimestamp(),
      }).catch(() => {});
    });
    return unsub;
  }, [navigation, user]);

  const isUnread = (item: TayoriItem) => {
    if (lastReadAt === undefined) return false; // まだロード中
    if (!lastReadAt) return true; // 一度も既読にしていない
    const itemDate = item.createdAt?.toDate?.();
    return itemDate ? itemDate > lastReadAt : false;
  };

  const handleTap = (item: TayoriItem) => {
    navigation.navigate('TankaDetail', { postId: item.postId, groupId: item.groupId });
  };

  const renderItem = ({ item }: { item: TayoriItem }) => {
    const unread = isUnread(item);
    let icon: string;
    let title: string;
    let body: string | undefined;

    switch (item.type) {
      case 'new_post':
        icon = 'pen';
        title = `${item.groupName}に新しい歌`;
        body = stripRuby(item.tankaBody || '').replace(/[\n\r]+/g, '\u3000') || undefined;
        break;
      case 'reaction':
        icon = 'flower-tulip';
        title = item.reactionCount && item.reactionCount > 1
          ? `あなたの歌に${item.emoji || '🌸'}が${item.reactionCount}件`
          : `あなたの歌に${item.emoji || '🌸'}`;
        body = stripRuby(item.tankaBody || '').replace(/[\n\r]+/g, '\u3000') || undefined;
        break;
      case 'comment':
        icon = 'comment-text-outline';
        title = 'あなたの歌に評';
        body = item.commentBody && item.commentBody.length > 50
          ? item.commentBody.slice(0, 50) + '…'
          : item.commentBody;
        break;
      default:
        icon = 'bell-outline';
        title = 'たより';
    }

    const createdAt = item.createdAt?.toDate?.();

    return (
      <TouchableOpacity
        style={[styles.item, unread && styles.itemUnread]}
        onPress={() => handleTap(item)}
        activeOpacity={0.6}
      >
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name={icon as any} size={20} color={unread ? '#2C2418' : '#A69880'} />
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>{title}</Text>
          {body ? <Text style={styles.body} numberOfLines={1}>{body}</Text> : null}
        </View>
        {createdAt && <Text style={styles.time}>{timeAgo(createdAt)}</Text>}
      </TouchableOpacity>
    );
  };

  const filteredItems = filter === 'all' ? visibleItems : visibleItems.filter(i => i.type === filter);

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'new_post', label: '歌' },
    { key: 'reaction', label: '🌸' },
    { key: 'comment', label: '評' },
  ];

  return (
    <GradientBackground style={styles.container}>
      <View style={styles.segmentBar}>
        {filters.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.segment, filter === f.key && styles.segmentActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.segmentText, filter === f.key && styles.segmentTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {filteredItems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{visibleItems.length === 0 ? 'まだたよりはありません' : 'このたよりはありません'}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  segmentBar: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: '#E8E0D0', borderRadius: 8, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: '#FFFDF8' },
  segmentText: { fontSize: 15, color: '#8B7E6A', fontFamily: 'NotoSerifJP_400Regular' },
  segmentTextActive: { color: '#2C2418', fontWeight: '500', fontFamily: 'NotoSerifJP_500Medium' },
  list: { paddingVertical: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D0',
  },
  itemUnread: {
    backgroundColor: 'rgba(255, 253, 248, 0.6)',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8E0D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    color: '#8B7E6A',
    fontFamily: 'NotoSerifJP_400Regular',
  },
  titleUnread: {
    color: '#2C2418',
    fontWeight: '500',
  },
  body: {
    fontSize: 13,
    color: '#A69880',
    marginTop: 2,
  },
  time: {
    fontSize: 11,
    color: '#A69880',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 17,
    color: '#A69880',
    fontFamily: 'NotoSerifJP_500Medium',
  },
});
