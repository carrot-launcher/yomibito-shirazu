import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, orderBy, query, updateDoc, serverTimestamp } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { NotificationDoc } from '../types';

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

export default function TayoriScreen({ navigation }: any) {
  const { user } = useAuth();
  const [items, setItems] = useState<TayoriItem[]>([]);
  const [lastReadAt, setLastReadAt] = useState<Date | null>(null);

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
    }, () => {});
  }, [user]);

  // 画面フォーカス時に既読更新
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (!user || items.length === 0) return;
      updateDoc(doc(db, 'users', user.uid), {
        tayoriLastReadAt: serverTimestamp(),
      }).catch(() => {});
    });
    return unsub;
  }, [navigation, user, items.length]);

  const isUnread = (item: TayoriItem) => {
    if (!lastReadAt) return true;
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
        body = item.tankaBody?.slice(0, 25);
        break;
      case 'reaction':
        icon = 'flower-tulip';
        title = item.reactionCount && item.reactionCount > 1
          ? `あなたの歌に${item.emoji || '🌸'}が${item.reactionCount}件`
          : `あなたの歌に${item.emoji || '🌸'}`;
        break;
      case 'comment':
        icon = 'comment-text-outline';
        title = 'あなたの歌に評';
        body = item.commentBody?.slice(0, 25);
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

  return (
    <GradientBackground style={styles.container}>
      {items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MaterialCommunityIcons name="email-outline" size={48} color="#A69880" />
          <Text style={styles.emptyText}>まだたよりはありません</Text>
        </View>
      ) : (
        <FlatList
          data={items}
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
    fontSize: 14,
    color: '#8B7E6A',
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
    fontSize: 16,
    color: '#A69880',
  },
});
