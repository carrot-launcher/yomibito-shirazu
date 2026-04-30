import React from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeContext';

// multiline TextInput はリターンキーで dismiss できないため、iOS の標準パターンとして
// キーボード上に「完了」バーを表示する。各 multiline TextInput では
// `inputAccessoryViewID={KEYBOARD_DONE_ID}` を指定すること（Android 側は無視される）。
// このコンポーネントは App.tsx 直下に 1 つだけマウントすれば全画面で共有できる。
export const KEYBOARD_DONE_ID = 'keyboard-done-accessory';

export function KeyboardDoneAccessory() {
  const { colors } = useTheme();
  // InputAccessoryView は iOS 専用。Android で render すると warning が出るので分岐。
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.btn} hitSlop={8}>
          <AppText variant="bodyLg" weight="medium" style={{ color: colors.text }}>完了</AppText>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  btn: { paddingHorizontal: 12, paddingVertical: 4 },
});
