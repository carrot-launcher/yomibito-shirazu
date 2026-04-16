import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GradientBackground from '../components/GradientBackground';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';

const TERMS_URL = 'https://carrot-launcher.github.io/yomibito-shirazu/terms-of-service.html';
const PRIVACY_URL = 'https://carrot-launcher.github.io/yomibito-shirazu/privacy-policy.html';

export default function WelcomeScreen() {
  const { setOnboardingDone } = useAuth();
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, []);

  const handleStart = () => {
    if (!agreed) return;
    Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(() => {
      setOnboardingDone(true);
    });
  };

  return (
    <GradientBackground style={styles.container}>
      <Animated.View style={[styles.content, { opacity }]}>
        <View style={styles.body}>
          <Text style={[styles.text, { color: colors.textSecondary }]}>
            ここは、名を伏せて短歌を詠み合う場所
          </Text>
          <Text style={[styles.text, { color: colors.textSecondary }]}>
            あなたの詠草は{'\n'}誰が詠んだか知られることなく{'\n'}歌会の仲間に届きます
          </Text>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            まずは公開歌会を探すか{'\n'}招待コードを受け取りましょう
          </Text>
        </View>

        <View style={styles.agreementArea}>
          <View style={styles.linksRow}>
            <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}>
              <Text style={[styles.link, { color: colors.text }]}>利用規約</Text>
            </TouchableOpacity>
            <Text style={[styles.linkSep, { color: colors.textTertiary }]}>・</Text>
            <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}>
              <Text style={[styles.link, { color: colors.text }]}>プライバシーポリシー</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAgreed(v => !v)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={agreed ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={agreed ? colors.text : colors.textSecondary}
            />
            <Text style={[styles.checkboxLabel, { color: colors.textSecondary }]}>
              利用規約およびプライバシーポリシーに同意します
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.accent },
            !agreed && styles.buttonDisabled,
          ]}
          onPress={handleStart}
          disabled={!agreed}
        >
          <Text style={[styles.buttonText, { color: colors.accentText }]}>はじめる</Text>
        </TouchableOpacity>
      </Animated.View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36 },
  body: { gap: 20, marginBottom: 40 },
  text: {
    fontSize: 16, lineHeight: 28, textAlign: 'center',
    fontFamily: 'NotoSerifJP_400Regular',
  },
  hint: {
    fontSize: 14, lineHeight: 24, textAlign: 'center',
    marginTop: 8, fontFamily: 'NotoSerifJP_400Regular',
  },
  agreementArea: {
    marginBottom: 24,
    alignItems: 'center',
    gap: 10,
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  link: {
    fontSize: 13, lineHeight: 20,
    fontFamily: 'NotoSerifJP_400Regular',
    textDecorationLine: 'underline',
  },
  linkSep: {
    fontSize: 13, lineHeight: 20,
    fontFamily: 'NotoSerifJP_400Regular',
    marginHorizontal: 6,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  checkboxLabel: {
    fontSize: 13, lineHeight: 20,
    fontFamily: 'NotoSerifJP_400Regular',
  },
  button: {
    paddingHorizontal: 48, paddingVertical: 14,
    borderRadius: 10,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonText: {
    fontSize: 17, lineHeight: 22, fontFamily: 'NotoSerifJP_500Medium',
  },
});
