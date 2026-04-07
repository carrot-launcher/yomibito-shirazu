import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Switch, ScrollView,
} from 'react-native';
import GradientBackground from '../components/GradientBackground';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useAlert } from '../components/CustomAlert';
import { signOut } from 'firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth, db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';

export default function SettingsScreen() {
  const { user, userCode } = useAuth();
  const [notifNewPost, setNotifNewPost] = useState(true);
  const [notifReaction, setNotifReaction] = useState(true);
  const [notifComment, setNotifComment] = useState(true);
  const [convertHalfSpace, setConvertHalfSpace] = useState(true);
  const [convertLineBreak, setConvertLineBreak] = useState(true);
  const [saving, setSaving] = useState(false);
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
        setConvertHalfSpace(data.tankaConvert?.halfSpace ?? true);
        setConvertLineBreak(data.tankaConvert?.lineBreak ?? true);
      }
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        notificationSettings: {
          newPost: notifNewPost,
          reaction: notifReaction,
          comment: notifComment,
        },
        tankaConvert: {
          halfSpace: convertHalfSpace,
          lineBreak: convertLineBreak,
        },
      });
      alert('保存しました');
    } catch (e: any) {
      alert('エラー', e.message);
    } finally {
      setSaving(false);
    }
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
      <Text style={styles.hint}>初心者の分かち書きを補正します。上級者はOFFにできます。</Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>半角スペース → 全角</Text>
        <Switch value={convertHalfSpace} onValueChange={setConvertHalfSpace}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={convertHalfSpace ? '#2C2418' : '#FFFDF8'} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>改行 → 全角スペース</Text>
        <Switch value={convertLineBreak} onValueChange={setConvertLineBreak}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={convertLineBreak ? '#2C2418' : '#FFFDF8'} />
      </View>

      <View style={{ height: 24 }} />

      <Text style={styles.sectionTitle}>たよりの設定</Text>
      <Text style={styles.hint}>音やバイブの設定は端末のOS設定から変更できます。</Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>新しい歌</Text>
        <Switch value={notifNewPost} onValueChange={setNotifNewPost}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={notifNewPost ? '#2C2418' : '#FFFDF8'} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>リアクション</Text>
        <Switch value={notifReaction} onValueChange={setNotifReaction}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={notifReaction ? '#2C2418' : '#FFFDF8'} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>評</Text>
        <Switch value={notifComment} onValueChange={setNotifComment}
          trackColor={{ false: '#E8E0D0', true: '#A69880' }} thumbColor={notifComment ? '#2C2418' : '#FFFDF8'} />
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && { opacity: 0.4 }]}
        onPress={handleSave} disabled={saving}
      >
        <Text style={styles.saveBtnText}>保存</Text>
      </TouchableOpacity>

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
  idValue: { fontSize: 28, color: '#2C2418', fontWeight: '500', letterSpacing: 4 },
  idHint: { fontSize: 11, color: '#A69880', marginTop: 6 },
  sectionTitle: { fontSize: 16, color: '#2C2418', fontWeight: '500', marginBottom: 4 },
  hint: { fontSize: 12, color: '#A69880', marginBottom: 12, lineHeight: 18 },
  input: {
    backgroundColor: '#FFFDF8', borderRadius: 10, padding: 14,
    fontSize: 16, color: '#2C2418', borderWidth: 1, borderColor: '#E8E0D0',
  },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E8E0D0',
  },
  switchLabel: { fontSize: 15, color: '#2C2418' },
  saveBtn: {
    backgroundColor: '#2C2418', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 32,
  },
  saveBtnText: { color: '#F5F0E8', fontSize: 16 },
  logoutBtn: { alignItems: 'center', marginTop: 24, paddingVertical: 12 },
  logoutText: { color: '#C53030', fontSize: 14 },
});
