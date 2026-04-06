import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  addDoc,
  collection,
  deleteDoc,
  doc, getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useState } from 'react';
import {
  Alert, ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { CommentDoc, PostDoc, REACTION_EMOJI } from '../types';

export default function TankaDetailScreen({ route, navigation }: any) {
  const { postId, groupId } = route.params;
  const { user } = useAuth();
  const [post, setPost] = useState<PostDoc | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [comments, setComments] = useState<(CommentDoc & { id: string })[]>([]);
  const [commentText, setCommentText] = useState('');
  const [hasReacted, setHasReacted] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [groupExists, setGroupExists] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 投稿データ
  useEffect(() => {
    return onSnapshot(doc(db, 'posts', postId), (snap) => {
      if (snap.exists()) {
        setPost(snap.data() as PostDoc);
        setDeleted(false);
      } else {
        setDeleted(true);
      }
    }, () => {
      // パーミッションエラー等の場合も削除扱い
      setDeleted(true);
    });
  }, [postId]);

  // 評一覧
  useEffect(() => {
    const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });
  }, [postId]);

  // 自分のリアクション状態を確認
  useEffect(() => {
    if (!user) return;
    const reactionRef = doc(db, 'posts', postId, 'reactions', `${user.uid}_${REACTION_EMOJI}`);
    getDoc(reactionRef).then(snap => {
      setHasReacted(snap.exists());
    }).catch(() => {
      // ドキュメントが存在しない場合も false
      setHasReacted(false);
    });
  }, [user, postId]);

  // 栞の状態
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'users', user.uid, 'bookmarks', postId),
      (snap) => setIsBookmarked(snap.exists())
    );
  }, [user, postId]);

  // 歌会が存在するか確認（解散済みならリアクション・評を無効化）
  useEffect(() => {
    getDoc(doc(db, 'groups', groupId)).then(snap => setGroupExists(snap.exists()));
  }, [groupId]);

  const handleReaction = async () => {
    if (!user) return;
    const reactionRef = doc(db, 'posts', postId, 'reactions', `${user.uid}_${REACTION_EMOJI}`);
    try {
      if (hasReacted) {
        await deleteDoc(reactionRef);
        await updateDoc(doc(db, 'posts', postId), {
          [`reactionSummary.${REACTION_EMOJI}`]: increment(-1),
        });
        setHasReacted(false);
      } else {
        const memberSnap = await getDoc(doc(db, 'groups', groupId, 'members', user.uid));
        const displayName = memberSnap.data()?.displayName || '歌人';
        await setDoc(reactionRef, {
          emoji: REACTION_EMOJI,
          userId: user.uid,
          displayName,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'posts', postId), {
          [`reactionSummary.${REACTION_EMOJI}`]: increment(1),
        });
        setHasReacted(true);
      }
    } catch (e: any) { Alert.alert('エラー', e.message); }
  };

  const handleBookmark = async () => {
    if (!user || !post) return;
    const bmRef = doc(db, 'users', user.uid, 'bookmarks', postId);
    try {
      if (isBookmarked) { await deleteDoc(bmRef); }
      else {
        const groupSnap = await getDoc(doc(db, 'groups', groupId));
        await setDoc(bmRef, {
          groupId, groupName: groupSnap.data()?.name || '',
          tankaBody: post.body, createdAt: serverTimestamp(),
        });
      }
    } catch (e: any) { Alert.alert('エラー', e.message); }
  };

  const handleDelete = async () => {
    Alert.alert(
      'この歌を削除しますか？',
      'この歌会からこの歌が削除されます。リアクションや評も削除されます。',
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: '削除する', style: 'destructive',
          onPress: async () => {
            try {
              const functions = getFunctions(undefined, 'asia-northeast1');
              const deletePostFn = httpsCallable(functions, 'deletePost');
              await deletePostFn({ postId });
              navigation.goBack();
            } catch (e: any) {
              const msg = e.message?.includes('permission-denied')
                ? '自分の歌のみ削除できます'
                : e.message;
              Alert.alert('エラー', msg);
            }
          },
        },
      ]
    );
  };

  const handleComment = async () => {
    if (!user || !commentText.trim() || submitting) return;
    if (commentText.length > 200) { Alert.alert('200文字以内にしてください'); return; }
    setSubmitting(true);
    try {
      const commentRef = await addDoc(collection(db, 'posts', postId, 'comments'), {
        body: commentText.trim(), createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'posts', postId, 'comments', commentRef.id, 'private', 'author'), {
        authorId: user.uid,
      });
      await updateDoc(doc(db, 'posts', postId), { commentCount: increment(1) });
      setCommentText('');
    } catch (e: any) { Alert.alert('エラー', e.message); }
    finally { setSubmitting(false); }
  };

  // 削除済みの投稿: ブックマークとmyPostsを自動削除
  useEffect(() => {
    if (!deleted || !user) return;
    deleteDoc(doc(db, 'users', user.uid, 'bookmarks', postId)).catch(() => {});
    getDocs(query(collection(db, 'users', user.uid, 'myPosts'), where('postId', '==', postId)))
      .then(snap => { for (const d of snap.docs) deleteDoc(d.ref); })
      .catch(() => {});
  }, [deleted, user, postId]);

  if (deleted) return (
    <View style={styles.container}>
      <View style={styles.deletedArea}>
        <Text style={styles.deletedText}>この歌は削除されました</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>戻る</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (!post) return <View style={styles.container}><Text style={styles.loading}>読み込み中...</Text></View>;

  const timeAgo = (date: Date) => {
    const diff = Date.now() - date.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'たった今';
    if (min < 60) return `${min}分前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}時間前`;
    return `${Math.floor(hr / 24)}日前`;
  };

  const reactionCount = post.reactionSummary?.[REACTION_EMOJI] || 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.tankaArea}>
        <Text style={styles.tankaBody}>{post.body}</Text>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.reactionBtn, hasReacted && styles.reactionBtnActive]}
          onPress={groupExists ? handleReaction : undefined}
          activeOpacity={groupExists ? 0.2 : 1}
        >
          <Text style={styles.reactionEmoji}>{REACTION_EMOJI}</Text>
          {reactionCount > 0 && <Text style={styles.reactionCount}>{reactionCount}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bookmarkBtn, isBookmarked && styles.bookmarkBtnActive]}
          onPress={handleBookmark}
        >
          <MaterialCommunityIcons name={isBookmarked ? 'bookmark' : 'bookmark-outline'} size={22} color="#2C2418" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <MaterialCommunityIcons name="delete-outline" size={22} color="#2C2418" />
        </TouchableOpacity>
      </View>

      <View style={styles.commentsSection}>
        <Text style={styles.commentsTitle}>評 ({post.commentCount || 0})</Text>
        {comments.map(c => (
          <TouchableOpacity
            key={c.id}
            style={styles.commentCard}
            onLongPress={!groupExists ? undefined : () => {
              Alert.alert(
                'この評を削除しますか？',
                '自分の評のみ削除できます。他の人の評は削除できません。',
                [
                  { text: 'やめる', style: 'cancel' },
                  {
                    text: '削除する', style: 'destructive',
                    onPress: async () => {
                      try {
                        const functions = getFunctions(undefined, 'asia-northeast1');
                        const deleteCommentFn = httpsCallable(functions, 'deleteComment');
                        await deleteCommentFn({ postId, commentId: c.id });
                      } catch (e: any) {
                        const msg = e.message?.includes('permission-denied')
                          ? '自分の評のみ削除できます'
                          : e.message;
                        Alert.alert('エラー', msg);
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.commentBody}>{c.body}</Text>
            <Text style={styles.commentTime}>
              {c.createdAt ? timeAgo(c.createdAt.toDate()) : ''}
            </Text>
          </TouchableOpacity>
        ))}
        {comments.length === 0 && <Text style={styles.noComments}>まだ評がありません</Text>}
      </View>

      {groupExists && (
        <View style={styles.commentInput}>
          <TextInput
            style={styles.commentTextInput}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="評を書く..."
            placeholderTextColor="#A69880"
            multiline maxLength={200}
          />
          <TouchableOpacity
            style={[styles.commentSubmit, !commentText.trim() && styles.commentSubmitDisabled]}
            onPress={handleComment}
            disabled={!commentText.trim() || submitting}
          >
            <Text style={styles.commentSubmitText}>送る</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  content: { padding: 20, paddingBottom: 40 },
  loading: { textAlign: 'center', marginTop: 40, color: '#8B7E6A' },
  tankaArea: {
    backgroundColor: '#FFFDF8', borderRadius: 16, padding: 32,
    alignItems: 'center', marginBottom: 20,
    borderWidth: 1, borderColor: '#E8E0D0',
  },
  tankaBody: { fontSize: 24, color: '#2C2418', lineHeight: 40, letterSpacing: 2, textAlign: 'center' },
  actionRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 12, marginBottom: 24,
  },
  reactionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 24, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8',
  },
  reactionBtnActive: { backgroundColor: '#F0E8D8', borderColor: '#C4B8A0' },
  reactionEmoji: { fontSize: 22 },
  reactionCount: { fontSize: 15, color: '#8B7E6A' },
  bookmarkBtn: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 24, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8',
  },
  bookmarkBtnActive: { backgroundColor: '#F0E8D8', borderColor: '#C4B8A0' },
  bookmarkText: { fontSize: 22 },
  deleteBtn: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 24, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8',
  },
  deleteText: { fontSize: 22 },
  commentsSection: { marginBottom: 20 },
  commentsTitle: {
    fontSize: 15, color: '#8B7E6A', marginBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#E8E0D0', paddingBottom: 8,
  },
  commentCard: {
    backgroundColor: '#FFFDF8', borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: '#E8E0D0',
  },
  commentBody: { fontSize: 15, color: '#2C2418', lineHeight: 22, marginBottom: 4 },
  commentTime: { fontSize: 11, color: '#A69880' },
  noComments: { textAlign: 'center', color: '#A69880', fontSize: 14, marginTop: 12 },
  commentInput: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  commentTextInput: {
    flex: 1, backgroundColor: '#FFFDF8', borderRadius: 10, padding: 12,
    fontSize: 15, color: '#2C2418', borderWidth: 1, borderColor: '#E8E0D0',
    maxHeight: 100, textAlignVertical: 'top',
  },
  commentSubmit: { backgroundColor: '#2C2418', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  commentSubmitDisabled: { opacity: 0.4 },
  commentSubmitText: { color: '#F5F0E8', fontSize: 14 },
  deletedArea: { alignItems: 'center', marginTop: 80 },
  deletedText: { fontSize: 16, color: '#8B7E6A', marginBottom: 20 },
  backBtn: { backgroundColor: '#2C2418', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  backBtnText: { color: '#F5F0E8', fontSize: 15 },
});