import { MaterialCommunityIcons } from '@expo/vector-icons';
import { arrayUnion, collection, doc, getDoc, getDocs, increment, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { GroupDoc } from '../types';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function UtakaiListScreen({ navigation }: any) {
  const { user, userCode } = useAuth();
  const { alert } = useAlert();
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
        <TouchableOpacity onPress={() => setShowMenu(true)} hitSlop={8} style={{ padding: 8, marginRight: 8 }}>
          <MaterialCommunityIcons name="plus" size={24} color="#2C2418" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

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
          });
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
    });

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
  const handleJoinStep1 = async () => {
    if (!user || !joinCode.trim()) return;
    try {
      const q = query(collection(db, 'groups'), where('inviteCode', '==', joinCode.trim().toUpperCase()));
      const snap = await getDocs(q);
      if (snap.empty) { alert('エラー', '招待コードが見つかりません'); return; }
      const groupDoc = snap.docs[0];
      const banned = groupDoc.data().bannedUsers || {};
      if (user.uid in banned) { alert('エラー', 'この歌会には参加できません'); setShowJoin(false); setJoinCode(''); return; }
      const memberSnap = await getDoc(doc(db, 'groups', groupDoc.id, 'members', user.uid));
      if (memberSnap.exists()) { alert('', 'すでに参加しています'); setShowJoin(false); return; }
      setMemberDisplayName('');
      setPendingAction({ type: 'join', groupId: groupDoc.id, groupName: groupDoc.data().name });
      setShowJoin(false);
      setShowSetName(true);
    } catch (e: any) { alert('エラー', e.message); }
  };

  // 表示名確定後に実際の作成/参加を実行
  const handleConfirmName = async () => {
    if (!user || !pendingAction || !memberDisplayName.trim()) return;
    const displayName = memberDisplayName.trim();
    try {
      if (pendingAction.type === 'create') {
        const inviteCode = generateInviteCode();
        const groupRef = doc(collection(db, 'groups'));
        await setDoc(groupRef, { name: pendingAction.groupName, inviteCode, memberCount: 1, createdBy: user.uid, createdAt: serverTimestamp() });
        await setDoc(doc(db, 'groups', groupRef.id, 'members', user.uid), { displayName, userCode, joinedAt: serverTimestamp(), role: 'owner' });
        await updateDoc(doc(db, 'users', user.uid), { joinedGroups: arrayUnion(groupRef.id) });
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
    } catch (e: any) { alert('エラー', e.message); }
  };

  return (
    <GradientBackground style={styles.container}>
      <FlatList data={groups} keyExtractor={item => item.id} contentContainerStyle={styles.list}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>歌会がありません</Text><Text style={styles.emptySubtext}>右上の＋から歌会を開くか{'\n'}参加しましょう</Text></View>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Timeline', { groupId: item.id, groupName: item.name })}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.cardMembers}>{item.memberCount}人</Text>
          </TouchableOpacity>
        )}
      />

      {/* アクションメニュー */}
      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={styles.menuModal}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); setShowCreate(true); }}>
              <MaterialCommunityIcons name="plus-circle-outline" size={22} color="#2C2418" />
              <Text style={styles.menuText}>歌会を開く</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); setShowJoin(true); }}>
              <MaterialCommunityIcons name="key-variant" size={22} color="#2C2418" />
              <Text style={styles.menuText}>招待コードで参加</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 歌会作成モーダル */}
      <Modal visible={showCreate} transparent animationType="fade">
        <View style={styles.modalOverlay}><View style={styles.modal}>
          <Text style={styles.modalTitle}>歌会を開く</Text>
          <TextInput style={styles.input} placeholder="歌会の名前" value={newName} onChangeText={setNewName} placeholderTextColor="#A69880" maxLength={16} />
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={() => { setShowCreate(false); setNewName(''); }}><Text style={styles.cancelText}>やめる</Text></TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleCreateStep1}><Text style={styles.confirmText}>次へ</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* 招待コードモーダル */}
      <Modal visible={showJoin} transparent animationType="fade">
        <View style={styles.modalOverlay}><View style={styles.modal}>
          <Text style={styles.modalTitle}>歌会に参加</Text>
          <TextInput style={[styles.input, styles.codeInput]} placeholder="招待コード（6文字）" value={joinCode} onChangeText={handleJoinCodeChange} autoCapitalize="characters" autoCorrect={false} placeholderTextColor="#A69880" />
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={() => { setShowJoin(false); setJoinCode(''); }}><Text style={styles.cancelText}>やめる</Text></TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleJoinStep1}><Text style={styles.confirmText}>次へ</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* 表示名設定モーダル */}
      <Modal visible={showSetName} transparent animationType="fade">
        <View style={styles.modalOverlay}><View style={styles.modal}>
          <Text style={styles.modalTitle}>
            {pendingAction?.type === 'create' ? '歌会を開く' : `「${pendingAction?.groupName}」に参加`}
          </Text>
          <Text style={styles.modalHint}>この歌会でのあなたの名前を決めてください{'\n'}後から歌会設定で変更できます</Text>
          <TextInput style={styles.input} placeholder="あなたの名前" value={memberDisplayName} onChangeText={setMemberDisplayName} placeholderTextColor="#A69880" maxLength={16} autoFocus />
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={() => { setShowSetName(false); setPendingAction(null); }}><Text style={styles.cancelText}>やめる</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.confirmBtn, !memberDisplayName.trim() && { opacity: 0.4 }]} onPress={handleConfirmName} disabled={!memberDisplayName.trim()}>
              <Text style={styles.confirmText}>{pendingAction?.type === 'create' ? '開く' : '参加'}</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  list: { padding: 16, paddingBottom: 24 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 18, color: '#8B7E6A', marginBottom: 8 },
  emptySubtext: { fontSize: 13, color: '#A69880', textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: '#FFFDF8', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E8E0D0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { fontSize: 18, color: '#2C2418', fontFamily: 'NotoSerifJP_500Medium', flex: 1, marginRight: 12 },
  cardMembers: { fontSize: 13, color: '#A69880' },
  menuModal: { backgroundColor: '#FFFDF8', borderRadius: 16, padding: 8, width: '75%' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  menuText: { fontSize: 16, color: '#2C2418' },
  menuDivider: { height: 1, backgroundColor: '#E8E0D0', marginHorizontal: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#FFFDF8', borderRadius: 16, padding: 24, width: '85%' },
  modalTitle: { fontSize: 18, color: '#2C2418', fontWeight: '500', marginBottom: 8 },
  modalHint: { fontSize: 12, color: '#8B7E6A', lineHeight: 18, marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#E8E0D0', borderRadius: 8, padding: 12, fontSize: 16, color: '#2C2418', marginBottom: 20 },
  codeInput: { fontFamily: 'UbuntuMono_400Regular', letterSpacing: 4, textAlign: 'center', fontSize: 20 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' },
  cancelText: { color: '#8B7E6A', fontSize: 15 },
  confirmBtn: { backgroundColor: '#2C2418', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  confirmText: { color: '#F5F0E8', fontSize: 15 },
});
