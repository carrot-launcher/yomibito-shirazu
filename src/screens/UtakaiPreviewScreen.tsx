import { MaterialCommunityIcons } from '@expo/vector-icons';
import { arrayUnion, doc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { fs } from '../utils/scale';

type PreviewPost = {
  postId: string;
  body: string;
  hogo: boolean;
  createdAt: number | null;
};

type PreviewData = {
  group: { id: string; name: string; purpose: string; memberCount: number; postCount: number };
  owner: { displayName: string; userCode: string } | null;
  posts: PreviewPost[];
  alreadyMember: boolean;
  banned: boolean;
  full: boolean;
};

const previewFontSize = 16;
// 31文字が折り返さず1列に収まる高さ (fontSize * 31 * (1 + letterSpacing) + padding)
const previewWebViewHeight = 580;

function buildPreviewHtml(posts: PreviewPost[], colors: ThemeColors): string {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rubyToHtml = (s: string) => s.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>');

  const cardsHtml = posts.map(p => {
    const body = p.hogo
      ? `<span style="font-style:italic;color:${colors.textTertiary};font-size:0.8em">現在確認中です</span>`
      : rubyToHtml(escapeHtml(p.body.replace(/[\n\r]+/g, '\u3000')));
    return `<div class="card">${body}</div>`;
  }).join('');

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent;
      -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
  html, body {
    height:100%; background:${colors.webViewBg};
    font-family:"Noto Serif JP","Yu Mincho","Hiragino Mincho Pro",serif;
    overflow:hidden;
  }
  .container {
    display:flex; flex-direction:row-reverse; align-items:stretch;
    height:100%; width:100%; padding:8px 0;
    overflow:hidden;
  }
  .card {
    writing-mode:vertical-rl; font-size:${previewFontSize}px;
    line-height:2.0; letter-spacing:0.1em; color:${colors.text};
    padding:8px 14px; border-right:1px solid ${colors.border};
    overflow:hidden; flex:none;
  }
  .card:first-child { border-right:none; }
  rt { font-size:0.45em; letter-spacing:0; }
  .empty {
    display:flex; align-items:center; justify-content:center;
    height:100%; width:100%; color:${colors.textTertiary}; font-size:14px;
  }
</style></head><body>
<div class="container">${posts.length ? cardsHtml : '<div class="empty">まだ歌がありません</div>'}</div>
</body></html>`;
}

export default function UtakaiPreviewScreen({ navigation, route }: any) {
  const { groupId } = route.params;
  const { user, userCode } = useAuth();
  const { colors } = useTheme();
  const { alert } = useAlert();
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [showNameModal, setShowNameModal] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [joining, setJoining] = useState(false);
  const previewHtml = useMemo(() => buildPreviewHtml(data?.posts || [], colors), [data?.posts, colors]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const fns = getFunctions(undefined, 'asia-northeast1');
        const fn = httpsCallable(fns, 'getPublicGroupPreview');
        const res = await fn({ groupId });
        if (mounted) setData(res.data as PreviewData);
      } catch (e: any) {
        console.warn('[UtakaiPreview] error', e);
        const code = e?.code || '';
        const msg = e?.message || '';
        if (mounted) setErrorMessage(msg && code ? `${msg} (${code})` : (msg || code || '読み込みに失敗しました'));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [groupId]);

  useEffect(() => {
    navigation.setOptions({ title: data?.group.name || '' });
  }, [navigation, data]);

  const handleJoinConfirm = async () => {
    if (!user || !data || !displayName.trim() || joining) return;
    setJoining(true);
    try {
      const name = displayName.trim();
      await setDoc(doc(db, 'groups', groupId, 'members', user.uid), {
        displayName: name,
        userCode,
        joinedAt: serverTimestamp(),
        role: 'member',
        muted: true, // 公開歌会はデフォルトで通知ミュート
      });
      await updateDoc(doc(db, 'groups', groupId), { memberCount: increment(1) });
      await updateDoc(doc(db, 'users', user.uid), { joinedGroups: arrayUnion(groupId) });
      setShowNameModal(false);
      navigation.replace('Timeline', { groupId, groupName: data.group.name });
    } catch (e: any) {
      alert('エラー', e?.message || '参加できませんでした');
    } finally {
      setJoining(false);
    }
  };

  const renderJoinButton = () => {
    if (!data) return null;
    if (data.alreadyMember) {
      return (
        <TouchableOpacity
          style={[styles.joinBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
          onPress={() => navigation.replace('Timeline', { groupId: data.group.id, groupName: data.group.name })}
        >
          <Text style={[styles.joinBtnText, { color: colors.text }]}>歌会に入る</Text>
        </TouchableOpacity>
      );
    }
    if (data.banned) {
      return (
        <View style={[styles.joinBtn, { backgroundColor: colors.surface }]}>
          <Text style={[styles.joinBtnText, { color: colors.textTertiary }]}>この歌会には参加できません</Text>
        </View>
      );
    }
    if (data.full) {
      return (
        <View style={[styles.joinBtn, { backgroundColor: colors.surface }]}>
          <Text style={[styles.joinBtnText, { color: colors.textTertiary }]}>定員に達しています</Text>
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={[styles.joinBtn, { backgroundColor: colors.accent }]}
        onPress={() => { setDisplayName(''); setShowNameModal(true); }}
      >
        <Text style={[styles.joinBtnText, { color: colors.accentText }]}>入会する</Text>
      </TouchableOpacity>
    );
  };

  return (
    <GradientBackground style={styles.container}>
      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.textSecondary} /></View>
      ) : errorMessage ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textTertiary }]}>{errorMessage}</Text>
        </View>
      ) : data ? (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            {/* 趣意書 */}
            <View style={[styles.purposeBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.purposeLabel, { color: colors.textTertiary }]}>趣意</Text>
              <Text style={[styles.purposeText, { color: colors.text }]}>{data.group.purpose}</Text>
            </View>

            {/* 情報 */}
            <View style={styles.statsRow}>
              <MaterialCommunityIcons name="account-multiple-outline" size={14} color={colors.textTertiary} />
              <Text style={[styles.statsText, { color: colors.textTertiary }]}>{data.group.memberCount}人</Text>
              <Text style={[styles.statsText, { color: colors.textTertiary }]}> ・ </Text>
              <MaterialCommunityIcons name="feather" size={14} color={colors.textTertiary} />
              <Text style={[styles.statsText, { color: colors.textTertiary }]}>{data.group.postCount}首</Text>
            </View>

            {/* オーナー */}
            {data.owner ? (
              <View style={styles.ownerRow}>
                <Text style={[styles.ownerLabel, { color: colors.textTertiary }]}>主宰</Text>
                <Text style={[styles.ownerName, { color: colors.textSecondary }]}>{data.owner.displayName}</Text>
                <Text style={[styles.ownerCode, { color: colors.textTertiary }]}>#{data.owner.userCode}</Text>
              </View>
            ) : null}

            {/* 最近の歌（固定高さ、横スクロール不可、収まる分だけ） */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>最近の歌</Text>
            <View style={[styles.previewWebView, { borderColor: colors.border }]}>
              <WebView
                source={{ html: previewHtml }}
                style={{ backgroundColor: colors.webViewBg }}
                scrollEnabled={false}
                showsHorizontalScrollIndicator={false}
                javaScriptEnabled={false}
                originWhitelist={['*']}
                androidLayerType="software"
              />
            </View>
          </ScrollView>

          {/* 固定フッター: 入会ボタン */}
          <View style={[styles.footer, { backgroundColor: colors.gradientBottom, borderTopColor: colors.border }]}>
            {renderJoinButton()}
          </View>
        </>
      ) : null}

      {/* 表示名入力モーダル */}
      <Modal visible={showNameModal} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modal, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {data ? `「${data.group.name}」に参加` : '歌会に参加'}
            </Text>
            <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
              この歌会でのあなたの名前を決めてください{'\n'}後から歌会設定で変更できます
            </Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              placeholder="あなたの名前"
              value={displayName}
              onChangeText={setDisplayName}
              placeholderTextColor={colors.textTertiary}
              maxLength={16}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setShowNameModal(false)}>
                <Text style={[styles.cancelText, { color: colors.textSecondary }]}>やめる</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: colors.accent }, (!displayName.trim() || joining) && { opacity: 0.4 }]}
                onPress={handleJoinConfirm}
                disabled={!displayName.trim() || joining}
              >
                <Text style={[styles.confirmText, { color: colors.accentText }]}>参加</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  errorText: { fontSize: 14, textAlign: 'center', fontFamily: 'NotoSerifJP_400Regular' },
  content: { padding: 16, paddingBottom: 32 },
  purposeBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, marginBottom: 12 },
  purposeLabel: { fontSize: 11, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 2, marginBottom: 6 },
  purposeText: { fontSize: fs(15), lineHeight: 24, fontFamily: 'NotoSerifJP_400Regular' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6, paddingHorizontal: 4 },
  statsText: { fontSize: 12, fontFamily: 'NotoSerifJP_400Regular' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20, paddingHorizontal: 4 },
  ownerLabel: { fontSize: 11, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 2 },
  ownerName: { fontSize: 13, fontFamily: 'NotoSerifJP_500Medium' },
  ownerCode: { fontSize: 11, fontFamily: 'IBMPlexMono_600SemiBold' },
  sectionTitle: { fontSize: 13, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 2, marginBottom: 10, marginTop: 4 },
  previewWebView: {
    height: previewWebViewHeight,
    borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden', marginBottom: 8,
  },
  footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  joinBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  joinBtnText: { fontSize: 16, lineHeight: 22, fontFamily: 'NotoSerifJP_500Medium' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modal: { borderRadius: 16, padding: 20, width: '85%' },
  modalTitle: { fontSize: 18, fontWeight: '500', marginBottom: 6, fontFamily: 'NotoSerifJP_500Medium' },
  modalHint: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 14 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' },
  cancelText: { fontSize: 16, lineHeight: 22, fontFamily: 'NotoSerifJP_400Regular' },
  confirmBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  confirmText: { fontSize: 16, lineHeight: 22, fontFamily: 'NotoSerifJP_500Medium' },
});
