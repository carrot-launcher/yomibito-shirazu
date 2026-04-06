import React, { createContext, useCallback, useContext, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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

  return (
    <AlertContext.Provider value={{ alert }}>
      {children}
      <Modal visible={state.visible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>{state.title}</Text>
            {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
            <View style={styles.buttonRow}>
              {cancelButton && (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => handlePress(cancelButton)}>
                  <Text style={styles.cancelText}>{cancelButton.text}</Text>
                </TouchableOpacity>
              )}
              {actionButtons.map((btn, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.actionBtn, btn.style === 'destructive' && styles.destructiveBtn]}
                  onPress={() => handlePress(btn)}
                >
                  <Text style={[styles.actionText, btn.style === 'destructive' && styles.destructiveText]}>
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
    flex: 1, backgroundColor: 'rgba(44,36,24,0.4)',
    justifyContent: 'center', alignItems: 'center',
  },
  card: {
    backgroundColor: '#FFFDF8', borderRadius: 16, padding: 28,
    width: '82%', borderWidth: 1, borderColor: '#E8E0D0',
  },
  title: {
    fontSize: 17, color: '#2C2418', fontWeight: '500',
    textAlign: 'center', marginBottom: 8, lineHeight: 24,
  },
  message: {
    fontSize: 14, color: '#8B7E6A', textAlign: 'center',
    lineHeight: 22, marginBottom: 4,
  },
  buttonRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 12, marginTop: 20,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: '#E8E0D0',
  },
  cancelText: { color: '#8B7E6A', fontSize: 15 },
  actionBtn: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderRadius: 10, backgroundColor: '#2C2418',
  },
  actionText: { color: '#F5F0E8', fontSize: 15 },
  destructiveBtn: { backgroundColor: '#C53030' },
  destructiveText: { color: '#FFFFFF' },
});
