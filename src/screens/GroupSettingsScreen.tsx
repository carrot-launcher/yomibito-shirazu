import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useRef, useState } from 'react';
import GradientBackground from '../components/GradientBackground';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Switch, Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';
import { MemberDoc } from '../types';
import { breadcrumb } from '../utils/breadcrumb';
import { describeError } from '../utils/errorMessage';

export default function GroupSettingsScreen({ route, navigation }: any) {
  const { groupId } = route.params;
  const { user } = useAuth();
  const { colors } = useTheme();
  const [groupName, setGroupName] = useState('');
  const [editingName, setEditingName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [editingPurpose, setEditingPurpose] = useState('');
  const originalPurpose = useRef('');
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState<(MemberDoc & { id: string })[]>([]);
  const [savedHint, setSavedHint] = useState('');
  const [copied, setCopied] = useState(false);
  const { alert } = useAlert();
  const originalDisplayName = useRef('');
  const originalGroupName = useRef('');
  const displayNameRef = useRef('');
  const editingNameRef = useRef('');
  const editingPurposeRef = useRef('');
  displayNameRef.current = displayName;
  editingNameRef.current = editingName;
  editingPurposeRef.current = editingPurpose;

  // ミュート設定
  const [muted, setMuted] = useState(false);

  // 追放リスト
  const [bannedUsers, setBannedUsers] = useState<Record<string, { displayName: string; userCode: string }>>({});

  // 解散用
  const [showDissolve, setShowDissolve] = useState(false);
  const [dissolveConfirmText, setDissolveConfirmText] = useState('');
  const [deleteAllPosts, setDeleteAllPosts] = useState(false);
  const [dissolving, setDissolving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const groupSnap = await getDoc(doc(db, 'groups', groupId));
      if (groupSnap.exists()) {
        const data = groupSnap.data();
        setGroupName(data.name);
        setEditingName(data.name);
        originalGroupName.current = data.name;
        setInviteCode(data.inviteCode);
        setIsPublic(data.isPublic === true);
        const p = typeof data.purpose === 'string' ? data.purpose : '';
        setPurpose(p);
        setEditingPurpose(p);
        originalPurpose.current = p;
        setBannedUsers(data.bannedUsers || []);
      }
      const memberSnap = await getDoc(doc(db, 'groups', groupId, 'members', user.uid));
      if (memberSnap.exists()) {
        const data = memberSnap.data();
        setDisplayName(data.displayName || '');
        originalDisplayName.current = data.displayName || '';
        setIsOwner(data.role === 'owner');
        setMuted(!!data.muted);
      }
      const membersSnap = await getDocs(collection(db, 'groups', groupId, 'members'));
      setMembers(membersSnap.docs.map(d => ({ id: d.id, ...d.data() } as MemberDoc & { id: string })));
    })();
  }, [user, groupId]);

  const handleCopyCode = async () => {
    await Clipboard.setStringAsync(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showSaved = (key: string) => {
    setSavedHint(key);
    setTimeout(() => setSavedHint(''), 2000);
  };

  const handleBlurDisplayName = async () => {
    const v = displayName.trim();
    if (!user || !v || v === originalDisplayName.current) return;
    try {
      await updateDoc(doc(db, 'groups', groupId, 'members', user.uid), { displayName: v });
      // オーナーなら GroupDoc の非正規化キャッシュも同期
      if (isOwner) {
        updateDoc(doc(db, 'groups', groupId), { ownerDisplayName: v }).catch(() => {});
      }
      setMembers(prev => prev.map(m => m.id === user.uid ? { ...m, displayName: v } : m));
      originalDisplayName.current = v;
      showSaved('displayName');
    } catch {}
  };

  const handleBlurPurpose = async () => {
    const v = editingPurpose.trim();
    if (!v || v === originalPurpose.current) return;
    if (v.length < 10 || v.length > 200) {
      alert('', '趣意書は10〜200文字で入力してください');
      setEditingPurpose(originalPurpose.current);
      return;
    }
    try {
      const fns = getFunctions(undefined, 'asia-northeast1');
      const fn = httpsCallable(fns, 'updatePurpose');
      await fn({ groupId, purpose: v });
      setPurpose(v);
      originalPurpose.current = v;
      showSaved('purpose');
    } catch (e: any) {
      const { title, message } = describeError(e);
      alert(title, message || '更新できませんでした');
      setEditingPurpose(originalPurpose.current);
    }
  };

  const handleBlurGroupName = async () => {
    const v = editingName.trim();
    if (!v || v === originalGroupName.current) return;
    try {
      await updateDoc(doc(db, 'groups', groupId), { name: v });
      setGroupName(v);
      navigation.setParams({ groupName: v });
      originalGroupName.current = v;
      showSaved('groupName');
    } catch {}
  };

  // Save unsaved changes on navigation away
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      const dn = displayNameRef.current.trim();
      const gn = editingNameRef.current.trim();
      if (user && dn && dn !== originalDisplayName.current) {
        updateDoc(doc(db, 'groups', groupId, 'members', user.uid), { displayName: dn }).catch(() => {});
        if (isOwner) {
          updateDoc(doc(db, 'groups', groupId), { ownerDisplayName: dn }).catch(() => {});
        }
      }
      if (isOwner && gn && gn !== originalGroupName.current) {
        updateDoc(doc(db, 'groups', groupId), { name: gn }).catch(() => {});
      }

      // 趣意書: 未保存の変更があれば保存/破棄を確認
      if (isOwner && isPublic) {
        const pp = editingPurposeRef.current.trim();
        if (pp !== originalPurpose.current) {
          // 一旦戻る操作を止めて確認ダイアログ
          e.preventDefault();
          const invalid = pp.length < 10 || pp.length > 200 || /https?:\/\//i.test(pp) || /<[^>]+>/.test(pp);
          alert(
            '趣意書が未保存です',
            invalid
              ? '内容が不正なため保存できません。破棄して戻りますか？'
              : '変更を保存しますか？公開歌会ではすぐに他のユーザーに表示されます。',
            invalid
              ? [
                  { text: '編集に戻る', style: 'cancel' },
                  { text: '破棄', style: 'destructive', onPress: () => {
                    editingPurposeRef.current = originalPurpose.current;
                    navigation.dispatch(e.data.action);
                  }},
                ]
              : [
                  { text: '編集に戻る', style: 'cancel' },
                  { text: '破棄して戻る', style: 'destructive', onPress: () => {
                    editingPurposeRef.current = originalPurpose.current;
                    navigation.dispatch(e.data.action);
                  }},
                  { text: '保存して戻る', onPress: async () => {
                    try {
                      const fns = getFunctions(undefined, 'asia-northeast1');
                      const fn = httpsCallable(fns, 'updatePurpose');
                      await fn({ groupId, purpose: pp });
                      originalPurpose.current = pp;
                    } catch { /* 失敗してもそのまま戻る */ }
                    navigation.dispatch(e.data.action);
                  }},
                ]
          );
        }
      }
    });
  }, [navigation, user, isOwner, groupId, isPublic, alert]);

  const handleKick = (member: MemberDoc & { id: string }) => {
    if (member.id === user?.uid) { alert('自分自身は追放できません'); return; }
    if (member.role === 'owner') { alert('オーナーは追放できません'); return; }
    alert(
      'メンバーを追放',
      `${member.displayName}（#${member.userCode || '---'}）をこの歌会から追放しますか？\n追放されたユーザーは招待コードで再参加できなくなります。`,
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: '追放する', style: 'destructive',
          onPress: async () => {
            breadcrumb(`group:kick group=${groupId} target=${member.id}`);
            try {
              const functions = getFunctions(undefined, 'asia-northeast1');
              const kickMemberFn = httpsCallable(functions, 'kickMember');
              await kickMemberFn({ groupId, targetUserId: member.id });
              setMembers(prev => prev.filter(m => m.id !== member.id));
              setBannedUsers(prev => ({ ...prev, [member.id]: { displayName: member.displayName, userCode: member.userCode } }));
              alert('追放しました');
            } catch (e: any) { const { title, message } = describeError(e); alert(title, message); }
          },
        },
      ]
    );
  };

  const handleUnban = (targetUserId: string) => {
    alert(
      '追放解除',
      'このユーザーが再び招待コードで参加できるようになります。',
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: '解除する',
          onPress: async () => {
            try {
              const functions = getFunctions(undefined, 'asia-northeast1');
              const unbanMemberFn = httpsCallable(functions, 'unbanMember');
              await unbanMemberFn({ groupId, targetUserId });
              setBannedUsers(prev => {
                const next = { ...prev };
                delete next[targetUserId];
                return next;
              });
              alert('追放を解除しました');
            } catch (e: any) { const { title, message } = describeError(e); alert(title, message); }
          },
        },
      ]
    );
  };

  const handleDissolve = async () => {
    if (dissolveConfirmText !== groupName) return;
    breadcrumb(`group:dissolve group=${groupId} deletePosts=${deleteAllPosts}`);
    setDissolving(true);
    try {
      setShowDissolve(false);
      navigation.popToTop();
      const functions = getFunctions(undefined, 'asia-northeast1');
      const dissolveGroupFn = httpsCallable(functions, 'dissolveGroup');
      await dissolveGroupFn({ groupId, confirmName: groupName, deletePosts: deleteAllPosts });
    } catch {
      // 画面遷移済みなのでエラーは無視
    }
  };

  return (
    <GradientBackground>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 公開歌会の趣意 */}
      {isPublic && (
        <>
          <View style={styles.purposeHeaderRow}>
            <AppText variant="sectionTitle">趣意</AppText>
            <View style={[styles.publicBadge, { borderColor: colors.border }]}>
              <Text style={[styles.publicBadgeText, { color: colors.textSecondary }]}>公開</Text>
            </View>
          </View>
          {isOwner ? (
            <>
              <TextInput
                style={[styles.input, styles.purposeEditInput, { borderColor: colors.border, color: colors.text }]}
                value={editingPurpose}
                onChangeText={setEditingPurpose}
                onBlur={handleBlurPurpose}
                placeholder="10〜200文字"
                placeholderTextColor={colors.textTertiary}
                maxLength={200}
                multiline
                textAlignVertical="top"
              />
              <AppText variant="caption" tone="tertiary" style={styles.savedHint}>
                {savedHint === 'purpose' ? '保存しました' : `${editingPurpose.trim().length} / 200`}
              </AppText>
            </>
          ) : (
            purpose ? (
              <AppText variant="bodySm" tone="secondary" style={styles.purposeBody}>{purpose}</AppText>
            ) : null
          )}
          <View style={styles.sectionGap} />
        </>
      )}

      {/* 招待コード */}
      <AppText variant="sectionTitle" style={styles.sectionTitle}>招待コード</AppText>
      <View style={styles.codeRow}>
        <Text style={[styles.inviteCode, { color: colors.text }]}>{inviteCode}</Text>
        <AppButton label={copied ? 'コピーしました' : 'コピー'} variant="primary" size="xs" onPress={handleCopyCode} />
      </View>
      <View style={styles.sectionGap} />

      {/* 歌会名（オーナーのみ編集可） */}
      {isOwner && (
        <>
          <AppText variant="sectionTitle" style={styles.sectionTitle}>歌会の名前</AppText>
          <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} value={editingName} onChangeText={setEditingName} onBlur={handleBlurGroupName} maxLength={16} />
          {savedHint === 'groupName' && <AppText variant="caption" tone="tertiary" style={styles.savedHint}>保存しました</AppText>}
          <View style={styles.sectionGap} />
        </>
      )}

      {/* 自分の表示名 */}
      <AppText variant="sectionTitle" style={styles.sectionTitle}>この歌会でのあなたの名前</AppText>
      <AppText variant="caption" tone="secondary" style={styles.hint}>この歌会でのみ使われる名前です。他の歌会には影響しません。</AppText>
      <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} value={displayName} onChangeText={setDisplayName} onBlur={handleBlurDisplayName} placeholder="あなたの名前" placeholderTextColor={colors.textTertiary} maxLength={16} />
      {savedHint === 'displayName' && <AppText variant="caption" tone="tertiary" style={styles.savedHint}>保存しました</AppText>}
      <View style={styles.sectionGap} />

      {/* 通知 */}
      <AppText variant="sectionTitle" style={styles.sectionTitle}>通知</AppText>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <AppText variant="bodyLg">この歌会の通知をミュート</AppText>
        <Switch
          value={muted}
          onValueChange={async (v) => {
            setMuted(v);
            if (user) {
              await updateDoc(doc(db, 'groups', groupId, 'members', user.uid), { muted: v }).catch(() => {});
            }
          }}
          trackColor={colors.switchTrack}
          thumbColor={muted ? colors.switchThumb.on : colors.switchThumb.off}
        />
      </View>
      <View style={styles.sectionGap} />

      {/* 歌人一覧 */}
      <AppText variant="sectionTitle" style={styles.sectionTitle}>歌人一覧（{members.length}人）</AppText>
      {members.map(m => (
        <View key={m.id} style={[styles.memberRow, { borderBottomColor: colors.border }]}>
          <View style={styles.memberInfo}>
            <AppText variant="bodyLg">
              {m.displayName || '名無し'}
              {m.role === 'owner' && <MaterialCommunityIcons name="crown-outline" size={14} color={colors.textSecondary} style={{ marginLeft: 4 }} />}
            </AppText>
            <AppText variant="caption" tone="tertiary" style={styles.memberId}>#{m.userCode || '---'}</AppText>
          </View>
          {isOwner && m.id !== user?.uid && m.role !== 'owner' && (
            <AppButton label="追放" variant="outlineDestructive" size="xs" onPress={() => handleKick(m)} />
          )}
        </View>
      ))}
      <View style={styles.sectionGap} />

      {/* 追放リスト（オーナーのみ） */}
      {isOwner && Object.keys(bannedUsers).length > 0 && (
        <>
          <AppText variant="sectionTitle" style={styles.sectionTitle}>追放したユーザー（{Object.keys(bannedUsers).length}人）</AppText>
          <AppText variant="caption" tone="secondary" style={styles.hint}>解除すると、このユーザーは再び招待コードで参加できるようになります。</AppText>
          {Object.entries(bannedUsers).map(([uid, info]) => (
            <View key={uid} style={[styles.memberRow, { borderBottomColor: colors.border }]}>
              <View style={styles.memberInfo}>
                <AppText variant="bodyLg">{info.displayName || '名無し'}</AppText>
                <AppText variant="caption" tone="tertiary" style={styles.memberId}>#{info.userCode || '---'}</AppText>
              </View>
              <AppButton label="解除" variant="outlineMuted" size="xs" onPress={() => handleUnban(uid)} />
            </View>
          ))}
          <View style={styles.sectionGap} />
        </>
      )}

      {/* 通報の確認（オーナーのみ） */}
      {isOwner && (
        <>
          <AppText variant="sectionTitle" style={styles.sectionTitle}>通報</AppText>
          <TouchableOpacity
            style={[styles.linkRow, { borderBottomColor: colors.border }]}
            onPress={() => navigation.navigate('ReportReview', { groupId })}
          >
            <View style={{ flex: 1 }}>
              <AppText variant="body">通報の確認</AppText>
              <AppText variant="caption" tone="secondary" style={styles.linkSubText}>
                仮非表示になった歌・評を確認
              </AppText>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.sectionGap} />
        </>
      )}

      {/* 裁きについて（オーナーのみ） */}
      {isOwner && (
        <>
          <AppText variant="sectionTitle" style={styles.sectionTitle}>裁きについて</AppText>
          <AppText variant="caption">
            歌や評の詳細画面から、不適切な投稿に対して裁きを行えます。{'\n\n'}
            <AppText variant="caption" weight="medium">🟡 戒告</AppText>
            {'　'}投稿を反故にし、著者に警告を与えます。同じ歌人への戒告が3回に達すると、自動的に破門されます。{'\n\n'}
            <AppText variant="caption" weight="medium">🔴 破門</AppText>
            {'　'}投稿を反故にし、著者を即座に歌会から追放します。追放されたユーザーは招待コードで再参加できなくなります。{'\n\n'}
            裁かれた投稿は「反故」として跡地が残り、本文は見えなくなります。裁きは匿名のまま行われ、オーナーにも著者は分かりません。破門が発生した場合のみ、メンバー全員に通知されます。
          </AppText>
          <View style={styles.sectionGap} />
        </>
      )}

      {/* 歌会の退会（オーナー以外） */}
      {!isOwner && (
        <TouchableOpacity
          style={styles.footerLinkBtn}
          onPress={() => {
            alert('歌会を退会しますか？', '招待コードで再び参加できます。', [
              { text: 'やめる', style: 'cancel' },
              {
                text: '退会する',
                onPress: () => {
                  if (!user) return;
                  navigation.popToTop();
                  // 退会処理は pastMembers への追加を含むので Cloud Function 経由。
                  // 失敗は無視（破棄済みの画面に alert を出しても意味がないため）。
                  const fns = getFunctions(undefined, 'asia-northeast1');
                  httpsCallable(fns, 'leaveGroup')({ groupId }).catch(() => {});
                },
              },
            ]);
          }}
        >
          <AppText variant="body" tone="secondary">歌会を退会する</AppText>
        </TouchableOpacity>
      )}

      {/* 歌会の解散（オーナーのみ） */}
      {isOwner && (
        <TouchableOpacity style={styles.footerLinkBtn} onPress={() => setShowDissolve(true)}>
          <AppText variant="body" tone="destructive">歌会を解散する</AppText>
        </TouchableOpacity>
      )}

      {/* 解散確認モーダル */}
      <Modal visible={showDissolve} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.dissolveModal, { backgroundColor: colors.surface, borderColor: colors.destructive }]}>
            <AppText variant="sectionTitle" tone="destructive" style={styles.dissolveTitle}>歌会の解散</AppText>
            <AppText variant="caption" style={styles.dissolveWarning}>
              この操作は取り消せません。{'\n\n'}
              「{groupName}」のメンバー情報と歌会そのものが削除されます。{'\n'}
              歌はそのまま残り、歌集やブックマークから引き続き読めます。
            </AppText>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setDeleteAllPosts(prev => !prev)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, { borderColor: colors.destructive }, deleteAllPosts && { backgroundColor: colors.destructive }]}>
                {deleteAllPosts && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <AppText variant="caption" tone="destructive" style={styles.checkboxLabel}>すべての歌・リアクション・評・栞も削除する</AppText>
            </TouchableOpacity>

            <AppText variant="caption" tone="secondary" style={styles.dissolveInstruction}>
              確認のため、歌会の名前を正確に入力してください：
            </AppText>
            <AppText variant="bodyLg" weight="medium" style={[styles.dissolveGroupName, { backgroundColor: colors.bg }]}>
              {groupName}
            </AppText>
            <TextInput
              style={[
                styles.dissolveInput,
                { borderColor: colors.border, color: colors.text },
                dissolveConfirmText === groupName && { borderColor: colors.destructive },
              ]}
              value={dissolveConfirmText}
              onChangeText={setDissolveConfirmText}
              placeholder="歌会の名前を入力"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
            />

            <View style={styles.dissolveButtons}>
              <AppButton
                label="やめる"
                variant="secondary"
                onPress={() => { setShowDissolve(false); setDissolveConfirmText(''); setDeleteAllPosts(false); }}
                style={styles.dissolveBtnFlex}
              />
              <AppButton
                label={dissolving ? '削除中...' : '完全に削除する'}
                variant="destructive"
                onPress={handleDissolve}
                disabled={dissolveConfirmText !== groupName || dissolving}
                loading={dissolving}
                style={styles.dissolveBtnFlex}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 20, paddingBottom: 60 },
  sectionTitle: { marginBottom: 4 },
  sectionGap: { height: 24 },
  hint: { marginBottom: 8 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inviteCode: { fontSize: 24, letterSpacing: 6, fontFamily: 'IBMPlexMono_600SemiBold', flex: 1 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12 },
  savedHint: { marginTop: 4 },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1,
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1,
  },
  memberInfo: { flex: 1 },
  memberId: { marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  linkSubText: { marginTop: 2 },
  footerLinkBtn: { alignItems: 'center', marginTop: 24, paddingVertical: 12 },

  // 解散確認モーダル
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  dissolveModal: {
    borderRadius: 16, padding: 24,
    width: '90%', borderWidth: 2,
  },
  dissolveTitle: { marginBottom: 12, textAlign: 'center' },
  dissolveWarning: { marginBottom: 20 },
  dissolveInstruction: { marginBottom: 8 },
  dissolveGroupName: {
    padding: 8, borderRadius: 6,
    textAlign: 'center', marginBottom: 12, overflow: 'hidden',
  },
  dissolveInput: {
    borderWidth: 2, borderRadius: 8,
    padding: 12, fontSize: 16, marginBottom: 20, textAlign: 'center',
  },
  dissolveButtons: { flexDirection: 'row', gap: 12 },
  dissolveBtnFlex: { flex: 1, alignSelf: 'auto' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 20 },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2,
    justifyContent: 'center', alignItems: 'center',
  },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  checkboxLabel: { flex: 1 },
  purposeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  publicBadge: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  publicBadgeText: { fontSize: 10, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 1 },
  purposeBody: { marginBottom: 8 },
  purposeEditInput: { minHeight: 100, textAlignVertical: 'top' },
});
