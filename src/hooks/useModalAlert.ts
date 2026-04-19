import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { useAlert } from '../components/CustomAlert';

/**
 * presentation:'modal' なスクリーンで確実に alert を出すためのフック。
 *
 * 経緯: React Navigation の modal 画面は iOS では native の presentViewController
 * を使うため、その上に React Native の <Modal>（CustomAlert の実装）を出そうとすると
 * 提示チェーンが詰まって表示されないことがある。
 *
 * 仕様:
 *  - iOS: Alert.alert（UIAlertController。OS 側で常に最前面を保証される）
 *  - Android: CustomAlert（アプリ共通のデザインを維持）
 *
 * 使い方:
 *   const alert = useModalAlert();
 *   alert('保存しました', 'ギャラリーに保存しました');
 *
 * 非モーダル画面（普通に push されるスクリーン）では従来通り useAlert() を使う。
 */
export function useModalAlert() {
  const { alert: customAlert } = useAlert();
  return useCallback((title: string, message?: string) => {
    if (Platform.OS === 'ios') {
      Alert.alert(title, message);
    } else {
      customAlert(title, message);
    }
  }, [customAlert]);
}
