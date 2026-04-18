import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import { AppButton } from './AppButton';
import { AppText } from './AppText';

type AlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

type AlertState = {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
};

type AlertContextType = {
  alert: (title: string, message?: string, buttons?: AlertButton[]) => void;
};

const AlertContext = createContext<AlertContextType>({ alert: () => {} });

export const useAlert = () => useContext(AlertContext);

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const [state, setState] = useState<AlertState>({ visible: false, title: '', buttons: [] });

  const alert = useCallback((title: string, message?: string, buttons?: AlertButton[]) => {
    setState({
      visible: true,
      title,
      message,
      buttons: buttons || [{ text: '閉じる' }],
    });
  }, []);

  const handlePress = (button: AlertButton) => {
    setState(prev => ({ ...prev, visible: false }));
    button.onPress?.();
  };

  const cancelButton = state.buttons.find(b => b.style === 'cancel');
  const actionButtons = state.buttons.filter(b => b.style !== 'cancel');

  const dynamicStyles = useMemo(() => ({
    overlay: { backgroundColor: colors.overlay },
    card: { backgroundColor: colors.surface, borderColor: colors.border },
  }), [colors]);

  const btnStyle = { flex: 1, alignSelf: 'auto' as const };

  return (
    <AlertContext.Provider value={{ alert }}>
      {children}
      <Modal visible={state.visible} transparent animationType="fade">
        <View style={[styles.overlay, dynamicStyles.overlay]}>
          <View style={[styles.card, dynamicStyles.card]}>
            {state.title ? (
              <AppText variant="sectionTitle" style={styles.title}>{state.title}</AppText>
            ) : null}
            {state.message ? (
              <AppText variant="bodySm" tone="secondary" style={styles.message}>{state.message}</AppText>
            ) : null}
            <View style={styles.buttonRow}>
              {cancelButton && (
                <AppButton
                  label={cancelButton.text}
                  variant="secondary"
                  onPress={() => handlePress(cancelButton)}
                  style={btnStyle}
                />
              )}
              {actionButtons.map((btn, i) => (
                <AppButton
                  key={i}
                  label={btn.text}
                  variant={btn.style === 'destructive' ? 'destructive' : 'primary'}
                  onPress={() => handlePress(btn)}
                  style={btnStyle}
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { borderRadius: 16, padding: 28, width: '82%', borderWidth: 1 },
  title: { textAlign: 'center', marginBottom: 8 },
  message: { textAlign: 'center', marginBottom: 4 },
  buttonRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 20 },
});
