import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View
} from 'react-native';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { ReportDoc, ReportReason } from '../types';

interface PendingItem {
  targetType: 'post' | 'comment';
  targetId: string;
  postId: string;
  commentId?: string;
  body: string;
  reports: (ReportDoc & { id: string })[];
}

const REASON_LABEL: Record<ReportReason, string> = {
  inappropriate: '不適切',
  spam: 'スパム',
  harassment: '誹謗中傷',
  other: 'その他',
};

export default function ReportReviewScreen({ route, navigation }: any) {
  const { groupId } = route.params;
  const { user } = useAuth();
  const { colors } = useTheme();
  const { alert } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);

  // reports を購読
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'reports'),
      where('groupId', '==', groupId),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, async (snap) => {
      const reportsByTarget = new Map<string, (ReportDoc & { id: string })[]>();
      for (const d of snap.docs) {
        const data = d.data() as ReportDoc;
        const key = data.targetId;
        const arr = reportsByTarget.get(key) || [];
        arr.push({ ...data, id: d.id });
        reportsByTarget.set(key, arr);
      }

      const pending: PendingItem[] = [];
      for (const [targetId, reports] of reportsByTarget.entries()) {
        const r0 = reports[0];
        const path = r0.targetType === 'comment'
          ? `posts/${r0.postId}/comments/${targetId}`
          : `posts/${r0.postId}`;
        try {
          const contentSnap = await getDoc(doc(db, path));
          if (!contentSnap.exists()) continue;
          const cdata = contentSnap.data() as any;
          if (cdata.hogoType !== 'pending') continue;
          pending.push({
            targetType: r0.targetType,
            targetId,
            postId: r0.postId,
            commentId: r0.targetType === 'comment' ? targetId : undefined,
            body: cdata.body || '（本文なし）',
            reports,
          });
        } catch {
          // 読めないものはスキップ
        }
      }
      setItems(pending);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user, groupId]);

  // 解除時にクライアント側でも body を再取得（解除後は hogoType='pending' でなくなる）
  const refetchOriginalBody = async (postId: string, commentId?: string) => {
    const path = commentId ? `posts/${postId}/comments/${commentId}` : `posts/${postId}`;
    try {
      const snap = await getDoc(doc(db, path));
      return snap.exists() ? ((snap.data() as any).body || '') : '';
    } catch {
      return '';
    }
  };

  const handleResolve = async (item: PendingItem) => {
    if (working) return;
    setWorking(item.targetId);
    try {
      const fns = getFunctions(undefined, 'asia-northeast1');
      await httpsCallable(fns, 'resolveReports')({
        groupId,
        postId: item.postId,
        commentId: item.commentId,
      });
      alert('解除しました', 'この投稿は通常表示に戻りました。');
    } catch (e: any) {
      alert('エラー', e?.message || '解除に失敗しました');
    } finally {
      setWorking(null);
    }
  };

  const handleJudge = async (item: PendingItem, type: 'caution' | 'ban') => {
    if (working) return;
    const originalBody = await refetchOriginalBody(item.postId, item.commentId);
    const preview = originalBody.length > 40 ? originalBody.slice(0, 40) + '…' : originalBody;
    alert(
      type === 'caution' ? '戒告に昇格' : '破門に昇格',
      `${preview}\n\nこの通報を${type === 'caution' ? '戒告' : '破門'}に昇格させますか？`,
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: type === 'caution' ? '戒告する' : '破門する',
          style: type === 'caution' ? 'caution' : 'destructive',
          onPress: async () => {
            setWorking(item.targetId);
            try {
              const fns = getFunctions(undefined, 'asia-northeast1');
              await httpsCallable(fns, 'judgeContent')({
                groupId,
                postId: item.postId,
                commentId: item.commentId || null,
                type,
                reason: '',
              });
            } catch (e: any) {
              alert('エラー', e?.message || '処理に失敗しました');
            } finally {
              setWorking(null);
            }
          },
        },
      ]
    );
  };

  const openTarget = (item: PendingItem) => {
    navigation.navigate('TankaDetail', { postId: item.postId, groupId });
  };

  return (
    <GradientBackground>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <AppText variant="caption" tone="secondary" style={styles.intro}>
          通報によって仮非表示になっている歌・評の一覧です。内容を確認して解除するか、裁きに昇格させてください。
        </AppText>

        {loading && <AppText variant="body" tone="secondary" style={styles.empty}>読み込み中...</AppText>}
        {!loading && items.length === 0 && (
          <AppText variant="body" tone="secondary" style={styles.empty}>仮非表示中の投稿はありません</AppText>
        )}

        {items.map((item) => (
          <View key={item.targetId} style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons
                name={item.targetType === 'comment' ? 'comment-text-outline' : 'feather'}
                size={16}
                color={colors.text}
              />
              <AppText variant="caption" tone="secondary">
                {item.targetType === 'comment' ? '評' : '歌'} ・ 通報 {item.reports.length} 件
              </AppText>
            </View>

            <TouchableOpacity onPress={() => openTarget(item)} style={styles.bodyWrap}>
              <AppText variant="body" numberOfLines={4}>{item.body || '（本文なし）'}</AppText>
              <AppText variant="meta" tone="secondary" style={styles.openHint}>タップして詳細を見る</AppText>
            </TouchableOpacity>

            <View style={styles.reasons}>
              {item.reports.map((r) => (
                <View key={r.id} style={styles.reasonChip}>
                  <AppText variant="meta">{REASON_LABEL[r.reason]}</AppText>
                  {r.detail ? <AppText variant="meta" tone="secondary" style={styles.reasonDetail}>「{r.detail}」</AppText> : null}
                </View>
              ))}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnResolve, working === item.targetId && styles.btnDisabled]}
                onPress={() => handleResolve(item)}
                disabled={working === item.targetId}
              >
                <AppText variant="buttonLabelSm">解除</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnCaution, working === item.targetId && styles.btnDisabled]}
                onPress={() => handleJudge(item, 'caution')}
                disabled={working === item.targetId}
              >
                <AppText variant="buttonLabelSm">🟡 戒告</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnBan, working === item.targetId && styles.btnDisabled]}
                onPress={() => handleJudge(item, 'ban')}
                disabled={working === item.targetId}
              >
                <AppText variant="buttonLabelSm" tone="destructive">🔴 破門</AppText>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </GradientBackground>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 16, paddingBottom: 40 },
    intro: { marginBottom: 16 },
    empty: { textAlign: 'center', marginTop: 40 },
    card: {
      backgroundColor: colors.surface, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border,
      padding: 14, marginBottom: 12,
    },
    cardHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
    },
    bodyWrap: { paddingVertical: 8 },
    openHint: { marginTop: 6 },
    reasons: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 6,
      marginTop: 10, marginBottom: 10,
    },
    reasonChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 8, paddingVertical: 4,
      backgroundColor: colors.activeHighlight, borderRadius: 10,
    },
    reasonDetail: { maxWidth: 180 },
    actions: {
      flexDirection: 'row', gap: 8, marginTop: 6,
    },
    btn: {
      flex: 1, paddingVertical: 10, borderRadius: 8,
      alignItems: 'center', borderWidth: 1,
    },
    btnDisabled: { opacity: 0.4 },
    btnResolve: { borderColor: colors.border, backgroundColor: colors.surface },
    btnCaution: { borderColor: colors.warning, backgroundColor: colors.warningBg },
    btnBan: { borderColor: colors.destructive, backgroundColor: colors.destructiveBg },
  });
}
