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
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { auth, db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';
import { breadcrumb } from '../utils/breadcrumb';
import { describeError } from '../utils/errorMessage';

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
    breadcrumb('account:delete');
    setDeleting(true);
    try {
      const fns = getFunctions(undefined, 'asia-northeast1');
      await httpsCallable(fns, 'deleteAccount')({});
      setShowDeleteAccount(false);
      try { await GoogleSignin.signOut(); } catch {}
      await signOut(auth);
      try { await AsyncStorage.clear(); } catch {}
    } catch (e: any) {
      const { title, message } = describeError(e);
      alert(title, message || 'アカウント削除に失敗しました');
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
        <AppText variant="caption" tone="secondary" style={styles.idLabel}>あなたの歌人ID</AppText>
        <Text style={[styles.idValue, { color: colors.text }]}>#{userCode}</Text>
        <AppText variant="meta" tone="tertiary" style={styles.idHint}>他の歌人があなたを識別するためのIDです</AppText>
      </View>

      {/* 表示設定 */}
      <AppText variant="sectionTitle" style={styles.sectionTitle}>表示</AppText>

      <View style={[styles.segmentBar, { backgroundColor: colors.segmentBg }]}>
        {themeModes.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.segment, mode === t.key && { backgroundColor: colors.segmentActive }]}
            onPress={() => setMode(t.key)}
          >
            <AppText variant="buttonLabel" weight={mode === t.key ? 'medium' : 'regular'} tone={mode === t.key ? 'primary' : 'secondary'}>{t.label}</AppText>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: 24 }} />

      <AppText variant="sectionTitle" style={styles.sectionTitle}>短歌の変換</AppText>
      <AppText variant="caption" tone="tertiary" style={styles.hint}>一般的な短歌の慣習に補正します</AppText>

      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <AppText variant="bodyLg">半角スペース → 全角</AppText>
        <Switch value={convertHalfSpace} onValueChange={(v) => { setConvertHalfSpace(v); saveSetting('tankaConvert.halfSpace', v); }}
          trackColor={colors.switchTrack} thumbColor={convertHalfSpace ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <AppText variant="bodyLg">改行 → 全角スペース</AppText>
        <Switch value={convertLineBreak} onValueChange={(v) => { setConvertLineBreak(v); saveSetting('tankaConvert.lineBreak', v); }}
          trackColor={colors.switchTrack} thumbColor={convertLineBreak ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>

      <View style={{ height: 24 }} />

      <AppText variant="sectionTitle" style={styles.sectionTitle}>たよりの設定</AppText>
      <AppText variant="caption" tone="tertiary" style={styles.hint}>音やバイブの設定は端末のOS設定から変更できます</AppText>

      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <AppText variant="bodyLg">新しい歌</AppText>
        <Switch value={notifNewPost} onValueChange={(v) => { setNotifNewPost(v); saveSetting('notificationSettings.newPost', v); }}
          trackColor={colors.switchTrack} thumbColor={notifNewPost ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <AppText variant="bodyLg">リアクション</AppText>
        <Switch value={notifReaction} onValueChange={(v) => { setNotifReaction(v); saveSetting('notificationSettings.reaction', v); }}
          trackColor={colors.switchTrack} thumbColor={notifReaction ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <AppText variant="bodyLg">評</AppText>
        <Switch value={notifComment} onValueChange={(v) => { setNotifComment(v); saveSetting('notificationSettings.comment', v); }}
          trackColor={colors.switchTrack} thumbColor={notifComment ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <AppText variant="bodyLg">その他</AppText>
        <Switch value={notifOther} onValueChange={(v) => { setNotifOther(v); saveSetting('notificationSettings.other', v); }}
          trackColor={colors.switchTrack} thumbColor={notifOther ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>

      <View style={{ height: 24 }} />

      <AppText variant="sectionTitle" style={styles.sectionTitle}>ブロック</AppText>
      <TouchableOpacity
        style={[styles.linkRow, { borderBottomColor: colors.border }]}
        onPress={() => navigation.navigate('BlockedAuthors')}
      >
        <AppText variant="body">ブロック中の歌人</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {Object.keys(blockedHandles).length > 0 && (
            <AppText variant="caption" tone="secondary">
              {Object.keys(blockedHandles).length} 人
            </AppText>
          )}
          <AppText variant="bodyLg" tone="tertiary" style={styles.linkArrow}>›</AppText>
        </View>
      </TouchableOpacity>

      <View style={{ height: 24 }} />

      <AppText variant="sectionTitle" style={styles.sectionTitle}>このアプリについて</AppText>

      <TouchableOpacity
        style={[styles.linkRow, { borderBottomColor: colors.border }]}
        onPress={() => WebBrowser.openBrowserAsync('https://carrot-launcher.github.io/yomibito-shirazu/terms-of-service.html')}
      >
        <AppText variant="body">利用規約</AppText>
        <AppText variant="bodyLg" tone="tertiary" style={styles.linkArrow}>›</AppText>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.linkRow, { borderBottomColor: colors.border }]}
        onPress={() => WebBrowser.openBrowserAsync('https://carrot-launcher.github.io/yomibito-shirazu/privacy-policy.html')}
      >
        <AppText variant="body">プライバシーポリシー</AppText>
        <AppText variant="bodyLg" tone="tertiary" style={styles.linkArrow}>›</AppText>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.linkRow, { borderBottomColor: colors.border }]}
        onPress={() => WebBrowser.openBrowserAsync('https://carrot-launcher.github.io/yomibito-shirazu/')}
      >
        <AppText variant="body">お問い合わせ・サポート</AppText>
        <AppText variant="bodyLg" tone="tertiary" style={styles.linkArrow}>›</AppText>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => alert('ログアウト', 'ログアウトしますか？', [
        { text: 'やめる', style: 'cancel' },
        { text: 'ログアウト', style: 'destructive', onPress: async () => { try { await GoogleSignin.signOut(); } catch {} await signOut(auth); } },
      ])}>
        <AppText variant="body" tone="destructive">ログアウト</AppText>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => setShowDeleteAccount(true)}>
        <AppText variant="body" tone="destructive">アカウント削除とデータ消去</AppText>
      </TouchableOpacity>

      {/* アカウント削除とデータ消去確認モーダル */}
      <Modal visible={showDeleteAccount} transparent animationType="fade" onRequestClose={() => { if (!deleting) setShowDeleteAccount(false); }}>
        <View style={[styles.deleteOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.deleteModal, { backgroundColor: colors.surface, borderColor: colors.destructive }]}>
            <AppText variant="sectionTitle" tone="destructive" style={styles.deleteTitle}>アカウント削除とデータ消去</AppText>
            <AppText variant="bodySm" tone="secondary" style={styles.deleteDesc}>
              この操作は取り消せません。{'\n'}あなたの歌、評、歌会がすべて削除されます。
            </AppText>
            <AppText variant="caption" tone="tertiary" style={styles.deleteHint}>
              確認のため歌人ID（{userCode}）を入力してください
            </AppText>
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
              <AppButton
                label="やめる"
                variant="secondary"
                onPress={() => { setShowDeleteAccount(false); setDeleteConfirmCode(''); }}
                disabled={deleting}
                style={styles.deleteBtnFlex}
              />
              <AppButton
                label={deleting ? '処理中...' : '削除する'}
                variant="destructive"
                onPress={handleDeleteAccount}
                disabled={deleteConfirmCode !== userCode || deleting}
                loading={deleting}
                style={styles.deleteBtnFlex}
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
  content: { padding: 20, paddingBottom: 40 },
  idCard: {
    borderRadius: 12, padding: 16,
    marginBottom: 24, borderWidth: 1, alignItems: 'center',
  },
  idLabel: { marginBottom: 4 },
  idValue: { fontSize: 28, fontWeight: '500', letterSpacing: 4, fontFamily: 'IBMPlexMono_600SemiBold' },
  idHint: { marginTop: 6 },
  sectionTitle: { marginBottom: 4 },
  hint: { marginBottom: 12 },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1,
  },
  logoutBtn: { alignItems: 'center', marginTop: 24, paddingVertical: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  linkArrow: { fontSize: 20, lineHeight: 20 },
  segmentBar: { flexDirection: 'row', borderRadius: 8, padding: 3, marginBottom: 4 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  deleteOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  deleteModal: { borderRadius: 16, padding: 28, width: '86%', borderWidth: 2 },
  deleteTitle: { textAlign: 'center', marginBottom: 12 },
  deleteDesc: { textAlign: 'center', marginBottom: 12 },
  deleteHint: { textAlign: 'center', marginBottom: 8 },
  deleteInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 20, textAlign: 'center', letterSpacing: 4, fontFamily: 'IBMPlexMono_600SemiBold' },
  deleteButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  deleteBtnFlex: { flex: 1, alignSelf: 'auto' },
});
