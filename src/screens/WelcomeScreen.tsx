import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import GradientBackground from '../components/GradientBackground';
import { useAuth } from '../hooks/useAuth';

export default function WelcomeScreen() {
  const { setOnboardingDone } = useAuth();
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
          <AppText variant="bodyLg" tone="secondary" style={styles.text}>
            ここは、静かに短歌を詠み合う場所
          </AppText>
          <AppText variant="bodyLg" tone="secondary" style={styles.text}>
            あなたの詠草は{'\n'}誰が詠んだか知られることなく{'\n'}歌会の仲間に届きます
          </AppText>
          <AppText variant="bodySm" tone="tertiary" style={styles.hint}>
            まずは公開歌会を探すか{'\n'}招待コードを受け取りましょう
          </AppText>
        </View>

        <AppButton label="はじめる" variant="primary" size="lg" onPress={handleStart} style={styles.startBtn} />
      </Animated.View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36 },
  body: { gap: 20, marginBottom: 56 },
  // ウェルカム画面は静謐な雰囲気のため、行間を広めに上書き
  text: { lineHeight: 28, textAlign: 'center' },
  hint: { lineHeight: 24, textAlign: 'center', marginTop: 8 },
  startBtn: { paddingHorizontal: 48 },
});
