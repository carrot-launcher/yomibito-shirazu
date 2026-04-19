import * as Crypto from 'expo-crypto';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import GradientBackground from '../components/GradientBackground';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { useModalAlert } from '../hooks/useModalAlert';
import { useTheme } from '../theme/ThemeContext';

const MAX_CHARS = 50;

export default function ComposeScreen({ route, navigation }: any) {
  const preselectedGroupId = route.params?.preselectedGroupId;
  const { user } = useAuth();
  const { colors } = useTheme();
  const [body, setBody] = useState('');
  const [groups, setGroups] = useState<{ id: string; name: string; selected: boolean }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [convertHalfSpace, setConvertHalfSpace] = useState(true);
  const [convertLineBreak, setConvertLineBreak] = useState(true);
  // ComposeScreen は presentation:'modal' なので useModalAlert を使う。
  const alert = useModalAlert();

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
    if (trimmedBody.length < 2) { alert('2文字以上入力してください'); return; }
    if (trimmedBody.length > MAX_CHARS) { alert(`${MAX_CHARS}文字以内にしてください`); return; }
    setSubmitting(true);
    try {
      const fns = getFunctions(undefined, 'asia-northeast1');
      const createPostFn = httpsCallable(fns, 'createPost');
      const batchId = Crypto.randomUUID();
      for (const group of selectedGroups) {
        await createPostFn({
          groupId: group.id, body: trimmedBody, batchId,
          convertHalfSpace, convertLineBreak,
        });
      }
      navigation.goBack();
    } catch (e: any) {
      const msg = e?.code === 'functions/resource-exhausted'
        ? e.message
        : e?.message || 'エラーが発生しました';
      alert('エラー', msg);
    }
    finally { setSubmitting(false); }
  }, [user, body, groups, alert, navigation, convertHalfSpace, convertLineBreak]);

  useEffect(() => {
    const canSubmit = !submitting && body.trim().length >= 2;
    navigation.setOptions({
      // 文字数カウンタは iOS の Liquid Glass ピル内に入るのを避けるため、画面本体側
      // （入力欄の上）に配置している。ヘッダー右はボタンのみ。
      headerRight: () =>
        Platform.OS === 'android' ? (
          <AppButton
            label="詠む"
            variant="secondary"
            size="xs"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={submitting}
          />
        ) : (
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit}
            hitSlop={8}
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            activeOpacity={0.5}
          >
            <AppText variant="buttonLabel" weight="medium" tone={canSubmit ? 'primary' : 'tertiary'}>
              詠む
            </AppText>
          </TouchableOpacity>
        ),
    });
  }, [submitting, handleSubmit, body, colors]);

  const hintParts: string[] = [];
  if (convertLineBreak) hintParts.push('改行');
  if (convertHalfSpace) hintParts.push('半角スペース');
  const hintText = hintParts.length > 0
    ? `${hintParts.join('・')}は全角スペースに変換されます`
    : '';

  const dynamicStyles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    groupChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    groupChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    groupChipText: { fontSize: 15, lineHeight: 20, color: colors.text, fontFamily: 'NotoSerifJP_400Regular' },
    groupChipTextSelected: { color: colors.accentText },
    tankaInput: {
      fontSize: 22, color: colors.text, lineHeight: 38,
      letterSpacing: 2, textAlignVertical: 'top',
      fontFamily: 'NotoSerifJP_400Regular',
      includeFontPadding: false, paddingTop: 12,
    },
    hint: { fontSize: 11, color: colors.textTertiary, marginTop: 8 },
  }), [colors]);

  return (
    <GradientBackground style={dynamicStyles.container}>
      <View style={styles.topBar}>
        <View style={styles.groupList}>
          {groups.map(g => (
            <TouchableOpacity key={g.id} style={[dynamicStyles.groupChip, g.selected && dynamicStyles.groupChipSelected]} onPress={() => toggleGroup(g.id)}>
              <Text style={[dynamicStyles.groupChipText, g.selected && dynamicStyles.groupChipTextSelected]}>{g.selected ? '☑ ' : '☐ '}{g.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.inputArea}>
        <AppText variant="meta" tone="tertiary" style={styles.counter}>
          {body.length}/{MAX_CHARS}
        </AppText>
        <TextInput
          style={dynamicStyles.tankaInput}
          value={body}
          onChangeText={setBody}
          placeholder="歌を詠む..."
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={MAX_CHARS}
          autoFocus
        />
        <View style={{ height: 20 }} />
        {hintText ? <AppText variant="meta" tone="tertiary" style={dynamicStyles.hint}>{hintText}</AppText> : null}
        <AppText variant="meta" tone="tertiary" style={dynamicStyles.hint}>変換設定は「設定」タブから変更できます</AppText>
        <AppText variant="meta" tone="tertiary" style={dynamicStyles.hint}>ルビは波括弧で{'{漢字|よみ}'}と書くと振れます</AppText>
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  groupList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inputArea: { flex: 1, marginHorizontal: 16, marginTop: 8, paddingTop: 8 },
  counter: { textAlign: 'right', marginBottom: 4 },
});
