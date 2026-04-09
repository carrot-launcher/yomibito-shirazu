import React from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useFonts, NotoSerifJP_400Regular, NotoSerifJP_500Medium, NotoSerifJP_700Bold } from '@expo-google-fonts/noto-serif-jp';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import { AlertProvider } from './src/components/CustomAlert';
import { AuthProvider } from './src/hooks/useAuth';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

// 全てのTextとTextInputにデフォルトフォントを適用
const defaultFontFamily = 'NotoSerifJP_400Regular';
const originalTextRender = (Text as any).render;
(Text as any).render = function (...args: any[]) {
  const origin = originalTextRender.apply(this, args);
  const style = origin.props.style;
  const fontWeight = style?.fontWeight || (Array.isArray(style) && style.find((s: any) => s?.fontWeight))?.fontWeight;
  let fontFamily = defaultFontFamily;
  if (fontWeight === '500' || fontWeight === '600') fontFamily = 'NotoSerifJP_500Medium';
  else if (fontWeight === '700' || fontWeight === 'bold') fontFamily = 'NotoSerifJP_700Bold';
  return React.cloneElement(origin, {
    style: [{ fontFamily }, style],
  });
};
const originalTextInputRender = (TextInput as any).render;
(TextInput as any).render = function (...args: any[]) {
  const origin = originalTextInputRender.apply(this, args);
  return React.cloneElement(origin, {
    style: [{ fontFamily: defaultFontFamily }, origin.props.style],
  });
};

export default function App() {
  const [fontsLoaded] = useFonts({
    NotoSerifJP_400Regular,
    NotoSerifJP_500Medium,
    NotoSerifJP_700Bold,
    IBMPlexMono_600SemiBold,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F0E8' }}><ActivityIndicator color="#2C2418" /></View>;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AlertProvider>
          <AuthProvider>
            <AppInner />
          </AuthProvider>
        </AlertProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function AppInner() {
  const { isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
    </>
  );
}
