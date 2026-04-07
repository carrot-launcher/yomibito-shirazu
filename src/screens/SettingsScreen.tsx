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

export default function SettingsScreen() {
  const { user, userCode } = useAuth();
  const [notifNewPost, setNotifNewPost] = useState(true);
  const [notifReaction, setNotifReaction] = useState(true);
  const [notifComment, setNotifComment] = useState(true);
  const [notifJudgment, setNotifJudgment] = useState(true);
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

  return (
    <GradientBackground>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 歌人ID */}
      <View style={styles.idCard}>
        <Text style={styles.idLabel}>あなたの歌人ID</Text>
        <Text style={styles.idValue}>#{userCode}</Text>
        <Text style={styles.idHint}>他の歌人があなたを識別するためのIDです</Text>
      </View>

      <Text style={styles.sectionTitle}>短歌の変換</Text>
      <Text style={styles.hint}>初心者の分かち書きを補正します。</Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>半角スペース → 全角</Text>
        <Switch value={convertHalfSpace} onValueChange={(v) => { setConvertHalfSpace(v); saveSetting('tankaConvert.halfSpace', v); }}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={convertHalfSpace ? '#2C2418' : '#FFFDF8'} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>改行 → 全角スペース</Text>
        <Switch value={convertLineBreak} onValueChange={(v) => { setConvertLineBreak(v); saveSetting('tankaConvert.lineBreak', v); }}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={convertLineBreak ? '#2C2418' : '#FFFDF8'} />
      </View>

      <View style={{ height: 24 }} />

      <Text style={styles.sectionTitle}>たよりの設定</Text>
      <Text style={styles.hint}>音やバイブの設定は端末のOS設定から変更できます。</Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>新しい歌</Text>
        <Switch value={notifNewPost} onValueChange={(v) => { setNotifNewPost(v); saveSetting('notificationSettings.newPost', v); }}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={notifNewPost ? '#2C2418' : '#FFFDF8'} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>リアクション</Text>
        <Switch value={notifReaction} onValueChange={(v) => { setNotifReaction(v); saveSetting('notificationSettings.reaction', v); }}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={notifReaction ? '#2C2418' : '#FFFDF8'} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>評</Text>
        <Switch value={notifComment} onValueChange={(v) => { setNotifComment(v); saveSetting('notificationSettings.comment', v); }}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={notifComment ? '#2C2418' : '#FFFDF8'} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>裁き</Text>
        <Switch value={notifJudgment} onValueChange={(v) => { setNotifJudgment(v); saveSetting('notificationSettings.judgment', v); }}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={notifJudgment ? '#2C2418' : '#FFFDF8'} />
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => alert('ログアウト', 'ログアウトしますか？', [
        { text: 'やめる', style: 'cancel' },
        { text: 'ログアウト', style: 'destructive', onPress: async () => { try { await GoogleSignin.signOut(); } catch {} await signOut(auth); } },
      ])}>
        <Text style={styles.logoutText}>ログアウト</Text>
      </TouchableOpacity>
    </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 20, paddingBottom: 40 },
  idCard: {
    backgroundColor: '#FFFDF8', borderRadius: 12, padding: 16,
    marginBottom: 24, borderWidth: 1, borderColor: '#E8E0D0', alignItems: 'center',
  },
  idLabel: { fontSize: 12, color: '#8B7E6A', marginBottom: 4 },
  idValue: { fontSize: 28, color: '#2C2418', fontWeight: '500', letterSpacing: 4, fontFamily: 'IBMPlexMono_600SemiBold' },
  idHint: { fontSize: 11, color: '#A69880', marginTop: 6 },
  sectionTitle: { fontSize: 17, color: '#2C2418', fontWeight: '500', marginBottom: 4, fontFamily: 'NotoSerifJP_500Medium' },
  hint: { fontSize: 12, color: '#A69880', marginBottom: 12, lineHeight: 18 },
  input: {
    backgroundColor: '#FFFDF8', borderRadius: 10, padding: 14,
    fontSize: 16, color: '#2C2418', borderWidth: 1, borderColor: '#E8E0D0',
  },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E8E0D0',
  },
  switchLabel: { fontSize: 16, color: '#2C2418', fontFamily: 'NotoSerifJP_400Regular' },
  logoutBtn: { alignItems: 'center', marginTop: 24, paddingVertical: 12 },
  logoutText: { color: '#C53030', fontSize: 15, fontFamily: 'NotoSerifJP_400Regular' },
});
