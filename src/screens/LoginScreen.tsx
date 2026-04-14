import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { auth, WEB_CLIENT_ID } from '../config/firebase';
import { useTheme } from '../theme/ThemeContext';

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });

export default function LoginScreen() {
  const { alert } = useAlert();
  const { colors } = useTheme();
  const handleGoogleSignIn = async () => {
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
    subtitle: { fontSize: 15, color: colors.textSecondary, marginBottom: 48, letterSpacing: 2, fontFamily: 'NotoSerifJP_400Regular' },
    button: { backgroundColor: colors.accent, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    buttonText: { color: colors.accentText, fontSize: 17, lineHeight: 24, letterSpacing: 1, fontFamily: 'NotoSerifJP_500Medium' },
    agreement: { marginTop: 32, paddingHorizontal: 32 },
    agreementText: { fontSize: 12, lineHeight: 20, color: colors.textTertiary, textAlign: 'center', fontFamily: 'NotoSerifJP_400Regular' },
    agreementLink: { color: colors.textSecondary, textDecorationLine: 'underline' as const },
  }), [colors]);

  return (
    <GradientBackground style={dynamicStyles.container}>
      <Text style={dynamicStyles.title}>詠み人知らず</Text>
      <TouchableOpacity style={dynamicStyles.button} onPress={handleGoogleSignIn}>
        <Text style={dynamicStyles.buttonText}>Google でログイン</Text>
      </TouchableOpacity>

      <View style={dynamicStyles.agreement}>
        <Text style={dynamicStyles.agreementText}>
          ログインすることで、
          <Text style={dynamicStyles.agreementLink} onPress={() => WebBrowser.openBrowserAsync('https://carrot-launcher.github.io/yomibito-shirazu/terms-of-service.html')}>利用規約</Text>
          と
          <Text style={dynamicStyles.agreementLink} onPress={() => WebBrowser.openBrowserAsync('https://carrot-launcher.github.io/yomibito-shirazu/privacy-policy.html')}>プライバシーポリシー</Text>
          に同意したものとみなします。
        </Text>
      </View>
    </GradientBackground>
  );
}
