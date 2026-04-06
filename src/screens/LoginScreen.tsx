import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, WEB_CLIENT_ID } from '../config/firebase';

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });

export default function LoginScreen() {
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
      Alert.alert('ログインエラー', `${error.code || ''}: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>詠み人知らず</Text>
      <Text style={styles.subtitle}>匿名で短歌を詠み合う</Text>
      <TouchableOpacity style={styles.button} onPress={handleGoogleSignIn}>
        <Text style={styles.buttonText}>Google でログイン</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F0E8' },
  title: { fontSize: 36, fontWeight: '300', color: '#2C2418', letterSpacing: 8, marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#8B7E6A', marginBottom: 48, letterSpacing: 2 },
  button: { backgroundColor: '#2C2418', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
  buttonText: { color: '#F5F0E8', fontSize: 16, letterSpacing: 1 },
});