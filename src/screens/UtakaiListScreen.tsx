import { MaterialCommunityIcons } from '@expo/vector-icons';
import { arrayUnion, collection, doc, getDoc, getDocs, increment, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';
import { GroupDoc } from '../types';
import { fs } from '../utils/scale';

export default function UtakaiListScreen({ navigation }: any) {
  const { user, userCode } = useAuth();
  const { alert } = useAlert();
  const { colors } = useTheme();
  const [groups, setGroups] = useState<(GroupDoc & { id: string })[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showSetName, setShowSetName] = useState(false);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [memberDisplayName, setMemberDisplayName] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | { type: 'create'; groupName: string } | { type: 'join'; groupId: string; groupName: string }>(null);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => setShowMenu(true)} hitSlop={8} style={{ padding: 8 }}>
          <MaterialCommunityIcons name="plus" size={24} color={colors.text} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colors]);

  useEffect(() => {
    if (!user) return;
    const groupUnsubs: (() => void)[] = [];

    const unsub = onSnapshot(doc(db, 'users', user.uid), async (snap) => {
      // 前回のグループ監視を解除
      groupUnsubs.forEach(u => u());
      groupUnsubs.length = 0;

      const groupIds: string[] = snap.data()?.joinedGroups || [];
      if (groupIds.length === 0) { setGroups([]); return; }

      // joinedGroupsに含まれないグループをstateから除去
      setGroups(prev => prev.filter(g => groupIds.includes(g.id)));

      // 各グループをリアルタイム監視
      const removedIds: string[] = [];
      for (const gid of groupIds) {
        try {
          const memberSnap = await getDoc(doc(db, 'groups', gid, 'members', user.uid));
          if (!memberSnap.exists()) { removedIds.push(gid); continue; }
          const groupUnsub = onSnapshot(doc(db, 'groups', gid), (gSnap) => {
            if (!gSnap.exists()) {
              setGroups(prev => prev.filter(g => g.id !== gid));
              return;
            }
            const groupData = { id: gSnap.id, ...gSnap.data() } as GroupDoc & { id: string };
            setGroups(prev => {
              const idx = prev.findIndex(g => g.id === gid);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = groupData;
                return next;
              }
              return [...prev, groupData];
            });
          }, () => {});
          groupUnsubs.push(groupUnsub);
        } catch { removedIds.push(gid); }
      }

      // joinedGroups のゴミ掃除
      if (removedIds.length > 0) {
        const { arrayRemove } = await import('firebase/firestore');
        for (const gid of removedIds) {
          await updateDoc(doc(db, 'users', user.uid), { joinedGroups: arrayRemove(gid) });
        }
      }
    }, () => {});

    return () => {
      unsub();
      groupUnsubs.forEach(u => u());
    };
  }, [user]);

  // 歌会作成: まず名前を聞いて、次に表示名を設定
  const handleCreateStep1 = async () => {
    if (!user || !newName.trim()) return;
    setMemberDisplayName('');
    setPendingAction({ type: 'create', groupName: newName.trim() });
    setShowCreate(false);
    setShowSetName(true);
  };

  const handleJoinCodeChange = (text: string) => {
    // 全角→半角変換、大文字化、英数字のみ抽出、6文字制限
    const halfWidth = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
    );
    const filtered = halfWidth.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setJoinCode(filtered);
  };

  // 歌会参加: まず招待コードを検証して、次に表示名を設定
  const [joining, setJoining] = useState(false);
  const handleJoinStep1 = async () => {
    if (!user || !joinCode.trim() || joining) return;
    setJoining(true);
    try {
      const q = query(collection(db, 'groups'), where('inviteCode', '==', joinCode.trim().toUpperCase()));
      const snap = await getDocs(q);
      if (snap.empty) { alert('エラー', '招待コードが見つかりません'); return; }
      const groupDoc = snap.docs[0];
      const banned = groupDoc.data().bannedUsers || {};
      if (user.uid in banned) { alert('エラー', 'この歌会には参加できません'); setShowJoin(false); setJoinCode(''); return; }
      const memberSnap = await getDoc(doc(db, 'groups', groupDoc.id, 'members', user.uid));
      if (memberSnap.exists()) { alert('', 'すでに参加しています'); setShowJoin(false); return; }
      if ((groupDoc.data().memberCount || 0) >= 500) { alert('エラー', 'この歌会は定員に達しています'); setShowJoin(false); setJoinCode(''); return; }
      setMemberDisplayName('');
      setPendingAction({ type: 'join', groupId: groupDoc.id, groupName: groupDoc.data().name });
      setShowJoin(false);
      setShowSetName(true);
    } catch (e: any) { alert('エラー', e.message); }
    finally { setJoining(false); }
  };

  // 表示名確定後に実際の作成/参加を実行
  const [confirming, setConfirming] = useState(false);

  const handleConfirmName = async () => {
    if (!user || !pendingAction || !memberDisplayName.trim() || confirming) return;
    setConfirming(true);
    const displayName = memberDisplayName.trim();
    try {
      if (pendingAction.type === 'create') {
        const fns = getFunctions(undefined, 'asia-northeast1');
        const createGroupFn = httpsCallable(fns, 'createGroup');
        await createGroupFn({ groupName: pendingAction.groupName, displayName });
      } else {
        const groupId = pendingAction.groupId;
        await setDoc(doc(db, 'groups', groupId, 'members', user.uid), { displayName, userCode, joinedAt: serverTimestamp(), role: 'member' });
        await updateDoc(doc(db, 'groups', groupId), { memberCount: increment(1) });
        await updateDoc(doc(db, 'users', user.uid), { joinedGroups: arrayUnion(groupId) });
      }
      setShowSetName(false);
      setNewName('');
      setJoinCode('');
      setPendingAction(null);
    } catch (e: any) {
      const msg = e?.code === 'functions/resource-exhausted'
        ? e.message
        : e?.message || 'エラーが発生しました';
      alert('エラー', msg);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <GradientBackground style={styles.container}>
      <FlatList data={groups} keyExtractor={item => item.id}
        contentContainerStyle={groups.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyText, { color: colors.textTertiary }]}>歌会がありません</Text><Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>右上の＋から歌会を開くか{'\n'}参加しましょう</Text></View>}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => navigation.navigate('Timeline', { groupId: item.id, groupName: item.name })}>
            <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.cardMembers, { color: colors.textTertiary }]}>{item.memberCount}人</Text>
          </TouchableOpacity>
        )}
      />

      {/* アクションメニュー */}
      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity style={[styles.modalOverlay, { backgroundColor: colors.overlay }]} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={[styles.menuModal, { backgroundColor: colors.surface }]}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); setShowCreate(true); }}>
              <MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.text} />
              <Text style={[styles.menuText, { color: colors.text }]}>歌会を開く</Text>
            </TouchableOpacity>
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); setShowJoin(true); }}>
              <MaterialCommunityIcons name="key-variant" size={22} color={colors.text} />
              <Text style={[styles.menuText, { color: colors.text }]}>招待コードで参加</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 歌会作成モーダル */}
      <Modal visible={showCreate} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}><View style={[styles.modal, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>歌会を開く</Text>
          <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} placeholder="歌会の名前" value={newName} onChangeText={setNewName} placeholderTextColor={colors.textTertiary} maxLength={16} />
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={() => { setShowCreate(false); setNewName(''); }}><Text style={[styles.cancelText, { color: colors.textSecondary }]}>やめる</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.accent }]} onPress={handleCreateStep1}><Text style={[styles.confirmText, { color: colors.accentText }]}>次へ</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* 招待コードモーダル */}
      <Modal visible={showJoin} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}><View style={[styles.modal, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>歌会に参加</Text>
          <TextInput style={[styles.input, styles.codeInput, { borderColor: colors.border, color: colors.text }]} placeholder="招待コード（6文字）" value={joinCode} onChangeText={handleJoinCodeChange} autoCapitalize="characters" autoCorrect={false} placeholderTextColor={colors.textTertiary} />
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={() => { setShowJoin(false); setJoinCode(''); }}><Text style={[styles.cancelText, { color: colors.textSecondary }]}>やめる</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.accent }]} onPress={handleJoinStep1}><Text style={[styles.confirmText, { color: colors.accentText }]}>次へ</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* 表示名設定モーダル */}
      <Modal visible={showSetName} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}><View style={[styles.modal, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {pendingAction?.type === 'create' ? '歌会を開く' : `「${pendingAction?.groupName}」に参加`}
          </Text>
          <Text style={[styles.modalHint, { color: colors.textSecondary }]}>この歌会でのあなたの名前を決めてください{'\n'}後から歌会設定で変更できます</Text>
          <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} placeholder="あなたの名前" value={memberDisplayName} onChangeText={setMemberDisplayName} placeholderTextColor={colors.textTertiary} maxLength={16} autoFocus />
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={() => { setShowSetName(false); setPendingAction(null); }}><Text style={[styles.cancelText, { color: colors.textSecondary }]}>やめる</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.accent }, (!memberDisplayName.trim() || confirming) && { opacity: 0.4 }]} onPress={handleConfirmName} disabled={!memberDisplayName.trim() || confirming}>
              <Text style={[styles.confirmText, { color: colors.accentText }]}>{pendingAction?.type === 'create' ? '開く' : '参加'}</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 24 },
  emptyList: { flex: 1, justifyContent: 'center' as const },
  empty: { alignItems: 'center' },
  emptyText: { fontSize: 17, fontFamily: 'NotoSerifJP_500Medium' },
  emptySubtext: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 8 },
  card: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 14, marginBottom: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { fontSize: fs(18), fontFamily: 'NotoSerifJP_500Medium', flex: 1, marginRight: 12 },
  cardMembers: { fontSize: 14 },
  menuModal: { borderRadius: 16, padding: 8, width: '75%' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  menuText: { fontSize: 17, fontFamily: 'NotoSerifJP_500Medium' },
  menuDivider: { height: 1, marginHorizontal: 12 },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modal: { borderRadius: 16, padding: 20, width: '85%' },
  modalTitle: { fontSize: 18, fontWeight: '500', marginBottom: 6, fontFamily: 'NotoSerifJP_500Medium' },
  modalHint: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 14 },
  codeInput: { fontFamily: 'IBMPlexMono_600SemiBold', letterSpacing: 4, textAlign: 'center', fontSize: 20 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' },
  cancelText: { fontSize: 16, lineHeight: 22, fontFamily: 'NotoSerifJP_400Regular' },
  confirmBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  confirmText: { fontSize: 16, lineHeight: 22, fontFamily: 'NotoSerifJP_500Medium' },
});
