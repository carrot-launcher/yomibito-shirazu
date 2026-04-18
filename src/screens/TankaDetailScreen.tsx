import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { CommentDoc, PostDoc, REACTION_EMOJI } from '../types';
import { compressNewlines, formatTankaBody } from '../utils/formatTanka';

function rubyToHtml(escaped: string): string {
  return escaped.replace(/\{([^|{}]+)\|([^|{}]+)\}/g,
    '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>');
}

function hogoLabel(type: string | undefined, reason: string | undefined): string {
  if (type === 'pending') return '現在確認中です';
  return '反故——' + (reason || '仔細あり');
}

function buildDetailHtml(
  body: string,
  comments: { body: string; time: string; id: string; hogo?: boolean; hogoReason?: string; hogoType?: string }[],
  isHogo: boolean,
  hogoReason: string | undefined,
  hogoType: string | undefined,
  colors: ThemeColors,
): string {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const commentsJson = JSON.stringify(comments.map(c => ({
    ...c,
    body: c.hogo ? '' : escapeHtml(c.body),
    hogo: !!c.hogo,
    hogoLabel: escapeHtml(hogoLabel(c.hogoType, c.hogoReason)),
  })));

  const tankaContent = isHogo
    ? `<span class="hogo-text">${escapeHtml(hogoLabel(hogoType, hogoReason))}</span>`
    : rubyToHtml(escapeHtml(body));

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    height: 100%;
    background: ${colors.webViewBg};
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif;
    overflow-x: auto;
    overflow-y: hidden;
  }
  body { visibility: hidden; }
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
    color: ${colors.text};
    padding: 8px 12px;
    white-space: pre-wrap;
    flex-shrink: 0;
  }
  .tanka-section rt { font-size: 0.45em; letter-spacing: 0; }
  .hogo-text {
    font-style: italic;
    color: ${colors.textTertiary};
    font-size: 0.8em;
  }
  .divider {
    width: 1px;
    background: ${colors.border};
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
    color: ${colors.text};
    padding: 8px 6px;
    white-space: pre-wrap;
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .comment-item:active { background: ${colors.cardPress}; }
  .comment-hogo {
    font-style: italic;
    color: ${colors.textTertiary};
  }
  .fold-hint {
    font-size: 12px;
    color: ${colors.textTertiary};
    margin-top: 4px;
  }
  .comment-time {
    font-size: 10px;
    color: ${colors.textTertiary};
    margin-top: 8px;
  }
  .no-comments {
    -webkit-writing-mode: vertical-rl;
    writing-mode: vertical-rl;
    font-size: 14px;
    color: ${colors.textTertiary};
    padding: 8px 12px;
  }
</style>
</head>
<body>
<div class="container" id="container">
  <div class="tanka-section" onclick="${isHogo ? '' : "window.ReactNativeWebView.postMessage(JSON.stringify({action:'screenshot'}))"}">${tankaContent}</div>
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
    el.className = "comment-item" + (c.hogo ? " comment-hogo" : "");

    if (c.hogo) {
      el.innerHTML = (c.hogoLabel || ('反故——' + (c.hogoReason || '仔細あり'))) +
        '<div class="comment-time">' + c.time + '</div>';
      // 反故の評は長押しメニューを出さない
      commentsEl.appendChild(el);
      return;
    }

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
        window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'commentMenu', commentId: c.id }));
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

// 初期スクロール: コンテンツ生成完了後、右端にスクロール → 表示
requestAnimationFrame(function() {
  document.body.scrollLeft = document.body.scrollWidth;
  document.body.style.visibility = 'visible';
});
</script>
</body>
</html>`;
}

export default function TankaDetailScreen({ route, navigation }: any) {
  const { postId, groupId, batchId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, myAuthorHandle, blockedHandles, blockedByHandles } = useAuth();
  const [post, setPost] = useState<PostDoc | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [comments, setComments] = useState<(CommentDoc & { id: string })[]>([]);
  const [commentText, setCommentText] = useState('');
  const [hasReacted, setHasReacted] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [groupExists, setGroupExists] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [batchPostIds, setBatchPostIds] = useState<string[]>([]);
  const [extraReactions, setExtraReactions] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const { alert } = useAlert();
  const webViewRef = useRef<WebView>(null);
  const fromMyPosts = !!route.params.fromMyPosts;

  // 三点リーダメニュー
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTargetComment, setMenuTargetComment] = useState<string | null>(null);

  // 裁き確認ダイアログ
  const [judgmentModal, setJudgmentModal] = useState<'caution' | 'ban' | null>(null);
  const [judgmentReason, setJudgmentReason] = useState('');
  const [judging, setJudging] = useState(false);
  // 裁きの対象を記憶
  const [judgmentTarget, setJudgmentTarget] = useState<{ type: 'post' | 'comment'; commentId?: string }>({ type: 'post' });

  // 通報モーダル
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment'; commentId?: string }>({ type: 'post' });
  const [reportReason, setReportReason] = useState<'inappropriate' | 'spam' | 'harassment' | 'other' | null>(null);
  const [reportDetail, setReportDetail] = useState('');
  const [reporting, setReporting] = useState(false);

  // オーナーか確認
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'groups', groupId, 'members', user.uid)).then(snap => {
      if (snap.exists()) setIsOwner(snap.data()?.role === 'owner');
    }).catch(() => {});
  }, [user, groupId]);

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
    if (!user || reacting) return;
    setReacting(true);
    const wasReacted = hasReacted;
    // 楽観的UI更新: 即座に見た目を変える
    setHasReacted(!wasReacted);
    const reactionRef = doc(db, 'posts', postId, 'reactions', `${user.uid}_${REACTION_EMOJI}`);
    try {
      if (wasReacted) {
        await deleteDoc(reactionRef);
        await updateDoc(doc(db, 'posts', postId), {
          [`reactionSummary.${REACTION_EMOJI}`]: increment(-1),
        });
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
      }
    } catch (e: any) {
      // 失敗時は元に戻す
      setHasReacted(wasReacted);
      alert('エラー', e.message);
    } finally {
      setReacting(false);
    }
  };

  const [bookmarking, setBookmarking] = useState(false);
  const handleBookmark = async () => {
    if (!user || !post || bookmarking) return;
    setBookmarking(true);
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
    finally { setBookmarking(false); }
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

  const openPostMenu = () => {
    setMenuTargetComment(null);
    setMenuVisible(true);
  };

  const openCommentMenu = (commentId: string) => {
    setMenuTargetComment(commentId);
    setMenuVisible(true);
  };

  const openJudgmentModal = (type: 'caution' | 'ban', target: 'post' | 'comment', commentId?: string) => {
    setMenuVisible(false);
    setJudgmentTarget({ type: target, commentId });
    setJudgmentReason('');
    // 少し遅延を入れてモーダルの切り替えをスムーズに
    setTimeout(() => setJudgmentModal(type), 200);
  };

  const handleJudge = async () => {
    if (!user || !judgmentModal || judging) return;
    setJudging(true);
    try {
      const functions = getFunctions(undefined, 'asia-northeast1');
      const judgeContentFn = httpsCallable(functions, 'judgeContent');
      const targetPostId = judgmentTarget.type === 'comment'
        ? (comments.find(c => c.id === judgmentTarget.commentId) as any)?.postId || postId
        : postId;
      const result = await judgeContentFn({
        groupId,
        postId: targetPostId,
        commentId: judgmentTarget.commentId || null,
        type: judgmentModal,
        reason: judgmentReason.trim(),
      });
      setJudgmentModal(null);
      setJudgmentReason('');
      const data = result.data as any;
      if (data.effectiveType === 'ban') {
        const name = data.bannedUserName || '（不明）';
        alert('破門', judgmentModal === 'caution'
          ? `戒告が3回に達したため、${name}が破門されました。`
          : `${name}を破門しました。`);
      }
    } catch (e: any) {
      const msg = e.message?.includes('already-exists')
        ? '既に反故になっています'
        : e.message?.includes('permission-denied')
        ? 'オーナーのみ裁くことができます'
        : e.message;
      alert('エラー', msg);
    } finally {
      setJudging(false);
    }
  };

  const getTargetAuthorHandle = (target: 'post' | 'comment', commentId?: string): string | undefined => {
    if (target === 'comment') {
      const c = comments.find(x => x.id === commentId);
      return (c as any)?.authorHandle;
    }
    return (post as any)?.authorHandle;
  };

  const isSelf = (target: 'post' | 'comment', commentId?: string) => {
    const h = getTargetAuthorHandle(target, commentId);
    return !!h && !!myAuthorHandle && h === myAuthorHandle;
  };

  const isBlocked = (target: 'post' | 'comment', commentId?: string) => {
    const h = getTargetAuthorHandle(target, commentId);
    return !!h && !!blockedHandles[h];
  };

  const handleBlockAuthor = (target: 'post' | 'comment', commentId?: string) => {
    setMenuVisible(false);
    const handle = getTargetAuthorHandle(target, commentId);
    if (!handle) {
      alert('ブロックできません', '歌人の識別情報が取得できませんでした。');
      return;
    }
    const sampleBody = target === 'comment'
      ? (comments.find(c => c.id === commentId)?.body || '')
      : (post?.body || '');
    alert(
      'この歌人をブロック',
      'お互いの歌・評が見えなくなり、互いにリアクションや評も送れなくなります。',
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: 'ブロックする',
          style: 'destructive',
          onPress: async () => {
            try {
              const fns = getFunctions(undefined, 'asia-northeast1');
              await httpsCallable(fns, 'blockAuthor')({
                postId,
                commentId: target === 'comment' ? commentId : undefined,
                sampleBody: sampleBody.slice(0, 80),
              });
              alert('ブロックしました', 'この歌人とはお互いの歌・評が表示されなくなります。設定画面から解除できます。');
            } catch (e: any) {
              const msg = e?.code === 'functions/resource-exhausted'
                ? 'ブロックできるのは200人までです'
                : e?.code === 'functions/failed-precondition'
                ? '自分自身はブロックできません'
                : e?.message || 'エラーが発生しました';
              alert('ブロックできませんでした', msg);
            }
          },
        },
      ]
    );
  };

  const openReportModal = (target: 'post' | 'comment', commentId?: string) => {
    setMenuVisible(false);
    setReportTarget({ type: target, commentId });
    setReportReason(null);
    setReportDetail('');
    setTimeout(() => setReportModalVisible(true), 200);
  };

  const handleReport = async () => {
    if (!user || !reportReason || reporting) return;
    setReporting(true);
    try {
      const fns = getFunctions(undefined, 'asia-northeast1');
      const reportContentFn = httpsCallable(fns, 'reportContent');
      await reportContentFn({
        groupId,
        postId,
        commentId: reportTarget.type === 'comment' ? reportTarget.commentId : null,
        reason: reportReason,
        detail: reportReason === 'other' ? reportDetail.trim() : undefined,
      });
      setReportModalVisible(false);
      setReportReason(null);
      setReportDetail('');
      alert('通報を受け付けました', 'ご協力ありがとうございます。');
    } catch (e: any) {
      const msg = e?.code === 'functions/already-exists'
        ? 'この投稿は既に通報済みです'
        : e?.code === 'functions/resource-exhausted'
        ? '本日の通報上限に達しました'
        : e?.code === 'functions/failed-precondition'
        ? e.message || '通報できない内容です'
        : e?.message || 'エラーが発生しました';
      alert('通報できませんでした', msg);
    } finally {
      setReporting(false);
    }
  };

  const handleComment = async () => {
    if (!user || !commentText.trim() || submitting) return;
    if (commentText.length > 500) { alert('500文字以内にしてください'); return; }
    setSubmitting(true);
    try {
      const fns = getFunctions(undefined, 'asia-northeast1');
      const createCommentFn = httpsCallable(fns, 'createComment');
      await createCommentFn({ postId, body: compressNewlines(commentText.trim()) });
      setCommentText('');
    } catch (e: any) {
      const msg = e?.code === 'functions/resource-exhausted'
        ? e.message
        : e?.message || 'エラーが発生しました';
      alert('エラー', msg);
    }
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

  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.action === 'screenshot') {
        navigation.navigate('Screenshot', { body: displayBody, revealedAuthorName: post?.revealedAuthorName || '詠み人知らず' });
      } else if (data.action === 'commentMenu') {
        openCommentMenu(data.commentId);
      }
    } catch {}
  };

  if (deleted) return (
    <View style={styles.container}>
      <View style={styles.deletedArea}>
        <AppText variant="bodyLg" weight="medium" tone="secondary" style={styles.deletedText}>この歌は削除されました</AppText>
        <AppButton label="戻る" variant="primary" size="md" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );

  if (!post) return <View style={styles.container}><AppText variant="body" tone="secondary" style={styles.loading}>読み込み中...</AppText></View>;

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
  const isHogo = !!post.hogo;

  const displayBody = isHogo ? '' : formatTankaBody(post.body, 'detail', {
    convertHalfSpace: post.convertHalfSpace,
    convertLineBreak: post.convertLineBreak,
  });

  const commentData = comments
    .filter(c => {
      const h = (c as any).authorHandle as string | undefined;
      // 双方向のブロック関係があれば評も非表示
      return !h || (!blockedHandles[h] && !blockedByHandles[h]);
    })
    .map(c => ({
      id: c.id,
      body: c.body,
      time: c.createdAt ? timeAgo(c.createdAt.toDate()) : '',
      hogo: !!c.hogo,
      hogoReason: c.hogoReason,
      hogoType: c.hogoType,
    }));

  const html = buildDetailHtml(displayBody, commentData, isHogo, post.hogoReason, post.hogoType, colors);

  // メニューで表示する項目を決定
  const isMenuForPost = menuTargetComment === null;
  const menuCommentHogo = !isMenuForPost && comments.find(c => c.id === menuTargetComment)?.hogo;

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
              {reactionCount > 0 && <AppText variant="caption" tone="secondary">{reactionCount}</AppText>}
            </TouchableOpacity>
          )}

          {!fromMyPosts && (
            <TouchableOpacity
              style={[styles.bookmarkBtn, isBookmarked && styles.bookmarkBtnActive]}
              onPress={handleBookmark}
            >
              <MaterialCommunityIcons name={isBookmarked ? 'bookmark' : 'bookmark-outline'} size={20} color={colors.text} />
            </TouchableOpacity>
          )}

          {/* 三点リーダメニュー: 自投稿（削除/解題）、他投稿（通報/ブロック）、オーナー（裁き）のいずれかがあれば表示 */}
          {(isSelf('post') || !isHogo || isOwner) && (
            <TouchableOpacity style={styles.moreBtn} onPress={openPostMenu}>
              <MaterialCommunityIcons name="dots-horizontal" size={20} color={colors.text} />
            </TouchableOpacity>
          )}

          {post.revealedAuthorName && (
            <AppText variant="caption" tone="secondary" style={styles.revealedAuthor}>
              {post.revealedAuthorName}#{post.revealedAuthorCode}
            </AppText>
          )}

          <AppText variant="bodySm" tone="secondary" style={styles.commentLabel}>評 {comments.length}</AppText>
        </View>

        {groupExists && (
          <>
            <View style={styles.commentInput}>
              <TextInput
                style={styles.commentTextInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="評を書く..."
                placeholderTextColor={colors.textTertiary}
                multiline maxLength={500}
              />
              <TouchableOpacity
                style={[styles.commentSubmit, !commentText.trim() && styles.commentSubmitDisabled]}
                onPress={handleComment}
                disabled={!commentText.trim() || submitting}
              >
                <AppText variant="buttonLabel" tone="onAccent">送る</AppText>
              </TouchableOpacity>
            </View>
            {commentText.length > 0 && (
              <AppText variant="caption" tone="tertiary" style={styles.charCount}>{commentText.length}/500</AppText>
            )}
          </>
        )}
      </View>

      <WebView
        ref={webViewRef}
        source={{ html }}
        style={[styles.webview, { backgroundColor: colors.webViewBg }]}
        onMessage={handleWebViewMessage}
        scrollEnabled={true}
        showsHorizontalScrollIndicator={false}
        javaScriptEnabled={true}
        originWhitelist={['*']}
        androidLayerType="software"
      />

      {/* アクションメニューモーダル */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuSheet}>
            <AppText variant="caption" tone="tertiary" style={styles.menuTitle}>{isMenuForPost ? '歌' : '評'}</AppText>

            {/* 解題（自分の歌のみ、未解題の場合） */}
            {isMenuForPost && !post.revealedAuthorName && !menuCommentHogo && isSelf('post') && (
              <TouchableOpacity style={styles.menuItem} onPress={() => {
                setMenuVisible(false);
                alert('解題', 'あなたがこの詠草の作者であれば、名前が公開されます。\nこの操作は取り消せません。', [
                  { text: 'やめる', style: 'cancel' },
                  {
                    text: '解題する', style: 'destructive',
                    onPress: async () => {
                      try {
                        const fns = getFunctions(undefined, 'asia-northeast1');
                        await httpsCallable(fns, 'revealAuthor')({ postId });
                      } catch (e: any) {
                        const msg = e?.code === 'functions/permission-denied'
                          ? '自分の歌のみ解題できます'
                          : e?.code === 'functions/already-exists'
                          ? '既に解題されています'
                          : e?.message || 'エラーが発生しました';
                        alert('エラー', msg);
                      }
                    },
                  },
                ]);
              }}>
                <MaterialCommunityIcons name="account-eye-outline" size={20} color={colors.text} />
                <AppText variant="bodyLg">解題</AppText>
                <AppText variant="caption" tone="tertiary" style={styles.menuItemHint}>名乗り出る</AppText>
              </TouchableOpacity>
            )}

            {/* 削除（自分の投稿のみ表示、サーバー側でも認証） */}
            {isSelf(isMenuForPost ? 'post' : 'comment', menuTargetComment || undefined) && (
              <TouchableOpacity style={styles.menuItem} onPress={() => {
                setMenuVisible(false);
                if (isMenuForPost) handleDelete();
                else handleDeleteComment(menuTargetComment!);
              }}>
                <MaterialCommunityIcons name="delete-outline" size={20} color={colors.destructive} />
                <AppText variant="bodyLg" tone="destructive">削除</AppText>
              </TouchableOpacity>
            )}

            {/* 通報・ブロック（自投稿以外、反故以外） */}
            {!menuCommentHogo && !isSelf(isMenuForPost ? 'post' : 'comment', menuTargetComment || undefined) && (
              <>
                <View style={styles.menuDivider} />
                <TouchableOpacity style={styles.menuItem} onPress={() => {
                  openReportModal(isMenuForPost ? 'post' : 'comment', menuTargetComment || undefined);
                }}>
                  <MaterialCommunityIcons name="flag-outline" size={20} color={colors.text} />
                  <AppText variant="bodyLg">通報</AppText>
                  <AppText variant="caption" tone="tertiary" style={styles.menuItemHint}>主宰が確認</AppText>
                </TouchableOpacity>
                {!isBlocked(isMenuForPost ? 'post' : 'comment', menuTargetComment || undefined) && (
                  <TouchableOpacity style={styles.menuItem} onPress={() => {
                    handleBlockAuthor(isMenuForPost ? 'post' : 'comment', menuTargetComment || undefined);
                  }}>
                    <MaterialCommunityIcons name="account-cancel-outline" size={20} color={colors.text} />
                    <AppText variant="bodyLg">この歌人をブロック</AppText>
                    <AppText variant="caption" tone="tertiary" style={styles.menuItemHint}>以後非表示</AppText>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* 裁き（オーナーのみ） */}
            {isOwner && !menuCommentHogo && (
              <>
                <View style={styles.menuDivider} />
                <TouchableOpacity style={styles.menuItem} onPress={() => {
                  openJudgmentModal('caution', isMenuForPost ? 'post' : 'comment', menuTargetComment || undefined);
                }}>
                  <Text style={styles.menuItemIcon}>🟡</Text>
                  <AppText variant="bodyLg">戒告</AppText>
                  <AppText variant="caption" tone="tertiary" style={styles.menuItemHint}>3回で破門</AppText>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => {
                  openJudgmentModal('ban', isMenuForPost ? 'post' : 'comment', menuTargetComment || undefined);
                }}>
                  <Text style={styles.menuItemIcon}>🔴</Text>
                  <AppText variant="bodyLg">破門</AppText>
                  <AppText variant="caption" tone="tertiary" style={styles.menuItemHint}>即追放</AppText>
                </TouchableOpacity>
              </>
            )}

            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => setMenuVisible(false)}>
              <AppText variant="bodyLg" tone="secondary" style={styles.menuItemCancelText}>やめる</AppText>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 通報モーダル */}
      <Modal visible={reportModalVisible} transparent animationType="fade" onRequestClose={() => { if (!reporting) setReportModalVisible(false); }}>
        <View style={styles.judgmentOverlay}>
          <View style={styles.judgmentModal}>
            <AppText variant="sectionTitle" style={styles.judgmentTitle}>通報</AppText>
            <AppText variant="caption" tone="secondary" style={styles.judgmentDesc}>
              この{reportTarget.type === 'comment' ? '評' : '歌'}を通報します。複数人から通報が集まると自動で仮非表示になり、主宰の確認対象になります。
            </AppText>

            {([
              { key: 'inappropriate', label: '不適切な内容' },
              { key: 'spam', label: 'スパム・広告' },
              { key: 'harassment', label: '誹謗中傷・攻撃的' },
              { key: 'other', label: 'その他' },
            ] as const).map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.reportReasonBtn, reportReason === opt.key && styles.reportReasonBtnActive]}
                onPress={() => setReportReason(opt.key)}
                disabled={reporting}
              >
                <MaterialCommunityIcons
                  name={reportReason === opt.key ? 'radiobox-marked' : 'radiobox-blank'}
                  size={18}
                  color={reportReason === opt.key ? colors.text : colors.disabled}
                />
                <AppText variant="body">{opt.label}</AppText>
              </TouchableOpacity>
            ))}

            {reportReason === 'other' && (
              <TextInput
                style={styles.reportDetailInput}
                value={reportDetail}
                onChangeText={setReportDetail}
                placeholder="詳細（任意、500字以内）"
                placeholderTextColor={colors.disabled}
                multiline
                maxLength={500}
              />
            )}

            <View style={styles.judgmentButtons}>
              <AppButton
                label="やめる"
                variant="secondary"
                onPress={() => { setReportModalVisible(false); setReportReason(null); setReportDetail(''); }}
                disabled={reporting}
                style={styles.judgmentBtnFlex}
              />
              <AppButton
                label={reporting ? '送信中...' : '通報する'}
                variant="caution"
                onPress={handleReport}
                disabled={!reportReason || reporting}
                loading={reporting}
                style={styles.judgmentBtnFlex}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* 裁き確認モーダル */}
      <Modal visible={judgmentModal !== null} transparent animationType="fade" onRequestClose={() => { if (!judging) setJudgmentModal(null); }}>
        <View style={styles.judgmentOverlay}>
          <View style={styles.judgmentModal}>
            <AppText variant="sectionTitle" style={styles.judgmentTitle}>
              {judgmentModal === 'caution' ? '🟡 戒告' : '🔴 破門'}
            </AppText>
            <AppText variant="caption" tone="secondary" style={styles.judgmentDesc}>
              {judgmentModal === 'caution'
                ? 'この投稿の著者に戒告を与えます。戒告が3回に達すると自動的に破門されます。'
                : 'この投稿の著者を即座に破門します。歌会から追放され、再参加できなくなります。'}
            </AppText>

            <AppText variant="caption" style={styles.judgmentLabel}>理由（任意）—— 反故に表示されます</AppText>
            <TextInput
              style={styles.judgmentInput}
              value={judgmentReason}
              onChangeText={setJudgmentReason}
              placeholder="仔細あり"
              placeholderTextColor={colors.disabled}
              multiline
              maxLength={50}
            />

            <View style={styles.judgmentButtons}>
              <AppButton
                label="やめる"
                variant="secondary"
                onPress={() => { setJudgmentModal(null); setJudgmentReason(''); }}
                disabled={judging}
                style={styles.judgmentBtnFlex}
              />
              <AppButton
                label={judging ? '処理中...' : judgmentModal === 'caution' ? '戒告する' : '破門する'}
                variant={judgmentModal === 'ban' ? 'destructive' : 'caution'}
                onPress={handleJudge}
                disabled={judging}
                loading={judging}
                style={styles.judgmentBtnFlex}
              />
            </View>
          </View>
        </View>
      </Modal>
    </GradientBackground>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    loading: { textAlign: 'center', marginTop: 40 },
    topBar: {
      borderBottomWidth: 1, borderBottomColor: colors.border,
      paddingHorizontal: 16, paddingVertical: 10,
    },
    actionRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
    },
    reactionBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    reactionBtnActive: { backgroundColor: colors.activeHighlight, borderColor: colors.disabled },
    reactionEmoji: { fontSize: 16 },
    bookmarkBtn: {
      paddingHorizontal: 8, paddingVertical: 6,
      borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    bookmarkBtnActive: { backgroundColor: colors.activeHighlight, borderColor: colors.disabled },
    moreBtn: {
      paddingHorizontal: 8, paddingVertical: 6,
      borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    revealedAuthor: {},
    commentLabel: { marginLeft: 'auto' },
    commentInput: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 10 },
    commentTextInput: {
      flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 10,
      fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.border,
      maxHeight: 80, textAlignVertical: 'top',
    },
    commentSubmit: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    commentSubmitDisabled: { opacity: 0.4 },
    charCount: { textAlign: 'right', marginTop: 4 },
    webview: { flex: 1 },
    deletedArea: { alignItems: 'center', marginTop: 80 },
    deletedText: { marginBottom: 20 },

    // アクションメニュー
    menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    menuSheet: {
      backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16,
      padding: 20, paddingBottom: 36,
    },
    menuTitle: { textAlign: 'center', marginBottom: 12 },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 52 },
    menuItemIcon: { fontSize: 18, width: 24, textAlign: 'center' as const },
    menuItemCancelText: { textAlign: 'center' as const, flex: 1 },
    menuItemHint: { marginLeft: 'auto' as const },
    menuDivider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },

    // 裁き確認モーダル
    judgmentOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
    judgmentModal: {
      backgroundColor: colors.surface, borderRadius: 16, padding: 24,
      width: '85%', borderWidth: 1, borderColor: colors.border,
    },
    judgmentTitle: { marginBottom: 12, textAlign: 'center' },
    judgmentDesc: { marginBottom: 16 },
    judgmentLabel: { marginBottom: 6 },
    judgmentInput: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 8,
      padding: 12, fontSize: 15, color: colors.text, marginBottom: 20,
      minHeight: 48, textAlignVertical: 'top',
      fontFamily: 'NotoSerifJP_400Regular',
    },
    judgmentButtons: { flexDirection: 'row', gap: 12 },
    judgmentBtnFlex: { flex: 1, alignSelf: 'auto' as const },
    reportReasonBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 10, paddingHorizontal: 12,
      borderRadius: 8, borderWidth: 1, borderColor: colors.border,
      marginBottom: 8, backgroundColor: colors.surface,
    },
    reportReasonBtnActive: {
      borderColor: colors.text,
      backgroundColor: colors.activeHighlight,
    },
    reportDetailInput: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 8,
      padding: 12, fontSize: 15, color: colors.text, marginBottom: 20,
      minHeight: 48, textAlignVertical: 'top',
    },
  });
}
