import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function TayoriScreen() {
  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name="email-outline" size={48} color="#8B7E6A" style={{ marginBottom: 12 }} />
      <Text style={styles.title}>たより</Text>
      <Text style={styles.subtitle}>Phase 2 で実装予定</Text>
      <Text style={styles.desc}>リアクションや評の通知が{'\n'}ここに一覧表示されます</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8', justifyContent: 'center', alignItems: 'center', padding: 40 },
  icon: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 24, color: '#2C2418', fontWeight: '300', marginBottom: 8, letterSpacing: 4 },
  subtitle: { fontSize: 14, color: '#8B7E6A', marginBottom: 16 },
  desc: { fontSize: 13, color: '#A69880', textAlign: 'center', lineHeight: 20 },
});
