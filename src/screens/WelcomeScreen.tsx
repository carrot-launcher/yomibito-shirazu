import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GradientBackground from '../components/GradientBackground';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/ThemeContext';

export default function WelcomeScreen() {
  const { setOnboardingDone } = useAuth();
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, []);

  const handleStart = () => {
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

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.accent }]}
          onPress={handleStart}
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
  body: { gap: 20, marginBottom: 56 },
  text: {
    fontSize: 16, lineHeight: 28, textAlign: 'center',
    fontFamily: 'NotoSerifJP_400Regular',
  },
  hint: {
    fontSize: 14, lineHeight: 24, textAlign: 'center',
    marginTop: 8, fontFamily: 'NotoSerifJP_400Regular',
  },
  button: {
    paddingHorizontal: 48, paddingVertical: 14,
    borderRadius: 10,
  },
  buttonText: {
    fontSize: 17, lineHeight: 22, fontFamily: 'NotoSerifJP_500Medium',
  },
});
