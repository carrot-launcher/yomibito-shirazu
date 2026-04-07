import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import React, { useEffect } from 'react';
import { Text } from 'react-native';

import { useAuth } from '../hooks/useAuth';
import { useTayoriUnread } from '../hooks/useTayoriUnread';
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
import UtakaiListScreen from '../screens/UtakaiListScreen';

const RootStack = createNativeStackNavigator();
const UtakaiStack = createNativeStackNavigator();
const TayoriStack = createNativeStackNavigator();
const KashuStack = createNativeStackNavigator();
const SettingsStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

const HeaderTitle = ({ children }: { children: string }) => (
  <Text style={{ fontFamily: 'NotoSerifJP_400Regular', fontWeight: '300', fontSize: fs(22), letterSpacing: 2, color: '#2C2418', includeFontPadding: false, textAlignVertical: 'center' }}>
    {children}
  </Text>
);

const commonHeaderStyle = {
  headerStyle: { backgroundColor: '#F5F0E8' },
  headerTintColor: '#2C2418',
  headerTitle: (props: any) => <HeaderTitle>{props.children}</HeaderTitle>,
  headerShadowVisible: false,
};

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
  return (
    <TayoriStack.Navigator screenOptions={commonHeaderStyle}>
      <TayoriStack.Screen name="TayoriList" component={TayoriScreen} options={{ title: 'たより' }} />
      {sharedScreens(TayoriStack)}
    </TayoriStack.Navigator>
  );
}

function KashuStackScreen() {
  return (
    <KashuStack.Navigator screenOptions={commonHeaderStyle}>
      <KashuStack.Screen name="KashuList" component={KashuScreen} options={{ title: '歌集' }} />
      {sharedScreens(KashuStack)}
    </KashuStack.Navigator>
  );
}

function SettingsStackScreen() {
  return (
    <SettingsStack.Navigator screenOptions={commonHeaderStyle}>
      <SettingsStack.Screen name="SettingsList" component={SettingsScreen} options={{ title: '設定' }} />
    </SettingsStack.Navigator>
  );
}

function HomeTabs() {
  const unread = useTayoriUnread();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: '#F5F0E8', borderTopColor: '#E8E0D0' },
        tabBarLabelStyle: { fontFamily: 'NotoSerifJP_400Regular', fontSize: 12 },
        tabBarActiveTintColor: '#2C2418',
        tabBarInactiveTintColor: '#A69880',
        headerShown: false,
      }}
    >
      <Tab.Screen name="UtakaiTab" component={UtakaiStackScreen}
        options={{ title: '歌会', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="book-open-variant" size={22} color={color} /> }} />
      <Tab.Screen name="TayoriTab" component={TayoriStackScreen}
        options={{ title: 'たより', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="email-outline" size={22} color={color} />, tabBarBadge: unread > 0 ? unread : undefined, tabBarBadgeStyle: { backgroundColor: '#C53030', fontSize: 11 } }} />
      <Tab.Screen name="KashuTab" component={KashuStackScreen}
        options={{ title: '歌集', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="notebook-outline" size={22} color={color} /> }} />
      <Tab.Screen name="SettingsTab" component={SettingsStackScreen}
        options={{ title: '設定', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="cog-outline" size={22} color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, loading } = useAuth();

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
    <NavigationContainer ref={navigationRef}>
      <RootStack.Navigator screenOptions={commonHeaderStyle}>
        {!user ? (
          <RootStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
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
