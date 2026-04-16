import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
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
    title: { fontSize: 36, fontWeight: '300', color: colors.text, letterSpacing: 8, marginBottom: 48, fontFamily: 'NotoSerifJP_400Regular' },
    button: { backgroundColor: colors.accent, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    buttonDisabled: { opacity: 0.35 },
    buttonText: { color: colors.accentText, fontSize: 17, lineHeight: 24, letterSpacing: 1, fontFamily: 'NotoSerifJP_500Medium' },
    agreement: { marginTop: 32, paddingHorizontal: 32, alignItems: 'center', gap: 12 },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    checkboxLabel: { fontSize: 13, lineHeight: 20, color: colors.textSecondary, fontFamily: 'NotoSerifJP_400Regular' },
    agreementText: { fontSize: 12, lineHeight: 20, color: colors.textTertiary, textAlign: 'center', fontFamily: 'NotoSerifJP_400Regular' },
    agreementLink: { color: colors.textSecondary, textDecorationLine: 'underline' as const },
  }), [colors]);

  return (
    <GradientBackground style={dynamicStyles.container}>
      <Text style={dynamicStyles.title}>詠み人知らず</Text>

      <View style={dynamicStyles.agreement}>
        <Text style={dynamicStyles.agreementText}>
          <Text style={dynamicStyles.agreementLink} onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}>利用規約</Text>
          {' と '}
          <Text style={dynamicStyles.agreementLink} onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}>プライバシーポリシー</Text>
        </Text>

        <TouchableOpacity style={dynamicStyles.checkboxRow} onPress={() => setAgreed(v => !v)} activeOpacity={0.7}>
          <MaterialCommunityIcons
            name={agreed ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={22}
            color={agreed ? colors.text : colors.textSecondary}
          />
          <Text style={dynamicStyles.checkboxLabel}>上記に同意します</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[dynamicStyles.button, !agreed && dynamicStyles.buttonDisabled, { marginTop: 24 }]}
        onPress={handleGoogleSignIn}
        disabled={!agreed}
      >
        <Text style={dynamicStyles.buttonText}>Google でログイン</Text>
      </TouchableOpacity>
    </GradientBackground>
  );
}
