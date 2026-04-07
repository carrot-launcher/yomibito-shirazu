import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useMemo } from 'react';
import { Text } from 'react-native';

import { useAuth } from '../hooks/useAuth';
import { useTayoriUnread } from '../hooks/useTayoriUnread';
import { useTheme } from '../theme/ThemeContext';
import { fs } from '../utils/scale';
import ComposeScreen from '../screens/ComposeScreen';
import GroupSettingsScreen from '../screens/GroupSettingsScreen';
import KashuScreen from '../screens/KashuScreen';
import LoginScreen from '../screens/LoginScreen';
import ScreenshotScreen from '../screens/ScreenshotScreen';
import SettingsScreen from '../screens/SettingsScreen';
import TankaDetailScreen from '../screens/TankaDetailScreen';
import TayoriScreen from '../screens/TayoriScreen';
import TimelineScreen from '../screens/TimelineScreen';
import WelcomeScreen from '../screens/WelcomeScreen';
import UtakaiListScreen from '../screens/UtakaiListScreen';

const RootStack = createNativeStackNavigator();
const UtakaiStack = createNativeStackNavigator();
const TayoriStack = createNativeStackNavigator();
const KashuStack = createNativeStackNavigator();
const SettingsStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

function useCommonHeaderStyle() {
  const { colors } = useTheme();
  return useMemo(() => ({
    headerStyle: { backgroundColor: colors.gradientTop },
    headerTintColor: colors.text,
    headerTitle: (props: any) => (
      <Text style={{ fontFamily: 'NotoSerifJP_400Regular', fontWeight: '300', fontSize: fs(22), letterSpacing: 2, color: colors.text, includeFontPadding: false, textAlignVertical: 'center' }}>
        {props.children}
      </Text>
    ),
    headerShadowVisible: false,
  }), [colors]);
}

// 共通画面（TankaDetail, GroupSettings）を各タブStackに登録するヘルパー
function sharedScreens(Stack: ReturnType<typeof createNativeStackNavigator>) {
  return (
    <>
      <Stack.Screen name="TankaDetail" component={TankaDetailScreen} options={{ title: '' }} />
      <Stack.Screen name="GroupSettings" component={GroupSettingsScreen} options={{ title: '歌会設定' }} />
    </>
  );
}

function UtakaiStackScreen() {
  const commonHeaderStyle = useCommonHeaderStyle();
  return (
    <UtakaiStack.Navigator screenOptions={commonHeaderStyle}>
      <UtakaiStack.Screen name="UtakaiList" component={UtakaiListScreen} options={{ title: '歌会' }} />
      <UtakaiStack.Screen name="Timeline" component={TimelineScreen}
        options={({ route }: any) => ({ title: route.params?.groupName || 'タイムライン' })} />
      {sharedScreens(UtakaiStack)}
    </UtakaiStack.Navigator>
  );
}

function TayoriStackScreen() {
  const commonHeaderStyle = useCommonHeaderStyle();
  return (
    <TayoriStack.Navigator screenOptions={commonHeaderStyle}>
      <TayoriStack.Screen name="TayoriList" component={TayoriScreen} options={{ title: 'たより' }} />
      {sharedScreens(TayoriStack)}
    </TayoriStack.Navigator>
  );
}

function KashuStackScreen() {
  const commonHeaderStyle = useCommonHeaderStyle();
  return (
    <KashuStack.Navigator screenOptions={commonHeaderStyle}>
      <KashuStack.Screen name="KashuList" component={KashuScreen} options={{ title: '歌集' }} />
      {sharedScreens(KashuStack)}
    </KashuStack.Navigator>
  );
}

function SettingsStackScreen() {
  const commonHeaderStyle = useCommonHeaderStyle();
  return (
    <SettingsStack.Navigator screenOptions={commonHeaderStyle}>
      <SettingsStack.Screen name="SettingsList" component={SettingsScreen} options={{ title: '設定' }} />
    </SettingsStack.Navigator>
  );
}

function HomeTabs() {
  const { colors } = useTheme();
  const unread = useTayoriUnread();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: colors.gradientBottom, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: 'NotoSerifJP_400Regular', fontSize: 12 },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textTertiary,
        headerShown: false,
      }}
    >
      <Tab.Screen name="UtakaiTab" component={UtakaiStackScreen}
        options={{ title: '歌会', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="book-open-variant" size={22} color={color} /> }} />
      <Tab.Screen name="TayoriTab" component={TayoriStackScreen}
        options={{ title: 'たより', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="email-outline" size={22} color={color} />, tabBarBadge: unread > 0 ? unread : undefined, tabBarBadgeStyle: { backgroundColor: colors.destructive, fontSize: 11 } }} />
      <Tab.Screen name="KashuTab" component={KashuStackScreen}
        options={{ title: '歌集', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="notebook-outline" size={22} color={color} /> }} />
      <Tab.Screen name="SettingsTab" component={SettingsStackScreen}
        options={{ title: '設定', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="cog-outline" size={22} color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, loading, onboardingDone } = useAuth();
  const commonHeaderStyle = useCommonHeaderStyle();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (!navigationRef.isReady()) return;
      if (data?.postId && data?.groupId) {
        (navigationRef as any).navigate('TayoriTab', {
          screen: 'TankaDetail',
          params: { postId: data.postId, groupId: data.groupId },
        });
      } else {
        // postIdがない通知（解散など）はたよりタブを開くだけ
        (navigationRef as any).navigate('TayoriTab');
      }
    });
    return () => sub.remove();
  }, []);

  if (loading) return null;

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={async () => {
        const route = navigationRef.getCurrentRoute();
        if (route) {
          await logEvent(getAnalytics(), 'screen_view', { screen_name: route.name, screen_class: route.name });
        }
      }}
    >
      <RootStack.Navigator screenOptions={commonHeaderStyle}>
        {!user ? (
          <RootStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : !onboardingDone ? (
          <RootStack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <RootStack.Screen name="Main" component={HomeTabs} options={{ headerShown: false }} />
            <RootStack.Screen name="Compose" component={ComposeScreen} options={{ title: '詠む', presentation: 'modal' }} />
            <RootStack.Screen name="Screenshot" component={ScreenshotScreen} options={{ title: '', presentation: 'modal' }} />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
