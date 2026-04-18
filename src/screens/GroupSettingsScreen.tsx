import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { arrayRemove, collection, deleteDoc, doc, getDoc, getDocs, increment, updateDoc } from 'firebase/firestore';
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
import { useAlert } from '../components/CustomAlert';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';
import { MemberDoc } from '../types';

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
      alert('エラー', e?.message || '更新できませんでした');
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
            try {
              const functions = getFunctions(undefined, 'asia-northeast1');
              const kickMemberFn = httpsCallable(functions, 'kickMember');
              await kickMemberFn({ groupId, targetUserId: member.id });
              setMembers(prev => prev.filter(m => m.id !== member.id));
              setBannedUsers(prev => ({ ...prev, [member.id]: { displayName: member.displayName, userCode: member.userCode } }));
              alert('追放しました');
            } catch (e: any) { alert('エラー', e.message); }
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
            } catch (e: any) { alert('エラー', e.message); }
          },
        },
      ]
    );
  };

  const handleDissolve = async () => {
    if (dissolveConfirmText !== groupName) return;
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
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.purposeHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>趣意</Text>
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
              <Text style={[styles.savedHint, { color: colors.textTertiary }]}>
                {savedHint === 'purpose' ? '保存しました' : `${editingPurpose.trim().length} / 200`}
              </Text>
            </>
          ) : (
            purpose ? (
              <Text style={[styles.purposeBody, { color: colors.textSecondary }]}>{purpose}</Text>
            ) : null
          )}
        </View>
      )}

      {/* 招待コード */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>招待コード</Text>
        <View style={styles.codeRow}>
          <Text style={[styles.inviteCode, { color: colors.text }]}>{inviteCode}</Text>
          <TouchableOpacity style={[styles.copyBtn, { backgroundColor: colors.accent }]} onPress={handleCopyCode}>
            <Text style={[styles.copyBtnText, { color: colors.accentText }]}>{copied ? 'コピーしました' : 'コピー'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 歌会名（オーナーのみ編集可） */}
      {isOwner && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>歌会の名前</Text>
          <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} value={editingName} onChangeText={setEditingName} onBlur={handleBlurGroupName} maxLength={16} />
          {savedHint === 'groupName' && <Text style={[styles.savedHint, { color: colors.textTertiary }]}>保存しました</Text>}
        </View>
      )}

      {/* 自分の表示名 */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>この歌会でのあなたの名前</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>この歌会でのみ使われる名前です。他の歌会には影響しません。</Text>
        <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} value={displayName} onChangeText={setDisplayName} onBlur={handleBlurDisplayName} placeholder="あなたの名前" placeholderTextColor={colors.textTertiary} maxLength={16} />
        {savedHint === 'displayName' && <Text style={[styles.savedHint, { color: colors.textTertiary }]}>保存しました</Text>}
      </View>

      {/* 通知 */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>通知</Text>
        <View style={styles.muteRow}>
          <Text style={[styles.muteLabel, { color: colors.text }]}>この歌会の通知をミュート</Text>
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
      </View>

      {/* 歌人一覧 */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>歌人一覧（{members.length}人）</Text>
        {members.map(m => (
          <View key={m.id} style={[styles.memberRow, { borderBottomColor: colors.border }]}>
            <View style={styles.memberInfo}>
              <Text style={[styles.memberName, { color: colors.text }]}>
                {m.displayName || '名無し'}
                {m.role === 'owner' && <MaterialCommunityIcons name="crown-outline" size={14} color={colors.textSecondary} style={{ marginLeft: 4 }} />}
              </Text>
              <Text style={[styles.memberId, { color: colors.textTertiary }]}>#{m.userCode || '---'}</Text>
            </View>
            {isOwner && m.id !== user?.uid && m.role !== 'owner' && (
              <AppButton label="追放" variant="outlineDestructive" size="sm" onPress={() => handleKick(m)} />
            )}
          </View>
        ))}
      </View>

      {/* 追放リスト（オーナーのみ） */}
      {isOwner && Object.keys(bannedUsers).length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>追放したユーザー（{Object.keys(bannedUsers).length}人）</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>解除すると、このユーザーは再び招待コードで参加できるようになります。</Text>
          {Object.entries(bannedUsers).map(([uid, info]) => (
            <View key={uid} style={[styles.memberRow, { borderBottomColor: colors.border }]}>
              <View style={styles.memberInfo}>
                <Text style={[styles.memberName, { color: colors.text }]}>{info.displayName || '名無し'}</Text>
                <Text style={[styles.memberId, { color: colors.textTertiary }]}>#{info.userCode || '---'}</Text>
              </View>
              <AppButton label="解除" variant="outlineMuted" size="sm" onPress={() => handleUnban(uid)} />
            </View>
          ))}
        </View>
      )}

      {/* 通報の確認（オーナーのみ） */}
      {isOwner && (
        <TouchableOpacity
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
          onPress={() => navigation.navigate('ReportReview', { groupId })}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>通報の確認</Text>
            <Text style={[styles.judgmentExplain, { color: colors.textSecondary, marginTop: 4 }]}>
              仮非表示になった歌・評を確認して、解除または裁きに昇格します。
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      {/* 裁きについて（オーナーのみ） */}
      {isOwner && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>裁きについて</Text>
          <Text style={[styles.judgmentExplain, { color: colors.text }]}>
            歌や評の詳細画面から、不適切な投稿に対して裁きを行えます。{'\n\n'}
            <Text style={{ fontWeight: '600' }}>🟡 戒告</Text>
            {'　'}投稿を反故にし、著者に警告を与えます。同じ歌人への戒告が3回に達すると、自動的に破門されます。{'\n\n'}
            <Text style={{ fontWeight: '600' }}>🔴 破門</Text>
            {'　'}投稿を反故にし、著者を即座に歌会から追放します。追放されたユーザーは招待コードで再参加できなくなります。{'\n\n'}
            裁かれた投稿は「反故」として跡地が残り、本文は見えなくなります。裁きは匿名のまま行われ、オーナーにも著者は分かりません。破門が発生した場合のみ、メンバー全員に通知されます。
          </Text>
        </View>
      )}

      {/* 歌会の退会（オーナー以外） */}
      {!isOwner && (
        <AppButton
          label="歌会を退会する"
          variant="outlineMuted"
          fullWidth
          style={styles.footerBtn}
          onPress={() => {
            alert('歌会を退会しますか？', '招待コードで再び参加できます。', [
              { text: 'やめる', style: 'cancel' },
              {
                text: '退会する',
                onPress: () => {
                  if (!user) return;
                  navigation.popToTop();
                  deleteDoc(doc(db, 'groups', groupId, 'members', user.uid))
                    .then(() => updateDoc(doc(db, 'groups', groupId), { memberCount: increment(-1) }))
                    .then(() => updateDoc(doc(db, 'users', user.uid), { joinedGroups: arrayRemove(groupId) }))
                    .catch(() => {});
                },
              },
            ]);
          }}
        />
      )}

      {/* 歌会の解散（オーナーのみ） */}
      {isOwner && (
        <AppButton
          label="歌会を解散する"
          variant="outlineDestructive"
          fullWidth
          style={styles.footerBtn}
          onPress={() => setShowDissolve(true)}
        />
      )}

      {/* 解散確認モーダル */}
      <Modal visible={showDissolve} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.dissolveModal, { backgroundColor: colors.surface, borderColor: colors.destructive }]}>
            <Text style={[styles.dissolveTitle, { color: colors.destructive }]}>歌会の解散</Text>
            <Text style={[styles.dissolveWarning, { color: colors.text }]}>
              この操作は取り消せません。{'\n\n'}
              「{groupName}」のメンバー情報と歌会そのものが削除されます。{'\n'}
              歌はそのまま残り、歌集やブックマークから引き続き読めます。
            </Text>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setDeleteAllPosts(prev => !prev)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, { borderColor: colors.destructive }, deleteAllPosts && { backgroundColor: colors.destructive }]}>
                {deleteAllPosts && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.checkboxLabel, { color: colors.destructive }]}>すべての歌・リアクション・評・栞も削除する</Text>
            </TouchableOpacity>

            <Text style={[styles.dissolveInstruction, { color: colors.textSecondary }]}>
              確認のため、歌会の名前を正確に入力してください：
            </Text>
            <Text style={[styles.dissolveGroupName, { color: colors.text, backgroundColor: colors.bg }]}>
              {groupName}
            </Text>
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
  section: {
    borderRadius: 12, padding: 16,
    marginBottom: 16, borderWidth: 1,
  },
  sectionTitle: { fontSize: 17, fontWeight: '500', marginBottom: 4, fontFamily: 'NotoSerifJP_500Medium' },
  hint: { fontSize: 12, lineHeight: 18, marginBottom: 8 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inviteCode: { fontSize: 24, letterSpacing: 6, fontFamily: 'IBMPlexMono_600SemiBold', flex: 1 },
  copyBtn: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  copyBtnText: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12 },
  savedHint: { fontSize: 12, marginTop: 4 },
  muteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  muteLabel: { fontSize: 16, fontFamily: 'NotoSerifJP_400Regular' },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 16, fontFamily: 'NotoSerifJP_400Regular' },
  ownerBadge: { fontSize: 14 },
  memberId: { fontSize: 12, marginTop: 2 },
  footerBtn: { marginTop: 16 },

  // 退会ボタン

  // 解散確認モーダル
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  dissolveModal: {
    borderRadius: 16, padding: 24,
    width: '90%', borderWidth: 2,
  },
  dissolveTitle: { fontSize: 20, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  dissolveWarning: { fontSize: 13, lineHeight: 22, marginBottom: 20 },
  dissolveInstruction: { fontSize: 13, marginBottom: 8 },
  dissolveGroupName: {
    fontSize: 16, fontWeight: '600',
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
  checkboxLabel: { fontSize: 13, flex: 1 },
  judgmentExplain: { fontSize: 13, lineHeight: 22 },
  purposeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  publicBadge: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  publicBadgeText: { fontSize: 10, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 1 },
  purposeBody: { fontSize: 14, lineHeight: 22, fontFamily: 'NotoSerifJP_400Regular', marginBottom: 8 },
  purposeEditInput: { minHeight: 100, textAlignVertical: 'top' },
});
