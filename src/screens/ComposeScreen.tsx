import * as Crypto from 'expo-crypto';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAlert } from '../components/CustomAlert';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';

export default function ComposeScreen({ route, navigation }: any) {
  const preselectedGroupId = route.params?.preselectedGroupId;
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [groups, setGroups] = useState<{ id: string; name: string; selected: boolean }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { alert } = useAlert();
  const MAX_CHARS = 50;

  useEffect(() => {
    if (!user) return;
    (async () => {
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const joinedGroups: string[] = userSnap.data()?.joinedGroups || [];
      const fetched = await Promise.all(joinedGroups.map(async (gid) => {
        const gSnap = await getDoc(doc(db, 'groups', gid));
        return { id: gid, name: gSnap.data()?.name || '不明', selected: gid === preselectedGroupId };
      }));
      setGroups(fetched);
    })();
  }, [user]);

  const toggleGroup = (id: string) => setGroups(prev => prev.map(g => g.id === id ? { ...g, selected: !g.selected } : g));

  const handleSubmit = async () => {
    if (!user || !body.trim()) return;
    const selectedGroups = groups.filter(g => g.selected);
    if (selectedGroups.length === 0) { alert('送り先を選んでください'); return; }
    if (body.length > MAX_CHARS) { alert(`${MAX_CHARS}文字以内にしてください`); return; }
    setSubmitting(true);
    try {
      const batchId = Crypto.randomUUID();
      for (const group of selectedGroups) {
        const postRef = await addDoc(collection(db, 'posts'), { groupId: group.id, body: body.trim(), batchId, createdAt: serverTimestamp(), reactionSummary: {}, commentCount: 0 });
        await setDoc(doc(db, 'posts', postRef.id, 'private', 'author'), { authorId: user.uid });
        await addDoc(collection(db, 'users', user.uid, 'myPosts'), { postId: postRef.id, groupId: group.id, groupName: group.name, tankaBody: body.trim(), batchId, createdAt: serverTimestamp() });
      }
      navigation.goBack();
    } catch (e: any) { alert('エラー', e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>送り先</Text>
      <View style={styles.groupList}>
        {groups.map(g => (
          <TouchableOpacity key={g.id} style={[styles.groupChip, g.selected && styles.groupChipSelected]} onPress={() => toggleGroup(g.id)}>
            <Text style={[styles.groupChipText, g.selected && styles.groupChipTextSelected]}>{g.selected ? '☑ ' : '☐ '}{g.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.inputArea}>
        <TextInput style={styles.tankaInput} value={body} onChangeText={setBody} placeholder="歌を詠む..." placeholderTextColor="#A69880" multiline maxLength={MAX_CHARS} autoFocus />
      </View>
      <Text style={styles.charCount}><Text style={body.length > MAX_CHARS ? styles.charOver : undefined}>{body.length}</Text>/{MAX_CHARS} 文字</Text>
      <TouchableOpacity style={[styles.submitBtn, (submitting || !body.trim()) && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={submitting || !body.trim()}>
        <Text style={styles.submitBtnText}>{submitting ? '詠んでいます...' : '詠む'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' }, content: { padding: 20 },
  label: { fontSize: 14, color: '#8B7E6A', marginBottom: 8 },
  groupList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  groupChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF8' },
  groupChipSelected: { backgroundColor: '#2C2418', borderColor: '#2C2418' },
  groupChipText: { fontSize: 14, color: '#2C2418' }, groupChipTextSelected: { color: '#F5F0E8' },
  inputArea: { backgroundColor: '#FFFDF8', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E8E0D0', minHeight: 160, marginBottom: 12 },
  tankaInput: { fontSize: 20, color: '#2C2418', lineHeight: 32, textAlignVertical: 'top' },
  charCount: { textAlign: 'right', fontSize: 13, color: '#8B7E6A', marginBottom: 24 }, charOver: { color: '#C53030' },
  submitBtn: { backgroundColor: '#2C2418', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.4 }, submitBtnText: { color: '#F5F0E8', fontSize: 18, letterSpacing: 4 },
});
