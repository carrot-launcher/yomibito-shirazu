import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { signOut } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useState } from 'react';
import {
  Modal, ScrollView,
  StyleSheet, Switch,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { auth, db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';

type ThemeMode = 'system' | 'light' | 'dark';

export default function SettingsScreen({ navigation }: any) {
  const { user, userCode, blockedHandles } = useAuth();
  const { colors, mode, setMode } = useTheme();
  const [notifNewPost, setNotifNewPost] = useState(true);
  const [notifReaction, setNotifReaction] = useState(true);
  const [notifComment, setNotifComment] = useState(true);
  const [notifOther, setNotifOther] = useState(true);
  const [convertHalfSpace, setConvertHalfSpace] = useState(true);
  const [convertLineBreak, setConvertLineBreak] = useState(true);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { alert } = useAlert();

  const handleDeleteAccount = async () => {
    if (!user || deleteConfirmCode !== userCode || deleting) return;
    setDeleting(true);
    try {
      const fns = getFunctions(undefined, 'asia-northeast1');
      await httpsCallable(fns, 'deleteAccount')({});
      setShowDeleteAccount(false);
      try { await GoogleSignin.signOut(); } catch {}
      await signOut(auth);
      try { await AsyncStorage.clear(); } catch {}
    } catch (e: any) {
      alert('エラー', e?.message || 'アカウント削除に失敗しました');
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const data = snap.data();
      if (data) {
        setNotifNewPost(data.notificationSettings?.newPost ?? true);
        setNotifReaction(data.notificationSettings?.reaction ?? true);
        setNotifComment(data.notificationSettings?.comment ?? true);
        setNotifOther(data.notificationSettings?.other ?? true);
        setConvertHalfSpace(data.tankaConvert?.halfSpace ?? true);
        setConvertLineBreak(data.tankaConvert?.lineBreak ?? true);
      }
    })();
  }, [user]);

  const saveSetting = async (field: string, value: any) => {
    if (!user) return;
    try { await updateDoc(doc(db, 'users', user.uid), { [field]: value }); }
    catch {}
  };

  const themeModes: { key: ThemeMode; label: string }[] = [
    { key: 'system', label: '自動' },
    { key: 'light', label: 'ライト' },
    { key: 'dark', label: 'ダーク' },
  ];

  return (
    <GradientBackground>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 歌人ID */}
      <View style={[styles.idCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.idLabel, { color: colors.textSecondary }]}>あなたの歌人ID</Text>
        <Text style={[styles.idValue, { color: colors.text }]}>#{userCode}</Text>
        <Text style={[styles.idHint, { color: colors.textTertiary }]}>他の歌人があなたを識別するためのIDです</Text>
      </View>

      {/* 表示設定 */}
      <Text style={[styles.sectionTitle, { color: colors.text }]}>表示</Text>

      <View style={[styles.segmentBar, { backgroundColor: colors.segmentBg }]}>
        {themeModes.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.segment, mode === t.key && { backgroundColor: colors.segmentActive }]}
            onPress={() => setMode(t.key)}
          >
            <Text style={[
              styles.segmentText,
              { color: colors.textSecondary },
              mode === t.key && { color: colors.text, fontWeight: '500', fontFamily: 'NotoSerifJP_500Medium' },
            ]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: 24 }} />

      <Text style={[styles.sectionTitle, { color: colors.text }]}>短歌の変換</Text>
      <Text style={[styles.hint, { color: colors.textTertiary }]}>一般的な短歌の慣習に補正します</Text>

      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>半角スペース → 全角</Text>
        <Switch value={convertHalfSpace} onValueChange={(v) => { setConvertHalfSpace(v); saveSetting('tankaConvert.halfSpace', v); }}
          trackColor={colors.switchTrack} thumbColor={convertHalfSpace ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>改行 → 全角スペース</Text>
        <Switch value={convertLineBreak} onValueChange={(v) => { setConvertLineBreak(v); saveSetting('tankaConvert.lineBreak', v); }}
          trackColor={colors.switchTrack} thumbColor={convertLineBreak ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>

      <View style={{ height: 24 }} />

      <Text style={[styles.sectionTitle, { color: colors.text }]}>たよりの設定</Text>
      <Text style={[styles.hint, { color: colors.textTertiary }]}>音やバイブの設定は端末のOS設定から変更できます</Text>

      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>新しい歌</Text>
        <Switch value={notifNewPost} onValueChange={(v) => { setNotifNewPost(v); saveSetting('notificationSettings.newPost', v); }}
          trackColor={colors.switchTrack} thumbColor={notifNewPost ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>リアクション</Text>
        <Switch value={notifReaction} onValueChange={(v) => { setNotifReaction(v); saveSetting('notificationSettings.reaction', v); }}
          trackColor={colors.switchTrack} thumbColor={notifReaction ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>評</Text>
        <Switch value={notifComment} onValueChange={(v) => { setNotifComment(v); saveSetting('notificationSettings.comment', v); }}
          trackColor={colors.switchTrack} thumbColor={notifComment ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>その他</Text>
        <Switch value={notifOther} onValueChange={(v) => { setNotifOther(v); saveSetting('notificationSettings.other', v); }}
          trackColor={colors.switchTrack} thumbColor={notifOther ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>

      <View style={{ height: 24 }} />

      <Text style={[styles.sectionTitle, { color: colors.text }]}>ブロック</Text>
      <TouchableOpacity
        style={[styles.linkRow, { borderBottomColor: colors.border }]}
        onPress={() => navigation.navigate('BlockedAuthors')}
      >
        <Text style={[styles.linkText, { color: colors.text }]}>ブロック中の歌人</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {Object.keys(blockedHandles).length > 0 && (
            <Text style={[styles.linkCount, { color: colors.textSecondary }]}>
              {Object.keys(blockedHandles).length} 人
            </Text>
          )}
          <Text style={[styles.linkArrow, { color: colors.textTertiary }]}>›</Text>
        </View>
      </TouchableOpacity>

      <View style={{ height: 24 }} />

      <Text style={[styles.sectionTitle, { color: colors.text }]}>このアプリについて</Text>

      <TouchableOpacity
        style={[styles.linkRow, { borderBottomColor: colors.border }]}
        onPress={() => WebBrowser.openBrowserAsync('https://carrot-launcher.github.io/yomibito-shirazu/terms-of-service.html')}
      >
        <Text style={[styles.linkText, { color: colors.text }]}>利用規約</Text>
        <Text style={[styles.linkArrow, { color: colors.textTertiary }]}>›</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.linkRow, { borderBottomColor: colors.border }]}
        onPress={() => WebBrowser.openBrowserAsync('https://carrot-launcher.github.io/yomibito-shirazu/privacy-policy.html')}
      >
        <Text style={[styles.linkText, { color: colors.text }]}>プライバシーポリシー</Text>
        <Text style={[styles.linkArrow, { color: colors.textTertiary }]}>›</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.linkRow, { borderBottomColor: colors.border }]}
        onPress={() => WebBrowser.openBrowserAsync('https://carrot-launcher.github.io/yomibito-shirazu/')}
      >
        <Text style={[styles.linkText, { color: colors.text }]}>お問い合わせ・サポート</Text>
        <Text style={[styles.linkArrow, { color: colors.textTertiary }]}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => alert('ログアウト', 'ログアウトしますか？', [
        { text: 'やめる', style: 'cancel' },
        { text: 'ログアウト', style: 'destructive', onPress: async () => { try { await GoogleSignin.signOut(); } catch {} await signOut(auth); } },
      ])}>
        <Text style={[styles.logoutText, { color: colors.destructive }]}>ログアウト</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => setShowDeleteAccount(true)}>
        <Text style={[styles.logoutText, { color: colors.destructive }]}>アカウント削除とデータ消去</Text>
      </TouchableOpacity>

      {/* アカウント削除とデータ消去確認モーダル */}
      <Modal visible={showDeleteAccount} transparent animationType="fade" onRequestClose={() => { if (!deleting) setShowDeleteAccount(false); }}>
        <View style={[styles.deleteOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.deleteModal, { backgroundColor: colors.surface }]}>
            <Text style={[styles.deleteTitle, { color: colors.destructive }]}>アカウント削除とデータ消去</Text>
            <Text style={[styles.deleteDesc, { color: colors.textSecondary }]}>
              この操作は取り消せません。{'\n'}あなたの歌、評、歌会がすべて削除されます。
            </Text>
            <Text style={[styles.deleteHint, { color: colors.textTertiary }]}>
              確認のため歌人ID（{userCode}）を入力してください
            </Text>
            <TextInput
              style={[styles.deleteInput, { borderColor: colors.border, color: colors.text }]}
              value={deleteConfirmCode}
              onChangeText={setDeleteConfirmCode}
              placeholder={userCode || ''}
              placeholderTextColor={colors.disabled}
              keyboardType="number-pad"
              maxLength={6}
            />
            <View style={styles.deleteButtons}>
              <TouchableOpacity
                style={[styles.deleteCancelBtn, { borderColor: colors.border }]}
                onPress={() => { setShowDeleteAccount(false); setDeleteConfirmCode(''); }}
                disabled={deleting}
              >
                <Text style={[styles.deleteCancelText, { color: colors.textSecondary }]}>やめる</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteConfirmBtn, { backgroundColor: colors.destructive }, (deleteConfirmCode !== userCode || deleting) && { opacity: 0.4 }]}
                onPress={handleDeleteAccount}
                disabled={deleteConfirmCode !== userCode || deleting}
              >
                <Text style={styles.deleteConfirmText}>{deleting ? '処理中...' : 'アカウント削除とデータ消去'}</Text>
              </TouchableOpacity>
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
  content: { padding: 20, paddingBottom: 40 },
  idCard: {
    borderRadius: 12, padding: 16,
    marginBottom: 24, borderWidth: 1, alignItems: 'center',
  },
  idLabel: { fontSize: 12, marginBottom: 4 },
  idValue: { fontSize: 28, fontWeight: '500', letterSpacing: 4, fontFamily: 'IBMPlexMono_600SemiBold' },
  idHint: { fontSize: 11, marginTop: 6 },
  sectionTitle: { fontSize: 17, fontWeight: '500', marginBottom: 4, fontFamily: 'NotoSerifJP_500Medium' },
  hint: { fontSize: 12, marginBottom: 12, lineHeight: 18 },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1,
  },
  switchLabel: { fontSize: 16, fontFamily: 'NotoSerifJP_400Regular' },
  logoutBtn: { alignItems: 'center', marginTop: 24, paddingVertical: 12 },
  logoutText: { fontSize: 15, lineHeight: 20, fontFamily: 'NotoSerifJP_400Regular' },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  linkText: { fontSize: 15, lineHeight: 22, fontFamily: 'NotoSerifJP_400Regular' },
  linkCount: { fontSize: 13, lineHeight: 18, fontFamily: 'NotoSerifJP_400Regular' },
  linkArrow: { fontSize: 20, lineHeight: 20 },
  segmentBar: { flexDirection: 'row', borderRadius: 8, padding: 3, marginBottom: 4 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segmentText: { fontSize: 15, lineHeight: 20, fontFamily: 'NotoSerifJP_400Regular' },
  deleteOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  deleteModal: { borderRadius: 16, padding: 28, width: '86%' },
  deleteTitle: { fontSize: 18, fontWeight: '500', textAlign: 'center', marginBottom: 12, fontFamily: 'NotoSerifJP_500Medium' },
  deleteDesc: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  deleteHint: { fontSize: 12, textAlign: 'center', marginBottom: 8 },
  deleteInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 20, textAlign: 'center', letterSpacing: 4, fontFamily: 'IBMPlexMono_600SemiBold' },
  deleteButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  deleteCancelBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1 },
  deleteCancelText: { fontSize: 15 },
  deleteConfirmBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10 },
  deleteConfirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
});
