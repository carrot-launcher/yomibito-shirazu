import * as Crypto from 'expo-crypto';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';

const MAX_CHARS = 50;

export default function ComposeScreen({ route, navigation }: any) {
  const preselectedGroupId = route.params?.preselectedGroupId;
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [groups, setGroups] = useState<{ id: string; name: string; selected: boolean }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [convertHalfSpace, setConvertHalfSpace] = useState(true);
  const [convertLineBreak, setConvertLineBreak] = useState(true);
  const { alert } = useAlert();

  useEffect(() => {
    if (!user) return;
    (async () => {
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const data = userSnap.data();
      const joinedGroups: string[] = data?.joinedGroups || [];
      // Load user's conversion settings
      setConvertHalfSpace(data?.tankaConvert?.halfSpace ?? true);
      setConvertLineBreak(data?.tankaConvert?.lineBreak ?? true);
      const fetched = await Promise.all(joinedGroups.map(async (gid) => {
        const gSnap = await getDoc(doc(db, 'groups', gid));
        return { id: gid, name: gSnap.data()?.name || '不明', selected: gid === preselectedGroupId };
      }));
      setGroups(fetched);
    })();
  }, [user]);

  const toggleGroup = (id: string) => setGroups(prev => prev.map(g => g.id === id ? { ...g, selected: !g.selected } : g));

  const handleSubmit = useCallback(async () => {
    if (!user || !body.trim()) return;
    const selectedGroups = groups.filter(g => g.selected);
    if (selectedGroups.length === 0) { alert('送り先を選んでください'); return; }
    const trimmedBody = body.trim();
    if (trimmedBody.length > MAX_CHARS) { alert(`${MAX_CHARS}文字以内にしてください`); return; }
    setSubmitting(true);
    try {
      const batchId = Crypto.randomUUID();
      for (const group of selectedGroups) {
        const postRef = await addDoc(collection(db, 'posts'), {
          groupId: group.id, body: trimmedBody, batchId,
          convertHalfSpace, convertLineBreak,
          createdAt: serverTimestamp(), reactionSummary: {}, commentCount: 0,
        });
        await setDoc(doc(db, 'posts', postRef.id, 'private', 'author'), { authorId: user.uid });
        await addDoc(collection(db, 'users', user.uid, 'myPosts'), {
          postId: postRef.id, groupId: group.id, groupName: group.name,
          tankaBody: trimmedBody, batchId,
          convertHalfSpace, convertLineBreak,
          createdAt: serverTimestamp(),
        });
      }
      navigation.goBack();
    } catch (e: any) { alert('エラー', e.message); }
    finally { setSubmitting(false); }
  }, [user, body, groups, alert, navigation, convertHalfSpace, convertLineBreak]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginRight: 8 }}>
          <Text style={{ fontSize: 14, color: '#8B7E6A', fontFamily: 'NotoSerifJP_400Regular' }}>
            {body.length}/{MAX_CHARS}
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: submitting || !body.trim() ? '#C4B8A0' : '#2C2418',
              borderRadius: 8, paddingHorizontal: 18, paddingVertical: 6,
            }}
            onPress={handleSubmit}
            disabled={submitting || !body.trim()}
          >
            <Text style={{ color: '#F5F0E8', fontSize: 15, fontFamily: 'NotoSerifJP_500Medium' }}>
              詠む
            </Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [body, submitting, handleSubmit]);

  const hintParts: string[] = [];
  if (convertLineBreak) hintParts.push('改行');
  if (convertHalfSpace) hintParts.push('半角スペース');
  const hintText = hintParts.length > 0
    ? `${hintParts.join('・')}は全角スペースに変換されます`
    : '';

  return (
    <GradientBackground style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.groupList}>
          {groups.map(g => (
            <TouchableOpacity key={g.id} style={[styles.groupChip, g.selected && styles.groupChipSelected]} onPress={() => toggleGroup(g.id)}>
              <Text style={[styles.groupChipText, g.selected && styles.groupChipTextSelected]}>{g.selected ? '☑ ' : '☐ '}{g.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.inputArea}>
        <TextInput
          style={styles.tankaInput}
          value={body}
          onChangeText={setBody}
          placeholder="歌を詠む..."
          placeholderTextColor="#A69880"
          multiline
          maxLength={MAX_CHARS}
          autoFocus
        />
        <View style={{ height: 20 }} />
        {hintText ? <Text style={styles.hint}>{hintText}</Text> : null}
        <Text style={styles.hint}>変換設定は「設定」タブから変更できます</Text>
        <Text style={styles.hint}>ルビは波括弧で{'{漢字|よみ}'}と書くと振れます</Text>
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  topBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  groupList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  groupChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8' },
  groupChipSelected: { backgroundColor: '#2C2418', borderColor: '#2C2418' },
  groupChipText: { fontSize: 15, lineHeight: 20, color: '#2C2418', fontFamily: 'NotoSerifJP_400Regular' },
  groupChipTextSelected: { color: '#F5F0E8' },
  inputArea: { flex: 1, marginHorizontal: 16, marginTop: 8, paddingTop: 8 },
  tankaInput: {
    fontSize: 22, color: '#2C2418', lineHeight: 38,
    letterSpacing: 2, textAlignVertical: 'top',
    fontFamily: 'NotoSerifJP_400Regular',
    includeFontPadding: false, paddingTop: 12,
  },
  hint: { fontSize: 11, color: '#A69880', marginTop: 8 },
});
