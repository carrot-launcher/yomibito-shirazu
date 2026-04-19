import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { auth, WEB_CLIENT_ID } from '../config/firebase';
import { useTheme } from '../theme/ThemeContext';

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });

const TERMS_URL = 'https://carrot-launcher.github.io/yomibito-shirazu/terms-of-service.html';
const PRIVACY_URL = 'https://carrot-launcher.github.io/yomibito-shirazu/privacy-policy.html';

export default function LoginScreen() {
  const { alert } = useAlert();
  const { colors } = useTheme();
  const [agreed, setAgreed] = useState(false);

  const handleGoogleSignIn = async () => {
    if (!agreed) return;
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await GoogleSignin.signOut();
      const response = await GoogleSignin.signIn();
      if (response.type === 'success' && response.data?.idToken) {
        const credential = GoogleAuthProvider.credential(response.data.idToken);
        await signInWithCredential(auth, credential);
      }
    } catch (error: any) {
      alert('ログインエラー', `${error.code || ''}: ${error.message}`);
    }
  };

  const dynamicStyles = useMemo(() => StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    // ロゴ的扱いの大きなタイトル — 専用のフォントウェイト（300）と字間
    title: { fontSize: 36, fontWeight: '300', color: colors.text, letterSpacing: 8, marginBottom: 48, fontFamily: 'NotoSerifJP_400Regular' },
    agreement: { marginTop: 32, paddingHorizontal: 32, alignItems: 'center', gap: 12 },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    agreementText: { textAlign: 'center' as const, lineHeight: 20 },
    agreementLink: { textDecorationLine: 'underline' as const },
  }), [colors]);

  return (
    <GradientBackground style={dynamicStyles.container}>
      <Text style={dynamicStyles.title}>よみ人しらず</Text>

      <View style={dynamicStyles.agreement}>
        <AppText variant="caption" tone="tertiary" style={dynamicStyles.agreementText}>
          <AppText variant="caption" tone="secondary" style={dynamicStyles.agreementLink} onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}>利用規約</AppText>
          {' と '}
          <AppText variant="caption" tone="secondary" style={dynamicStyles.agreementLink} onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}>プライバシーポリシー</AppText>
        </AppText>

        <TouchableOpacity style={dynamicStyles.checkboxRow} onPress={() => setAgreed(v => !v)} activeOpacity={0.7}>
          <MaterialCommunityIcons
            name={agreed ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={22}
            color={agreed ? colors.text : colors.textSecondary}
          />
          <AppText variant="caption" tone="secondary">上記に同意します</AppText>
        </TouchableOpacity>
      </View>

      <AppButton
        label="Google でログイン"
        variant="primary"
        size="lg"
        onPress={handleGoogleSignIn}
        disabled={!agreed}
        style={{ marginTop: 24, paddingHorizontal: 32 }}
      />
    </GradientBackground>
  );
}
