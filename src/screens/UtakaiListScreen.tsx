import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, TextInput, Modal } from 'react-native';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, updateDoc, arrayUnion, increment, serverTimestamp, getDocs } from 'firebase/firestore';
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
  const { user } = useAuth();
  const [groups, setGroups] = useState<(GroupDoc & { id: string })[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), async (snap) => {
      const groupIds: string[] = snap.data()?.joinedGroups || [];
      if (groupIds.length === 0) { setGroups([]); return; }
      const fetched: (GroupDoc & { id: string })[] = [];
      for (const gid of groupIds) {
        const gSnap = await getDoc(doc(db, 'groups', gid));
        if (gSnap.exists()) fetched.push({ id: gSnap.id, ...gSnap.data() } as any);
      }
      setGroups(fetched);
    });
    return unsub;
  }, [user]);

  const handleCreate = async () => {
    if (!user || !newName.trim()) return;
    try {
      const inviteCode = generateInviteCode();
      const groupRef = doc(collection(db, 'groups'));
      await setDoc(groupRef, { name: newName.trim(), inviteCode, memberCount: 1, createdBy: user.uid, createdAt: serverTimestamp() });
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const displayName = userSnap.data()?.defaultDisplayName || '名無しの歌人';
      await setDoc(doc(db, 'groups', groupRef.id, 'members', user.uid), { displayName, joinedAt: serverTimestamp(), role: 'owner' });
      await updateDoc(doc(db, 'users', user.uid), { joinedGroups: arrayUnion(groupRef.id) });
      setShowCreate(false); setNewName('');
      Alert.alert('歌会を開きました', `招待コード: ${inviteCode}`);
    } catch (e: any) { Alert.alert('エラー', e.message); }
  };

  const handleJoin = async () => {
    if (!user || !joinCode.trim()) return;
    try {
      const q = query(collection(db, 'groups'), where('inviteCode', '==', joinCode.trim().toUpperCase()));
      const snap = await getDocs(q);
      if (snap.empty) { Alert.alert('エラー', '招待コードが見つかりません'); return; }
      const groupDoc = snap.docs[0]; const groupId = groupDoc.id;
      const memberSnap = await getDoc(doc(db, 'groups', groupId, 'members', user.uid));
      if (memberSnap.exists()) { Alert.alert('', 'すでに参加しています'); return; }
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const displayName = userSnap.data()?.defaultDisplayName || '名無しの歌人';
      await setDoc(doc(db, 'groups', groupId, 'members', user.uid), { displayName, joinedAt: serverTimestamp(), role: 'member' });
      await updateDoc(doc(db, 'groups', groupId), { memberCount: increment(1) });
      await updateDoc(doc(db, 'users', user.uid), { joinedGroups: arrayUnion(groupId) });
      setShowJoin(false); setJoinCode('');
      Alert.alert('参加しました', `「${groupDoc.data().name}」に参加しました`);
    } catch (e: any) { Alert.alert('エラー', e.message); }
  };

  return (
    <View style={styles.container}>
      <FlatList data={groups} keyExtractor={item => item.id} contentContainerStyle={styles.list}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>歌会がありません</Text><Text style={styles.emptySubtext}>下のボタンから歌会を開くか、招待コードで参加しましょう</Text></View>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Timeline', { groupId: item.id, groupName: item.name })}>
            <Text style={styles.cardName}>{item.name}</Text>
            <View style={styles.cardMeta}><Text style={styles.cardMembers}>{item.memberCount}人の歌人</Text><Text style={styles.cardCode}>招待: {item.inviteCode}</Text></View>
          </TouchableOpacity>
        )} />
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowJoin(true)}><Text style={styles.actionBtnText}>招待コードで参加</Text></TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowCreate(true)}><Text style={styles.actionBtnText}>歌会を開く</Text></TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('Compose', {})}><Text style={styles.fabText}>筆</Text></TouchableOpacity>
      <Modal visible={showCreate} transparent animationType="fade">
        <View style={styles.modalOverlay}><View style={styles.modal}>
          <Text style={styles.modalTitle}>歌会を開く</Text>
          <TextInput style={styles.input} placeholder="歌会の名前" value={newName} onChangeText={setNewName} placeholderTextColor="#A69880" />
          <View style={styles.modalButtons}><TouchableOpacity onPress={() => setShowCreate(false)}><Text style={styles.cancelText}>やめる</Text></TouchableOpacity><TouchableOpacity style={styles.confirmBtn} onPress={handleCreate}><Text style={styles.confirmText}>開く</Text></TouchableOpacity></View>
        </View></View>
      </Modal>
      <Modal visible={showJoin} transparent animationType="fade">
        <View style={styles.modalOverlay}><View style={styles.modal}>
          <Text style={styles.modalTitle}>歌会に参加</Text>
          <TextInput style={styles.input} placeholder="招待コード（6文字）" value={joinCode} onChangeText={setJoinCode} autoCapitalize="characters" maxLength={6} placeholderTextColor="#A69880" />
          <View style={styles.modalButtons}><TouchableOpacity onPress={() => setShowJoin(false)}><Text style={styles.cancelText}>やめる</Text></TouchableOpacity><TouchableOpacity style={styles.confirmBtn} onPress={handleJoin}><Text style={styles.confirmText}>参加</Text></TouchableOpacity></View>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  list: { padding: 16, paddingBottom: 120 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 18, color: '#8B7E6A', marginBottom: 8 },
  emptySubtext: { fontSize: 13, color: '#A69880', textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: '#FFFDF8', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E8E0D0' },
  cardName: { fontSize: 18, color: '#2C2418', fontWeight: '500', marginBottom: 8 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMembers: { fontSize: 13, color: '#8B7E6A' },
  cardCode: { fontSize: 13, color: '#A69880' },
  buttonRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  actionBtn: { flex: 1, backgroundColor: '#FFFDF8', borderRadius: 8, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E8E0D0' },
  actionBtnText: { color: '#2C2418', fontSize: 14 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: '#2C2418', justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 4 },
  fabText: { color: '#F5F0E8', fontSize: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#FFFDF8', borderRadius: 16, padding: 24, width: '80%' },
  modalTitle: { fontSize: 18, color: '#2C2418', fontWeight: '500', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#E8E0D0', borderRadius: 8, padding: 12, fontSize: 16, color: '#2C2418', marginBottom: 20 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' },
  cancelText: { color: '#8B7E6A', fontSize: 15 },
  confirmBtn: { backgroundColor: '#2C2418', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  confirmText: { color: '#F5F0E8', fontSize: 15 },
});
