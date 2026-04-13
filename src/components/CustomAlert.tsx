import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

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
    overlay: {
      backgroundColor: colors.overlay,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    title: {
      color: colors.text,
    },
    message: {
      color: colors.textSecondary,
    },
    cancelBtn: {
      borderColor: colors.border,
    },
    cancelText: {
      color: colors.textSecondary,
    },
    actionBtn: {
      backgroundColor: colors.text,
    },
    actionText: {
      color: colors.bg,
    },
    destructiveBtn: {
      backgroundColor: colors.destructive,
    },
  }), [colors]);

  return (
    <AlertContext.Provider value={{ alert }}>
      {children}
      <Modal visible={state.visible} transparent animationType="fade">
        <View style={[styles.overlay, dynamicStyles.overlay]}>
          <View style={[styles.card, dynamicStyles.card]}>
            {state.title ? <Text style={[styles.title, dynamicStyles.title]}>{state.title}</Text> : null}
            {state.message ? <Text style={[styles.message, dynamicStyles.message]}>{state.message}</Text> : null}
            <View style={styles.buttonRow}>
              {cancelButton && (
                <TouchableOpacity style={[styles.cancelBtn, dynamicStyles.cancelBtn]} onPress={() => handlePress(cancelButton)}>
                  <Text style={[styles.cancelText, dynamicStyles.cancelText]}>{cancelButton.text}</Text>
                </TouchableOpacity>
              )}
              {actionButtons.map((btn, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.actionBtn, dynamicStyles.actionBtn, btn.style === 'destructive' && dynamicStyles.destructiveBtn]}
                  onPress={() => handlePress(btn)}
                >
                  <Text style={[styles.actionText, dynamicStyles.actionText, btn.style === 'destructive' && styles.destructiveText]}>
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  card: {
    borderRadius: 16, padding: 28,
    width: '82%', borderWidth: 1,
  },
  title: {
    fontSize: 17, fontFamily: 'NotoSerifJP_500Medium',
    textAlign: 'center', marginBottom: 8, lineHeight: 24,
  },
  message: {
    fontSize: 14, textAlign: 'center',
    lineHeight: 22, marginBottom: 4,
    fontFamily: 'NotoSerifJP_400Regular',
  },
  buttonRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 12, marginTop: 20,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderRadius: 10, borderWidth: 1,
  },
  cancelText: { fontSize: 15, lineHeight: 22, fontFamily: 'NotoSerifJP_400Regular' },
  actionBtn: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderRadius: 10,
  },
  actionText: { fontSize: 15, lineHeight: 22, fontFamily: 'NotoSerifJP_500Medium' },
  destructiveText: { color: '#FFFFFF' },
});
