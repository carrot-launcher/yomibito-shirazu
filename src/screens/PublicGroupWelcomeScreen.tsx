import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GradientBackground from '../components/GradientBackground';
import { useTheme } from '../theme/ThemeContext';
import { fs } from '../utils/scale';

export default function PublicGroupWelcomeScreen({ navigation, route }: any) {
  const { groupId, groupName, purpose } = route.params;
  const { colors } = useTheme();

  useEffect(() => {
    navigation.setOptions({ title: '', headerBackVisible: false, gestureEnabled: false });
  }, [navigation]);

  const handleEnter = () => {
    navigation.replace('Timeline', { groupId, groupName });
  };

  return (
    <GradientBackground style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.welcome, { color: colors.textSecondary }]}>ようこそ</Text>
        <Text style={[styles.groupName, { color: colors.text }]}>{groupName}</Text>

        {purpose ? (
          <View style={[styles.purposeBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.purposeLabel, { color: colors.textTertiary }]}>趣意</Text>
            <Text style={[styles.purposeText, { color: colors.text }]}>{purpose}</Text>
          </View>
        ) : null}

        <View style={styles.creedBox}>
          <Text style={[styles.creedText, { color: colors.textSecondary }]}>
            ここは公開の歌会です。{'\n'}
            ひとつひとつの歌を、丁寧に詠みましょう。{'\n'}
            他の方の歌にも、静かな心で耳を澄ませて。
          </Text>
          <Text style={[styles.creedNote, { color: colors.textTertiary }]}>
            通知は初期設定で無効になっています。{'\n'}歌会設定から切り替えられます。
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.gradientBottom, borderTopColor: colors.border }]}>
        <TouchableOpacity style={[styles.enterBtn, { backgroundColor: colors.accent }]} onPress={handleEnter}>
          <Text style={[styles.enterBtnText, { color: colors.accentText }]}>歌会に入る</Text>
        </TouchableOpacity>
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingTop: 40, paddingBottom: 32 },
  welcome: { fontSize: 14, fontFamily: 'NotoSerifJP_400Regular', letterSpacing: 4, textAlign: 'center', marginBottom: 8 },
  groupName: { fontSize: fs(22), fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 2, textAlign: 'center', marginBottom: 28 },
  purposeBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 18, marginBottom: 28 },
  purposeLabel: { fontSize: 11, fontFamily: 'NotoSerifJP_500Medium', letterSpacing: 2, marginBottom: 8 },
  purposeText: { fontSize: fs(14), lineHeight: 24, fontFamily: 'NotoSerifJP_400Regular' },
  creedBox: { paddingHorizontal: 8 },
  creedText: { fontSize: fs(14), lineHeight: 28, fontFamily: 'NotoSerifJP_400Regular', textAlign: 'center', marginBottom: 24 },
  creedNote: { fontSize: 12, lineHeight: 20, fontFamily: 'NotoSerifJP_400Regular', textAlign: 'center' },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  enterBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  enterBtnText: { fontSize: 16, fontFamily: 'NotoSerifJP_500Medium' },
});
