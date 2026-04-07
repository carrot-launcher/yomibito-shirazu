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
import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { CommentDoc, PostDoc, REACTION_EMOJI } from '../types';
import { compressNewlines, formatTankaBody } from '../utils/formatTanka';

function rubyToHtml(escaped: string): string {
  return escaped.replace(/\{([^|{}]+)\|([^|{}]+)\}/g,
    '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>');
}

function buildDetailHtml(body: string, comments: { body: string; time: string; id: string }[]): string {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const commentsJson = JSON.stringify(comments.map(c => ({ ...c, body: escapeHtml(c.body) })));

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    background: transparent;
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .container {
    display: inline-flex;
    flex-direction: row-reverse;
    height: 100%;
    min-width: 100%;
    padding: 20px 16px;
    gap: 0;
  }
  .tanka-section {
    -webkit-writing-mode: vertical-rl;
    writing-mode: vertical-rl;
    font-size: 22px;
    line-height: 2.0;
    letter-spacing: 0.12em;
    color: #2C2418;
    padding: 8px 12px;
    white-space: pre-wrap;
    flex-shrink: 0;
  }
  .tanka-section rt { font-size: 0.45em; letter-spacing: 0; }
  .divider {
    width: 1px;
    background: #E8E0D0;
    margin: 16px 12px;
    flex-shrink: 0;
  }
  .comments-section {
    display: flex;
    flex-direction: row-reverse;
    gap: 4px;
    flex-shrink: 0;
  }
  .comment-item {
    -webkit-writing-mode: vertical-rl;
    writing-mode: vertical-rl;
    font-size: 15px;
    line-height: 1.8;
    letter-spacing: 0.05em;
    color: #2C2418;
    padding: 8px 6px;
    white-space: pre-wrap;
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .comment-item:active { background: rgba(0,0,0,0.04); }
  .fold-hint {
    font-size: 12px;
    color: #A69880;
    margin-top: 4px;
  }
  .comment-time {
    font-size: 10px;
    color: #A69880;
    margin-top: 8px;
  }
  .no-comments {
    -webkit-writing-mode: vertical-rl;
    writing-mode: vertical-rl;
    font-size: 14px;
    color: #A69880;
    padding: 8px 12px;
  }
</style>
</head>
<body>
<div class="container" id="container">
  <div class="tanka-section" onclick="window.ReactNativeWebView.postMessage(JSON.stringify({action:'screenshot'}))">${rubyToHtml(escapeHtml(body))}</div>
  <div class="divider"></div>
  <div class="comments-section" id="comments"></div>
</div>
<script>
const comments = ${commentsJson};
const commentsEl = document.getElementById("comments");
if (comments.length === 0) {
  commentsEl.innerHTML = '<div class="no-comments">まだ評がありません</div>';
} else {
  comments.forEach(c => {
    const el = document.createElement("div");
    el.className = "comment-item";

    var bodyLines = c.body.split('\\n');
    var needsFold = bodyLines.length > 6;
    var shortBody = needsFold ? bodyLines.slice(0, 6).join('\\n') : null;
    var expanded = !needsFold;

    function renderComment() {
      var displayBody = expanded ? c.body : shortBody;
      el.innerHTML = displayBody +
        (needsFold ? '<div class="fold-hint">' + (expanded ? '▲ 閉じる' : '▼ 続きを読む') + '</div>' : '') +
        '<div class="comment-time">' + c.time + '</div>';
    }
    renderComment();

    var pressTimer = null;
    var longPressed = false;
    el.addEventListener('touchstart', function(e) {
      longPressed = false;
      pressTimer = setTimeout(function() {
        longPressed = true;
        window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'deleteComment', commentId: c.id }));
      }, 600);
    });
    el.addEventListener('touchend', function() {
      clearTimeout(pressTimer);
      if (!longPressed && needsFold) {
        expanded = !expanded;
        renderComment();
      }
    });
    el.addEventListener('touchmove', function() { clearTimeout(pressTimer); });
    commentsEl.appendChild(el);
  });
}
setTimeout(() => { document.body.scrollLeft = document.body.scrollWidth; }, 50);
</script>
</body>
</html>`;
}

export default function TankaDetailScreen({ route, navigation }: any) {
  const { postId, groupId, batchId } = route.params;
  const { user } = useAuth();
  const [post, setPost] = useState<PostDoc | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [comments, setComments] = useState<(CommentDoc & { id: string })[]>([]);
  const [commentText, setCommentText] = useState('');
  const [hasReacted, setHasReacted] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [groupExists, setGroupExists] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [batchPostIds, setBatchPostIds] = useState<string[]>([]);
  const [extraReactions, setExtraReactions] = useState(0);
  const { alert } = useAlert();
  const webViewRef = useRef<WebView>(null);
  const fromMyPosts = !!route.params.fromMyPosts;

  // batchIdがある場合、全postIdを取得
  useEffect(() => {
    if (!batchId || !user) { setBatchPostIds([postId]); return; }
    getDocs(query(collection(db, 'users', user.uid, 'myPosts'), where('batchId', '==', batchId)))
      .then(snap => {
        const ids = snap.docs.map(d => (d.data() as any).postId);
        setBatchPostIds(ids.length > 0 ? ids : [postId]);
      })
      .catch(() => setBatchPostIds([postId]));
  }, [batchId, user, postId]);

  // 投稿データ（メインpost）
  useEffect(() => {
    return onSnapshot(doc(db, 'posts', postId), (snap) => {
      if (snap.exists()) {
        setPost(snap.data() as PostDoc);
        setDeleted(false);
      } else {
        setDeleted(true);
      }
    }, () => {
      setDeleted(true);
    });
  }, [postId]);

  // batchIdがある場合、他postのリアクション数を取得
  useEffect(() => {
    if (batchPostIds.length <= 1) { setExtraReactions(0); return; }
    const otherIds = batchPostIds.filter(id => id !== postId);
    Promise.all(otherIds.map(id => getDoc(doc(db, 'posts', id)).catch(() => null)))
      .then(snaps => {
        let total = 0;
        snaps.forEach(snap => {
          if (snap?.exists()) {
            total += (snap.data() as PostDoc).reactionSummary?.[REACTION_EMOJI] || 0;
          }
        });
        setExtraReactions(total);
      });
  }, [batchPostIds, postId]);

  // 評一覧（全postの評をマージ）
  useEffect(() => {
    if (batchPostIds.length === 0) return;
    const unsubs = batchPostIds.map(pid => {
      const q = query(collection(db, 'posts', pid, 'comments'), orderBy('createdAt', 'desc'));
      return onSnapshot(q, (snap) => {
        const newComments = snap.docs.map(d => ({ id: d.id, postId: pid, ...d.data() } as any));
        setComments(prev => {
          const others = prev.filter((c: any) => c.postId !== pid);
          return [...others, ...newComments].sort((a, b) =>
            (b.createdAt?.toDate?.()?.getTime() || 0) - (a.createdAt?.toDate?.()?.getTime() || 0)
          );
        });
      }, () => {});
    });
    return () => unsubs.forEach(u => u());
  }, [batchPostIds]);

  // 自分のリアクション状態を確認（いずれかのpostにリアクション済みか）
  useEffect(() => {
    if (!user || batchPostIds.length === 0) return;
    Promise.all(batchPostIds.map(pid =>
      getDoc(doc(db, 'posts', pid, 'reactions', `${user.uid}_${REACTION_EMOJI}`)).catch(() => null)
    )).then(snaps => {
      setHasReacted(snaps.some(s => s?.exists()));
    });
  }, [user, batchPostIds]);

  // 栞の状態
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'users', user.uid, 'bookmarks', postId),
      (snap) => setIsBookmarked(snap.exists()),
      () => {}
    );
  }, [user, postId]);

  // 歌会が存在するか確認
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
    } catch (e: any) { alert('エラー', e.message); }
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
    } catch (e: any) { alert('エラー', e.message); }
  };

  const handleDelete = async () => {
    const isBatch = !!batchId;
    alert(
      'この歌を削除しますか？',
      isBatch ? 'すべての歌会からこの歌が削除されます。' : 'この歌会からこの歌が削除されます。リアクションや評も削除されます。',
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: '削除する', style: 'destructive',
          onPress: async () => {
            try {
              const functions = getFunctions(undefined, 'asia-northeast1');
              const deletePostFn = httpsCallable(functions, 'deletePost');
              if (isBatch && user) {
                const myPostsSnap = await getDocs(query(collection(db, 'users', user.uid, 'myPosts'), where('batchId', '==', batchId)));
                const postIds = myPostsSnap.docs.map(d => (d.data() as any).postId);
                await Promise.all(postIds.map(pid => deletePostFn({ postId: pid })));
              } else {
                await deletePostFn({ postId });
              }
              navigation.goBack();
            } catch (e: any) {
              const msg = e.message?.includes('permission-denied')
                ? '自分の歌のみ削除できます'
                : e.message;
              alert('エラー', msg);
            }
          },
        },
      ]
    );
  };

  const handleDeleteComment = (commentId: string) => {
    if (!groupExists) return;
    alert(
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
              const comment = comments.find(c => c.id === commentId);
              const targetPostId = (comment as any)?.postId || postId;
              await deleteCommentFn({ postId: targetPostId, commentId });
            } catch (e: any) {
              const msg = e.message?.includes('permission-denied')
                ? '自分の評のみ削除できます'
                : e.message;
              alert('エラー', msg);
            }
          },
        },
      ]
    );
  };

  const handleComment = async () => {
    if (!user || !commentText.trim() || submitting) return;
    if (commentText.length > 500) { alert('500文字以内にしてください'); return; }
    setSubmitting(true);
    try {
      const commentRef = await addDoc(collection(db, 'posts', postId, 'comments'), {
        body: compressNewlines(commentText.trim()), createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'posts', postId, 'comments', commentRef.id, 'private', 'author'), {
        authorId: user.uid,
      });
      await updateDoc(doc(db, 'posts', postId), { commentCount: increment(1) });
      setCommentText('');
    } catch (e: any) { alert('エラー', e.message); }
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

  const reactionCount = (post.reactionSummary?.[REACTION_EMOJI] || 0) + extraReactions;

  const displayBody = formatTankaBody(post.body, 'detail', {
    convertHalfSpace: post.convertHalfSpace,
    convertLineBreak: post.convertLineBreak,
  });

  const commentData = comments.map(c => ({
    id: c.id,
    body: c.body,
    time: c.createdAt ? timeAgo(c.createdAt.toDate()) : '',
  }));

  const html = buildDetailHtml(displayBody, commentData);

  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.action === 'screenshot') {
        navigation.navigate('Screenshot', { body: displayBody });
      } else if (data.action === 'deleteComment') {
        handleDeleteComment(data.commentId);
      }
    } catch {}
  };

  return (
    <GradientBackground style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.actionRow}>
          {!fromMyPosts && (
            <TouchableOpacity
              style={[styles.reactionBtn, hasReacted && styles.reactionBtnActive]}
              onPress={groupExists ? handleReaction : undefined}
              activeOpacity={groupExists ? 0.2 : 1}
            >
              <Text style={styles.reactionEmoji}>{REACTION_EMOJI}</Text>
              {reactionCount > 0 && <Text style={styles.reactionCount}>{reactionCount}</Text>}
            </TouchableOpacity>
          )}

          {!fromMyPosts && (
            <TouchableOpacity
              style={[styles.bookmarkBtn, isBookmarked && styles.bookmarkBtnActive]}
              onPress={handleBookmark}
            >
              <MaterialCommunityIcons name={isBookmarked ? 'bookmark' : 'bookmark-outline'} size={20} color="#2C2418" />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <MaterialCommunityIcons name="delete-outline" size={20} color="#2C2418" />
          </TouchableOpacity>

          <Text style={styles.commentLabel}>評 {comments.length}</Text>
        </View>

        {groupExists && (
          <>
            <View style={styles.commentInput}>
              <TextInput
                style={styles.commentTextInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="評を書く..."
                placeholderTextColor="#A69880"
                multiline maxLength={500}
              />
              <TouchableOpacity
                style={[styles.commentSubmit, !commentText.trim() && styles.commentSubmitDisabled]}
                onPress={handleComment}
                disabled={!commentText.trim() || submitting}
              >
                <Text style={styles.commentSubmitText}>送る</Text>
              </TouchableOpacity>
            </View>
            {commentText.length > 0 && (
              <Text style={styles.charCount}>{commentText.length}/500</Text>
            )}
          </>
        )}
      </View>

      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        onMessage={handleWebViewMessage}
        scrollEnabled={true}
        showsHorizontalScrollIndicator={false}
        javaScriptEnabled={true}
        originWhitelist={['*']}
        androidLayerType="software"
      />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { textAlign: 'center', marginTop: 40, color: '#8B7E6A' },
  topBar: {
    borderBottomWidth: 1, borderBottomColor: '#E8E0D0',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  reactionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8',
  },
  reactionBtnActive: { backgroundColor: '#F0E8D8', borderColor: '#C4B8A0' },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { fontSize: 13, color: '#8B7E6A' },
  bookmarkBtn: {
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8',
  },
  bookmarkBtnActive: { backgroundColor: '#F0E8D8', borderColor: '#C4B8A0' },
  deleteBtn: {
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8',
  },
  commentLabel: { fontSize: 14, color: '#8B7E6A', marginLeft: 'auto', fontFamily: 'NotoSerifJP_400Regular' },
  commentInput: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 10 },
  commentTextInput: {
    flex: 1, backgroundColor: '#FFFDF8', borderRadius: 10, padding: 10,
    fontSize: 15, color: '#2C2418', borderWidth: 1, borderColor: '#E8E0D0',
    maxHeight: 80, textAlignVertical: 'top',
  },
  commentSubmit: { backgroundColor: '#2C2418', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  commentSubmitDisabled: { opacity: 0.4 },
  commentSubmitText: { color: '#F5F0E8', fontSize: 15, fontFamily: 'NotoSerifJP_500Medium' },
  charCount: { fontSize: 12, color: '#A69880', textAlign: 'right', marginTop: 4 },
  webview: { flex: 1, backgroundColor: 'transparent' },
  deletedArea: { alignItems: 'center', marginTop: 80 },
  deletedText: { fontSize: 17, color: '#8B7E6A', marginBottom: 20, fontFamily: 'NotoSerifJP_500Medium' },
  backBtn: { backgroundColor: '#2C2418', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  backBtnText: { color: '#F5F0E8', fontSize: 16, fontFamily: 'NotoSerifJP_500Medium' },
});
