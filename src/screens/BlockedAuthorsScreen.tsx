import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { useAuth } from '../hooks/useAuth';
import { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { breadcrumb } from '../utils/breadcrumb';
import { describeError } from '../utils/errorMessage';

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
            breadcrumb(`unblock:submit`);
            setWorking(handle);
            try {
              const fns = getFunctions(undefined, 'asia-northeast1');
              await httpsCallable(fns, 'unblockAuthor')({ handle });
            } catch (e: any) {
              const { title, message } = describeError(e);
              alert(title, message || '解除に失敗しました');
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
        <AppText variant="caption" tone="secondary" style={styles.intro}>
          ブロック中の歌人とは、互いの歌・評が見えなくなり、互いにリアクションや評も送れなくなります。相手にブロックしたことは通知されません。解除するとまた表示されるようになります。{'\n\n'}
          歌人は歌のサンプルで見分けてください。
        </AppText>

        {entries.length === 0 && (
          <AppText variant="body" tone="secondary" style={styles.empty}>ブロック中の歌人はいません。</AppText>
        )}

        {entries.map((e) => {
          const date = e.blockedAt?.toDate?.();
          const dateStr = date ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` : '';
          return (
            <View key={e.handle} style={styles.card}>
              <View style={styles.cardMain}>
                {e.sampleBody ? (
                  <AppText variant="bodySm" numberOfLines={2}>「{e.sampleBody}」</AppText>
                ) : (
                  <AppText variant="caption" tone="tertiary">（歌のサンプルなし）</AppText>
                )}
                <AppText variant="meta" tone="secondary">
                  {dateStr ? `${dateStr}にブロック` : 'ブロック中'}
                </AppText>
              </View>
              <AppButton
                label="ブロック解除"
                variant="secondary"
                size="xs"
                onPress={() => handleUnblock(e.handle)}
                disabled={working === e.handle}
              />
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
    intro: { marginBottom: 16 },
    empty: { textAlign: 'center', marginTop: 40 },
    card: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border,
      padding: 12, marginBottom: 10, gap: 12,
    },
    cardMain: { flex: 1, gap: 4 },
  });
}
