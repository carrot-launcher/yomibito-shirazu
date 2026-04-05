import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Alert, ScrollView } from 'react-native';
import { doc, getDoc, onSnapshot, collection, addDoc, setDoc, deleteDoc, updateDoc, increment, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { PostDoc, CommentDoc, REACTION_EMOJIS, ReactionEmoji } from '../types';

export default function TankaDetailScreen({ route }: any) {
  const { postId, groupId } = route.params;
  const { user } = useAuth();
  const [post, setPost] = useState<PostDoc | null>(null);
  const [comments, setComments] = useState<(CommentDoc & { id: string })[]>([]);
  const [commentText, setCommentText] = useState('');
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { return onSnapshot(doc(db, 'posts', postId), (snap) => { if (snap.exists()) setPost(snap.data() as PostDoc); }); }, [postId]);
  useEffect(() => { const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'desc')); return onSnapshot(q, (snap) => { setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as any))); }); }, [postId]);
  useEffect(() => { if (!user) return; return onSnapshot(doc(db, 'users', user.uid, 'bookmarks', postId), (snap) => setIsBookmarked(snap.exists())); }, [user, postId]);

  const handleReaction = async (emoji: ReactionEmoji) => {
    if (!user) return;
    const reactionRef = doc(db, 'posts', postId, 'reactions', `${user.uid}_${emoji}`);
    try {
      if (myReactions.has(emoji)) {
        await deleteDoc(reactionRef);
        await updateDoc(doc(db, 'posts', postId), { [`reactionSummary.${emoji}`]: increment(-1) });
        setMyReactions(prev => { const s = new Set(prev); s.delete(emoji); return s; });
      } else {
        const memberSnap = await getDoc(doc(db, 'groups', groupId, 'members', user.uid));
        const displayName = memberSnap.data()?.displayName || '歌人';
        await setDoc(reactionRef, { emoji, userId: user.uid, displayName, createdAt: serverTimestamp() });
        await updateDoc(doc(db, 'posts', postId), { [`reactionSummary.${emoji}`]: increment(1) });
        setMyReactions(prev => new Set(prev).add(emoji));
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
        await setDoc(bmRef, { groupId, groupName: groupSnap.data()?.name || '', tankaBody: post.body, createdAt: serverTimestamp() });
      }
    } catch (e: any) { Alert.alert('エラー', e.message); }
  };

  const handleComment = async () => {
    if (!user || !commentText.trim() || submitting) return;
    if (commentText.length > 200) { Alert.alert('200文字以内にしてください'); return; }
    setSubmitting(true);
    try {
      const commentRef = await addDoc(collection(db, 'posts', postId, 'comments'), { body: commentText.trim(), createdAt: serverTimestamp() });
      await setDoc(doc(db, 'posts', postId, 'comments', commentRef.id, 'private', 'author'), { authorId: user.uid });
      await updateDoc(doc(db, 'posts', postId), { commentCount: increment(1) });
      setCommentText('');
    } catch (e: any) { Alert.alert('エラー', e.message); }
    finally { setSubmitting(false); }
  };

  if (!post) return <View style={styles.container}><Text style={styles.loading}>読み込み中...</Text></View>;

  const timeAgo = (date: Date) => { const diff = Date.now() - date.getTime(); const min = Math.floor(diff / 60000); if (min < 1) return 'たった今'; if (min < 60) return `${min}分前`; const hr = Math.floor(min / 60); if (hr < 24) return `${hr}時間前`; return `${Math.floor(hr / 24)}日前`; };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.tankaArea}><Text style={styles.tankaBody}>{post.body}</Text></View>
      <View style={styles.reactionRow}>
        {REACTION_EMOJIS.map(emoji => {
          const count = post.reactionSummary?.[emoji] || 0;
          return (
            <TouchableOpacity key={emoji} style={[styles.reactionBtn, myReactions.has(emoji) && styles.reactionBtnActive]} onPress={() => handleReaction(emoji)}>
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              {count > 0 && <Text style={styles.reactionCount}>{count}</Text>}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={[styles.bookmarkBtn, isBookmarked && styles.bookmarkBtnActive]} onPress={handleBookmark}>
          <Text style={styles.bookmarkText}>{isBookmarked ? '🔖' : '📄'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.commentsSection}>
        <Text style={styles.commentsTitle}>評 ({post.commentCount || 0})</Text>
        {comments.map(c => (<View key={c.id} style={styles.commentCard}><Text style={styles.commentBody}>{c.body}</Text><Text style={styles.commentTime}>{c.createdAt ? timeAgo(c.createdAt.toDate()) : ''}</Text></View>))}
        {comments.length === 0 && <Text style={styles.noComments}>まだ評がありません</Text>}
      </View>
      <View style={styles.commentInput}>
        <TextInput style={styles.commentTextInput} value={commentText} onChangeText={setCommentText} placeholder="評を書く..." placeholderTextColor="#A69880" multiline maxLength={200} />
        <TouchableOpacity style={[styles.commentSubmit, !commentText.trim() && styles.commentSubmitDisabled]} onPress={handleComment} disabled={!commentText.trim() || submitting}>
          <Text style={styles.commentSubmitText}>送る</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' }, content: { padding: 20, paddingBottom: 40 },
  loading: { textAlign: 'center', marginTop: 40, color: '#8B7E6A' },
  tankaArea: { backgroundColor: '#FFFDF8', borderRadius: 16, padding: 32, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#E8E0D0' },
  tankaBody: { fontSize: 24, color: '#2C2418', lineHeight: 40, letterSpacing: 2, textAlign: 'center' },
  reactionRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  reactionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8' },
  reactionBtnActive: { backgroundColor: '#F0E8D8', borderColor: '#C4B8A0' },
  reactionEmoji: { fontSize: 20 }, reactionCount: { fontSize: 13, color: '#8B7E6A' },
  bookmarkBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8' },
  bookmarkBtnActive: { backgroundColor: '#F0E8D8', borderColor: '#C4B8A0' }, bookmarkText: { fontSize: 20 },
  commentsSection: { marginBottom: 20 },
  commentsTitle: { fontSize: 15, color: '#8B7E6A', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E8E0D0', paddingBottom: 8 },
  commentCard: { backgroundColor: '#FFFDF8', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#E8E0D0' },
  commentBody: { fontSize: 15, color: '#2C2418', lineHeight: 22, marginBottom: 4 }, commentTime: { fontSize: 11, color: '#A69880' },
  noComments: { textAlign: 'center', color: '#A69880', fontSize: 14, marginTop: 12 },
  commentInput: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  commentTextInput: { flex: 1, backgroundColor: '#FFFDF8', borderRadius: 10, padding: 12, fontSize: 15, color: '#2C2418', borderWidth: 1, borderColor: '#E8E0D0', maxHeight: 100, textAlignVertical: 'top' },
  commentSubmit: { backgroundColor: '#2C2418', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  commentSubmitDisabled: { opacity: 0.4 }, commentSubmitText: { color: '#F5F0E8', fontSize: 14 },
});
