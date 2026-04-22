import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, OAuthProvider, signInWithCredential } from 'firebase/auth';
import React, { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { auth, WEB_CLIENT_ID } from '../config/firebase';
import { useTheme } from '../theme/ThemeContext';
import { breadcrumb } from '../utils/breadcrumb';
import { describeError } from '../utils/errorMessage';

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });

const TERMS_URL = 'https://carrot-launcher.github.io/yomibito-shirazu/terms-of-service.html';
const PRIVACY_URL = 'https://carrot-launcher.github.io/yomibito-shirazu/privacy-policy.html';

export default function LoginScreen() {
  const { alert } = useAlert();
  const { colors, isDark } = useTheme();
  const [agreed, setAgreed] = useState(false);

  const handleGoogleSignIn = async () => {
    if (!agreed) return;
    breadcrumb('login:google');
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await GoogleSignin.signOut();
      const response = await GoogleSignin.signIn();
      if (response.type === 'success' && response.data?.idToken) {
        const credential = GoogleAuthProvider.credential(response.data.idToken);
        await signInWithCredential(auth, credential);
      }
    } catch (error: any) {
      const { title, message } = describeError(error);
      alert(title, message);
    }
  };

  // Sign in with Apple — App Review Guideline 4.8 対応（iOS 限定表示）
  // Firebase Auth は nonce を要求する。生の nonce と SHA256 ハッシュの両方を用意し、
  // Apple には hash を渡し Firebase には raw を渡すことで、中間者攻撃を防ぐ。
  const handleAppleSignIn = async () => {
    if (!agreed) return;
    breadcrumb('login:apple');
    try {
      const rawNonce = [...Array(32)]
        .map(() => Math.floor(Math.random() * 36).toString(36))
        .join('');
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        ],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) {
        alert('ログインエラー', 'Apple IDトークンが取得できませんでした');
        return;
      }
      const fbCred = new OAuthProvider('apple.com').credential({
        idToken: credential.identityToken,
        rawNonce,
      });
      await signInWithCredential(auth, fbCred);
    } catch (error: any) {
      // ユーザーがキャンセルしただけの場合は黙る
      if (error.code === 'ERR_REQUEST_CANCELED') return;
      const { title, message } = describeError(error);
      alert(title, message);
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
    appleButton: { width: 240, height: 48, marginTop: 24 },
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

      {/* Apple HIG: Sign in with Apple は他ログイン手段と同等以上に目立つ位置に置く */}
      {Platform.OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={isDark
            ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={10}
          style={dynamicStyles.appleButton}
          onPress={agreed ? handleAppleSignIn : () => {}}
        />
      )}

      <AppButton
        label="Google でログイン"
        variant="primary"
        size="lg"
        onPress={handleGoogleSignIn}
        disabled={!agreed}
        style={{ marginTop: Platform.OS === 'ios' ? 12 : 24, paddingHorizontal: 32 }}
      />
    </GradientBackground>
  );
}
