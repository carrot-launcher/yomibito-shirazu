import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { useAuth } from '../hooks/useAuth';
import { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

export default function BlockedAuthorsScreen() {
  const { blockedHandles } = useAuth();
  const { colors } = useTheme();
  const { alert } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [working, setWorking] = useState<string | null>(null);

  const entries = useMemo(() => {
    return Object.entries(blockedHandles)
      .map(([handle, info]) => ({ handle, ...info }))
      .sort((a, b) => {
        const at = a.blockedAt?.toDate?.()?.getTime?.() || 0;
        const bt = b.blockedAt?.toDate?.()?.getTime?.() || 0;
        return bt - at;
      });
  }, [blockedHandles]);

  const handleUnblock = (handle: string) => {
    alert(
      'ブロック解除',
      'この歌人の歌・評が再び表示されるようになります。',
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: '解除する',
          onPress: async () => {
            setWorking(handle);
            try {
              const fns = getFunctions(undefined, 'asia-northeast1');
              await httpsCallable(fns, 'unblockAuthor')({ handle });
            } catch (e: any) {
              alert('エラー', e?.message || '解除に失敗しました');
            } finally {
              setWorking(null);
            }
          },
        },
      ]
    );
  };

  return (
    <GradientBackground>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          ブロック中の歌人の歌・評は、あなたには表示されません。相手にブロックしたことは通知されません。解除するとまた表示されるようになります。{'\n\n'}
          歌人は匿名のため、歌会での表示名ではなく、歌のサンプルで見分けてください。
        </Text>

        {entries.length === 0 && (
          <Text style={styles.empty}>ブロック中の歌人はいません。</Text>
        )}

        {entries.map((e) => {
          const date = e.blockedAt?.toDate?.();
          const dateStr = date ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` : '';
          return (
            <View key={e.handle} style={styles.card}>
              <View style={styles.cardMain}>
                {e.sampleBody ? (
                  <Text style={styles.sample} numberOfLines={2}>「{e.sampleBody}」</Text>
                ) : (
                  <Text style={styles.samplePlaceholder}>（歌のサンプルなし）</Text>
                )}
                <Text style={styles.meta}>
                  {dateStr ? `${dateStr}にブロック` : 'ブロック中'}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.unblockBtn, working === e.handle && styles.unblockBtnDisabled]}
                onPress={() => handleUnblock(e.handle)}
                disabled={working === e.handle}
              >
                <MaterialCommunityIcons name="close" size={14} color={colors.text} />
                <Text style={styles.unblockText}>解除</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </GradientBackground>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 16, paddingBottom: 40 },
    intro: {
      fontSize: 13, lineHeight: 20, color: colors.textSecondary,
      marginBottom: 16, fontFamily: 'NotoSerifJP_400Regular',
    },
    empty: {
      textAlign: 'center', marginTop: 40, color: colors.textSecondary,
      fontFamily: 'NotoSerifJP_400Regular',
    },
    card: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border,
      padding: 12, marginBottom: 10, gap: 12,
    },
    cardMain: { flex: 1, gap: 4 },
    sample: {
      fontSize: 14, lineHeight: 20, color: colors.text,
      fontFamily: 'NotoSerifJP_400Regular',
    },
    samplePlaceholder: {
      fontSize: 13, lineHeight: 18, color: colors.textTertiary,
      fontFamily: 'NotoSerifJP_400Regular',
    },
    meta: {
      fontSize: 11, lineHeight: 15, color: colors.textSecondary,
      fontFamily: 'NotoSerifJP_400Regular',
    },
    unblockBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: 6, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    unblockBtnDisabled: { opacity: 0.4 },
    unblockText: {
      fontSize: 12, lineHeight: 16, color: colors.text,
      fontFamily: 'NotoSerifJP_400Regular',
    },
  });
}
