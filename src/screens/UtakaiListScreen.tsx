import { MaterialCommunityIcons } from '@expo/vector-icons';
import { arrayUnion, collection, doc, getDoc, getDocs, increment, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
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
  const [lastReadMap, setLastReadMap] = useState<Record<string, Date | null>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [showChoosePublic, setShowChoosePublic] = useState(false);
  const [showPurpose, setShowPurpose] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showSetName, setShowSetName] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPurpose, setNewPurpose] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [memberDisplayName, setMemberDisplayName] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | { type: 'create'; groupName: string; isPublic: boolean; purpose?: string } | { type: 'join'; groupId: string; groupName: string; isPublic: boolean }>(null);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 4 }}>
          <TouchableOpacity onPress={() => navigation.navigate('UtakaiDiscovery')} hitSlop={8} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="compass-outline" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(true)} hitSlop={8} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="plus" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
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

      // joinedGroups の順序に合わせて並び替え + 含まれないものを除去
      setGroups(prev => {
        const map = new Map(prev.map(g => [g.id, g]));
        return groupIds.map(id => map.get(id)).filter((g): g is GroupDoc & { id: string } => !!g);
      });

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
              // 新規追加: joinedGroups の順序に従って正しい位置に挿入
              // この時点で順序情報がないので末尾に追加（次回の親 onSnapshot で並び替えられる）
              return [...prev, groupData];
            });
          }, () => {});
          groupUnsubs.push(groupUnsub);

          // メンバードキュメントを監視して lastReadAt を取得
          const memberUnsub = onSnapshot(doc(db, 'groups', gid, 'members', user.uid), (mSnap) => {
            // pending write 中（serverTimestamp が確定していない）の null は無視
            if (mSnap.metadata.hasPendingWrites) return;
            const lastRead = mSnap.data()?.lastReadAt?.toDate?.() || null;
            setLastReadMap(prev => ({ ...prev, [gid]: lastRead }));
          }, () => {});
          groupUnsubs.push(memberUnsub);
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

  // 歌会作成: 名前 → 公開/非公開選択 → (公開なら)趣意書 → 表示名
  const handleCreateStep1 = () => {
    if (!user || !newName.trim()) return;
    setShowCreate(false);
    setShowChoosePublic(true);
  };

  const handleChoosePublic = async (isPublic: boolean) => {
    if (!user || !newName.trim()) return;
    if (!isPublic) {
      setShowChoosePublic(false);
      setMemberDisplayName('');
      setPendingAction({ type: 'create', groupName: newName.trim(), isPublic: false });
      setShowSetName(true);
      return;
    }

    // 公開を選んだら、趣意書入力の前に事前チェック
    try {
      // kill switch と経過日数要件を確認
      const configSnap = await getDoc(doc(db, 'config', 'publicGroups'));
      const cfg = configSnap.exists() ? configSnap.data() : {};
      if (cfg?.enabled === false) {
        alert('', '公開歌会の作成は現在停止しています');
        return;
      }
      const minAgeDays = typeof cfg?.minAccountAgeDays === 'number' ? cfg.minAccountAgeDays : 7;
      if (minAgeDays > 0 && user.metadata?.creationTime) {
        const creationMs = new Date(user.metadata.creationTime).getTime();
        const ageDays = (Date.now() - creationMs) / (24 * 60 * 60 * 1000);
        if (ageDays < minAgeDays) {
          alert('', `公開歌会の作成はアカウント作成から${minAgeDays}日後以降に可能になります`);
          return;
        }
      }

      // 既に自分が作成した公開歌会があるかチェック
      const q = query(
        collection(db, 'groups'),
        where('createdBy', '==', user.uid),
        where('isPublic', '==', true),
      );
      const snap = await getDocs(q);
      if (snap.size >= 3) {
        alert('', '公開歌会は1人につき3つまで作成できます');
        return;
      }
    } catch { /* チェック失敗時はサーバー側の検証に任せる */ }

    setShowChoosePublic(false);
    setNewPurpose('');
    setShowPurpose(true);
  };

  const handlePurposeNext = () => {
    if (!user || !newName.trim()) return;
    const p = newPurpose.trim();
    if (p.length < 10 || p.length > 200) {
      alert('エラー', '趣意書は10〜200文字で入力してください');
      return;
    }
    setShowPurpose(false);
    setMemberDisplayName('');
    setPendingAction({ type: 'create', groupName: newName.trim(), isPublic: true, purpose: p });
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
      setPendingAction({ type: 'join', groupId: groupDoc.id, groupName: groupDoc.data().name, isPublic: groupDoc.data().isPublic === true });
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
        await createGroupFn({
          groupName: pendingAction.groupName,
          displayName,
          isPublic: pendingAction.isPublic,
          purpose: pendingAction.purpose,
        });
      } else {
        const groupId = pendingAction.groupId;
        await setDoc(doc(db, 'groups', groupId, 'members', user.uid), { displayName, userCode, joinedAt: serverTimestamp(), role: 'member', muted: pendingAction.isPublic });
        await updateDoc(doc(db, 'groups', groupId), { memberCount: increment(1) });
        await updateDoc(doc(db, 'users', user.uid), { joinedGroups: arrayUnion(groupId) });
      }
      setShowSetName(false);
      setNewName('');
      setNewPurpose('');
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

  // 未読判定: lastPostAt > lastReadAt
  // lastReadMap[gid] が undefined の場合（まだロード中）は既読扱いにしてチラつき防止
  const isUnread = (g: GroupDoc & { id: string }) => {
    const lastPost = g.lastPostAt?.toDate?.();
    if (!lastPost) return false;
    if (!(g.id in lastReadMap)) return false;
    const lastRead = lastReadMap[g.id];
    if (!lastRead) return true;
    return lastPost > lastRead;
  };

  const renderGroupItem = ({ item, drag, isActive }: RenderItemParams<GroupDoc & { id: string }>) => {
    const unread = isUnread(item);
    return (
      <ScaleDecorator>
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.surface, borderLeftColor: unread ? colors.destructive : colors.border }, isActive && { opacity: 0.8 }]}
          onPress={() => navigation.navigate('Timeline', { groupId: item.id, groupName: item.name })}
          onLongPress={drag}
          delayLongPress={250}
          disabled={isActive}
        >
          <Text style={[styles.cardName, { color: unread ? colors.text : colors.textSecondary, fontWeight: unread ? '500' : '400' }]} numberOfLines={1}>{item.name}</Text>
          {item.isPublic && (
            <View style={[styles.publicBadge, { borderColor: colors.border }]}>
              <Text style={[styles.publicBadgeText, { color: colors.textTertiary }]}>公開</Text>
            </View>
          )}
          <Text style={[styles.cardMembers, { color: colors.textTertiary }]}>{item.memberCount}人</Text>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  const handleDragEnd = ({ data }: { data: (GroupDoc & { id: string })[] }) => {
    setGroups(data);
    if (!user) return;
    updateDoc(doc(db, 'users', user.uid), {
      joinedGroups: data.map(g => g.id),
    }).catch(() => {});
  };

  return (
    <GradientBackground style={styles.container}>
      {groups.length === 0 ? (
        <View style={[styles.emptyList, styles.empty]}>
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>歌会がありません</Text>
          <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>右上の＋から歌会を開くか{'\n'}参加しましょう</Text>
        </View>
      ) : (
        <DraggableFlatList
          data={groups}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={renderGroupItem}
          onDragEnd={handleDragEnd}
        />
      )}

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

      {/* 公開/非公開選択モーダル */}
      <Modal visible={showChoosePublic} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}><View style={[styles.modal, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>歌会の種類</Text>
          <Text style={[styles.modalHint, { color: colors.textSecondary }]}>あとから変更することはできません</Text>
          <TouchableOpacity
            style={[styles.choiceCard, { borderColor: colors.border, backgroundColor: colors.bg }]}
            onPress={() => handleChoosePublic(false)}
          >
            <Text style={[styles.choiceTitle, { color: colors.text }]}>非公開</Text>
            <Text style={[styles.choiceDesc, { color: colors.textSecondary }]}>招待コードを知っている人だけが参加できます</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.choiceCard, { borderColor: colors.border, backgroundColor: colors.bg }]}
            onPress={() => handleChoosePublic(true)}
          >
            <Text style={[styles.choiceTitle, { color: colors.text }]}>公開</Text>
            <Text style={[styles.choiceDesc, { color: colors.textSecondary }]}>誰でも発見して参加できます。趣意書を書いていただきます。作成は1人につき3つまで</Text>
          </TouchableOpacity>
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={() => { setShowChoosePublic(false); setShowCreate(true); }}>
              <Text style={[styles.cancelText, { color: colors.textSecondary }]}>戻る</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* 趣意書入力モーダル */}
      <Modal visible={showPurpose} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}><View style={[styles.modal, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>趣意書</Text>
          <Text style={[styles.modalHint, { color: colors.textSecondary }]}>この歌会でどのような歌を詠んでほしいかを10〜200文字で。{'\n'}発見画面や歌会のヘッダーなどで、参加前の人にも公開されます。</Text>
          <TextInput
            style={[styles.input, styles.purposeInput, { borderColor: colors.border, color: colors.text }]}
            placeholder="趣意書"
            value={newPurpose}
            onChangeText={setNewPurpose}
            placeholderTextColor={colors.textTertiary}
            maxLength={200}
            multiline
            textAlignVertical="top"
          />
          <Text style={[styles.counterText, { color: colors.textTertiary }]}>{newPurpose.trim().length} / 200</Text>
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={() => { setShowPurpose(false); setShowChoosePublic(true); }}>
              <Text style={[styles.cancelText, { color: colors.textSecondary }]}>戻る</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: colors.accent }, (newPurpose.trim().length < 10) && { opacity: 0.4 }]}
              onPress={handlePurposeNext}
              disabled={newPurpose.trim().length < 10}
            >
              <Text style={[styles.confirmText, { color: colors.accentText }]}>次へ</Text>
            </TouchableOpacity>
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
  card: {
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 12,
    borderLeftWidth: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
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
  choiceCard: { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 10 },
  choiceTitle: { fontSize: 16, fontFamily: 'NotoSerifJP_500Medium', marginBottom: 4 },
  choiceDesc: { fontSize: 13, lineHeight: 19, fontFamily: 'NotoSerifJP_400Regular' },
  purposeInput: { minHeight: 110, textAlignVertical: 'top' },
  counterText: { fontSize: 12, textAlign: 'right', marginTop: -10, marginBottom: 10 },
  publicBadge: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginRight: 8 },
  publicBadgeText: { fontSize: 10, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 1 },
});
