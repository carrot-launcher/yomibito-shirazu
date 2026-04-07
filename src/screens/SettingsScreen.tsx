import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { signOut } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet, Switch,
  Text, TouchableOpacity,
  View,
} from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { auth, db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';

type ThemeMode = 'system' | 'light' | 'dark';

export default function SettingsScreen() {
  const { user, userCode } = useAuth();
  const { colors, mode, setMode } = useTheme();
  const [notifNewPost, setNotifNewPost] = useState(true);
  const [notifReaction, setNotifReaction] = useState(true);
  const [notifComment, setNotifComment] = useState(true);
  const [notifJudgment, setNotifJudgment] = useState(true);
  const [notifOther, setNotifOther] = useState(true);
  const [convertHalfSpace, setConvertHalfSpace] = useState(true);
  const [convertLineBreak, setConvertLineBreak] = useState(true);
  const { alert } = useAlert();

  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const data = snap.data();
      if (data) {
        setNotifNewPost(data.notificationSettings?.newPost ?? true);
        setNotifReaction(data.notificationSettings?.reaction ?? true);
        setNotifComment(data.notificationSettings?.comment ?? true);
        setNotifJudgment(data.notificationSettings?.judgment ?? true);
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
      <Text style={[styles.hint, { color: colors.textTertiary }]}>初心者の分かち書きを補正します。</Text>

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
      <Text style={[styles.hint, { color: colors.textTertiary }]}>音やバイブの設定は端末のOS設定から変更できます。</Text>

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
        <Text style={[styles.switchLabel, { color: colors.text }]}>裁き</Text>
        <Switch value={notifJudgment} onValueChange={(v) => { setNotifJudgment(v); saveSetting('notificationSettings.judgment', v); }}
          trackColor={colors.switchTrack} thumbColor={notifJudgment ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>
      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>その他</Text>
        <Switch value={notifOther} onValueChange={(v) => { setNotifOther(v); saveSetting('notificationSettings.other', v); }}
          trackColor={colors.switchTrack} thumbColor={notifOther ? colors.switchThumb.on : colors.switchThumb.off} />
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => alert('ログアウト', 'ログアウトしますか？', [
        { text: 'やめる', style: 'cancel' },
        { text: 'ログアウト', style: 'destructive', onPress: async () => { try { await GoogleSignin.signOut(); } catch {} await signOut(auth); } },
      ])}>
        <Text style={[styles.logoutText, { color: colors.destructive }]}>ログアウト</Text>
      </TouchableOpacity>
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
  segmentBar: { flexDirection: 'row', borderRadius: 8, padding: 3, marginBottom: 4 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segmentText: { fontSize: 15, lineHeight: 20, fontFamily: 'NotoSerifJP_400Regular' },
});
