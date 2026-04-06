import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { arrayRemove, collection, deleteDoc, doc, getDoc, getDocs, increment, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { useAlert } from '../components/CustomAlert';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { MemberDoc } from '../types';

export default function GroupSettingsScreen({ route, navigation }: any) {
  const { groupId } = route.params;
  const { user } = useAuth();
  const [groupName, setGroupName] = useState('');
  const [editingName, setEditingName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState<(MemberDoc & { id: string })[]>([]);
  const [savingName, setSavingName] = useState(false);
  const [savingGroupName, setSavingGroupName] = useState(false);
  const [copied, setCopied] = useState(false);
  const { alert } = useAlert();

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
        setInviteCode(data.inviteCode);
        setBannedUsers(data.bannedUsers || []);
      }
      const memberSnap = await getDoc(doc(db, 'groups', groupId, 'members', user.uid));
      if (memberSnap.exists()) {
        const data = memberSnap.data();
        setDisplayName(data.displayName || '');
        setIsOwner(data.role === 'owner');
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

  const handleSaveDisplayName = async () => {
    if (!user || !displayName.trim()) { alert('名前を入力してください'); return; }
    setSavingName(true);
    try {
      await updateDoc(doc(db, 'groups', groupId, 'members', user.uid), { displayName: displayName.trim() });
      setMembers(prev => prev.map(m => m.id === user.uid ? { ...m, displayName: displayName.trim() } : m));
      alert('保存しました');
    } catch (e: any) { alert('エラー', e.message); }
    finally { setSavingName(false); }
  };

  const handleSaveGroupName = async () => {
    if (!editingName.trim()) { alert('歌会の名前を入力してください'); return; }
    setSavingGroupName(true);
    try {
      await updateDoc(doc(db, 'groups', groupId), { name: editingName.trim() });
      setGroupName(editingName.trim());
      navigation.setParams({ groupName: editingName.trim() });
      alert('保存しました');
    } catch (e: any) { alert('エラー', e.message); }
    finally { setSavingGroupName(false); }
  };

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 招待コード */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>招待コード</Text>
        <View style={styles.codeRow}>
          <Text style={styles.inviteCode}>{inviteCode}</Text>
          <TouchableOpacity style={styles.copyBtn} onPress={handleCopyCode}>
            <Text style={styles.copyBtnText}>{copied ? 'コピーしました' : 'コピー'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 歌会名（オーナーのみ編集可） */}
      {isOwner && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>歌会の名前</Text>
          <TextInput style={styles.input} value={editingName} onChangeText={setEditingName} maxLength={30} />
          <TouchableOpacity
            style={[styles.saveBtn, savingGroupName && styles.saveBtnDisabled]}
            onPress={handleSaveGroupName} disabled={savingGroupName}
          >
            <Text style={styles.saveBtnText}>名前を保存</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 自分の表示名 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>この歌会でのあなたの名前</Text>
        <Text style={styles.hint}>この歌会でのみ使われる名前です。他の歌会には影響しません。</Text>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="あなたの名前" placeholderTextColor="#A69880" maxLength={20} />
        <TouchableOpacity
          style={[styles.saveBtn, savingName && styles.saveBtnDisabled]}
          onPress={handleSaveDisplayName} disabled={savingName}
        >
          <Text style={styles.saveBtnText}>名前を保存</Text>
        </TouchableOpacity>
      </View>

      {/* 歌人一覧 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>歌人一覧（{members.length}人）</Text>
        {members.map(m => (
          <View key={m.id} style={styles.memberRow}>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>
                {m.displayName || '名無し'}
                {m.role === 'owner' && <MaterialCommunityIcons name="crown-outline" size={14} color="#8B7E6A" style={{ marginLeft: 4 }} />}
              </Text>
              <Text style={styles.memberId}>#{m.userCode || '---'}</Text>
            </View>
            {isOwner && m.id !== user?.uid && m.role !== 'owner' && (
              <TouchableOpacity style={styles.kickBtn} onPress={() => handleKick(m)}>
                <Text style={styles.kickBtnText}>追放</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      {/* 追放リスト（オーナーのみ） */}
      {isOwner && Object.keys(bannedUsers).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>追放したユーザー（{Object.keys(bannedUsers).length}人）</Text>
          <Text style={styles.hint}>解除すると、このユーザーは再び招待コードで参加できるようになります。</Text>
          {Object.entries(bannedUsers).map(([uid, info]) => (
            <View key={uid} style={styles.memberRow}>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{info.displayName || '名無し'}</Text>
                <Text style={styles.memberId}>#{info.userCode || '---'}</Text>
              </View>
              <TouchableOpacity style={styles.unbanBtn} onPress={() => handleUnban(uid)}>
                <Text style={styles.unbanBtnText}>解除</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* 歌会の退会（オーナー以外） */}
      {!isOwner && (
        <TouchableOpacity style={styles.leaveBtn} onPress={() => {
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
        }}>
          <Text style={styles.leaveBtnText}>歌会を退会する</Text>
        </TouchableOpacity>
      )}

      {/* 歌会の解散（オーナーのみ） */}
      {isOwner && (
        <TouchableOpacity style={styles.dissolveBtn} onPress={() => setShowDissolve(true)}>
          <Text style={styles.dissolveBtnText}>歌会を解散する</Text>
        </TouchableOpacity>
      )}

      {/* 解散確認モーダル */}
      <Modal visible={showDissolve} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.dissolveModal}>
            <Text style={styles.dissolveTitle}>歌会の解散</Text>
            <Text style={styles.dissolveWarning}>
              この操作は取り消せません。{'\n\n'}
              「{groupName}」のメンバー情報と歌会そのものが削除されます。{'\n'}
              歌はそのまま残り、歌集やブックマークから引き続き読めます。
            </Text>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setDeleteAllPosts(prev => !prev)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, deleteAllPosts && styles.checkboxChecked]}>
                {deleteAllPosts && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>すべての歌・リアクション・評・栞も削除する</Text>
            </TouchableOpacity>

            <Text style={styles.dissolveInstruction}>
              確認のため、歌会の名前を正確に入力してください：
            </Text>
            <Text style={styles.dissolveGroupName}>
              {groupName}
            </Text>
            <TextInput
              style={[
                styles.dissolveInput,
                dissolveConfirmText === groupName && styles.dissolveInputMatch,
              ]}
              value={dissolveConfirmText}
              onChangeText={setDissolveConfirmText}
              placeholder="歌会の名前を入力"
              placeholderTextColor="#A69880"
              autoCorrect={false}
            />

            <View style={styles.dissolveButtons}>
              <TouchableOpacity
                style={styles.dissolveCancelBtn}
                onPress={() => { setShowDissolve(false); setDissolveConfirmText(''); setDeleteAllPosts(false); }}
              >
                <Text style={styles.dissolveCancelText}>やめる</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.dissolveConfirmBtn,
                  (dissolveConfirmText !== groupName || dissolving) && styles.dissolveConfirmBtnDisabled,
                ]}
                onPress={handleDissolve}
                disabled={dissolveConfirmText !== groupName || dissolving}
              >
                <Text style={styles.dissolveConfirmText}>
                  {dissolving ? '削除中...' : '完全に削除する'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  content: { padding: 20, paddingBottom: 60 },
  section: {
    backgroundColor: '#FFFDF8', borderRadius: 12, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: '#E8E0D0',
  },
  sectionTitle: { fontSize: 16, color: '#2C2418', fontWeight: '500', marginBottom: 8 },
  hint: { fontSize: 12, color: '#8B7E6A', lineHeight: 18, marginBottom: 12 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inviteCode: { fontSize: 24, color: '#2C2418', letterSpacing: 6, fontWeight: '500', flex: 1 },
  copyBtn: { backgroundColor: '#2C2418', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  copyBtnText: { color: '#F5F0E8', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#E8E0D0', borderRadius: 8, padding: 12, fontSize: 16, color: '#2C2418', marginBottom: 12 },
  saveBtn: { backgroundColor: '#2C2418', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#F5F0E8', fontSize: 14 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0EBE0',
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, color: '#2C2418' },
  ownerBadge: { fontSize: 14 },
  memberId: { fontSize: 12, color: '#A69880', marginTop: 2 },
  kickBtn: { borderWidth: 1, borderColor: '#C53030', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  kickBtnText: { color: '#C53030', fontSize: 12 },
  unbanBtn: { borderWidth: 1, borderColor: '#8B7E6A', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  unbanBtnText: { color: '#8B7E6A', fontSize: 12 },

  // 退会ボタン
  leaveBtn: {
    marginTop: 16, paddingVertical: 14, alignItems: 'center',
    borderRadius: 12, borderWidth: 1, borderColor: '#8B7E6A',
  },
  leaveBtnText: { color: '#8B7E6A', fontSize: 15 },

  // 解散ボタン
  dissolveBtn: {
    marginTop: 16, paddingVertical: 14, alignItems: 'center',
    borderRadius: 12, borderWidth: 1, borderColor: '#C53030',
  },
  dissolveBtnText: { color: '#C53030', fontSize: 15 },

  // 解散確認モーダル
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  dissolveModal: {
    backgroundColor: '#FFFDF8', borderRadius: 16, padding: 24,
    width: '90%', borderWidth: 2, borderColor: '#C53030',
  },
  dissolveTitle: { fontSize: 20, color: '#C53030', fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  dissolveWarning: { fontSize: 13, color: '#2C2418', lineHeight: 22, marginBottom: 20 },
  dissolveInstruction: { fontSize: 13, color: '#8B7E6A', marginBottom: 8 },
  dissolveGroupName: {
    fontSize: 16, color: '#2C2418', fontWeight: '600',
    backgroundColor: '#F5F0E8', padding: 8, borderRadius: 6,
    textAlign: 'center', marginBottom: 12, overflow: 'hidden',
  },
  dissolveInput: {
    borderWidth: 2, borderColor: '#E8E0D0', borderRadius: 8,
    padding: 12, fontSize: 16, color: '#2C2418', marginBottom: 20, textAlign: 'center',
  },
  dissolveInputMatch: { borderColor: '#C53030' },
  dissolveButtons: { flexDirection: 'row', gap: 12 },
  dissolveCancelBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#E8E0D0' },
  dissolveCancelText: { color: '#8B7E6A', fontSize: 15 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 20 },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#C53030',
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#C53030' },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  checkboxLabel: { fontSize: 13, color: '#C53030', flex: 1 },
  dissolveConfirmBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 8, backgroundColor: '#C53030' },
  dissolveConfirmBtnDisabled: { opacity: 0.3 },
  dissolveConfirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
