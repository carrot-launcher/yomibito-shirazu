import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Text } from 'react-native';

import { useAuth } from '../hooks/useAuth';
import { useTayoriUnread } from '../hooks/useTayoriUnread';
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

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const HeaderTitle = ({ children }: { children: string }) => (
  <Text style={{ fontFamily: 'NotoSerifJP_400Regular', fontWeight: '300', fontSize: 22, letterSpacing: 2, color: '#2C2418', includeFontPadding: false, textAlignVertical: 'center' }}>
    {children}
  </Text>
);

const commonHeaderStyle = {
  headerStyle: { backgroundColor: '#F5F0E8' },
  headerTintColor: '#2C2418',
  headerTitle: (props: any) => <HeaderTitle>{props.children}</HeaderTitle>,
  headerShadowVisible: false,
};

function HomeTabs() {
  const unread = useTayoriUnread();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: '#F5F0E8', borderTopColor: '#E8E0D0' },
        tabBarLabelStyle: { fontFamily: 'NotoSerifJP_400Regular' },
        tabBarActiveTintColor: '#2C2418',
        tabBarInactiveTintColor: '#A69880',
        ...commonHeaderStyle,
      }}
    >
      <Tab.Screen name="UtakaiTab" component={UtakaiListScreen}
        options={{ title: '歌会', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="book-open-variant" size={22} color={color} /> }} />
      <Tab.Screen name="TayoriTab" component={TayoriScreen}
        options={{ title: 'たより', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="email-outline" size={22} color={color} />, tabBarBadge: unread > 0 ? unread : undefined, tabBarBadgeStyle: { backgroundColor: '#C53030', fontSize: 11 } }} />
      <Tab.Screen name="KashuTab" component={KashuScreen}
        options={{ title: '歌集', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="notebook-outline" size={22} color={color} /> }} />
      <Tab.Screen name="SettingsTab" component={SettingsScreen}
        options={{ title: '設定', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="cog-outline" size={22} color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={commonHeaderStyle}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Main" component={HomeTabs} options={{ headerShown: false }} />
            <Stack.Screen name="Timeline" component={TimelineScreen}
              options={({ route }: any) => ({ title: route.params?.groupName || 'タイムライン' })} />
            <Stack.Screen name="Compose" component={ComposeScreen} options={{ title: '詠む', presentation: 'modal' }} />
            <Stack.Screen name="TankaDetail" component={TankaDetailScreen} options={{ title: '' }} />
            <Stack.Screen name="GroupSettings" component={GroupSettingsScreen} options={{ title: '歌会設定' }} />
            <Stack.Screen name="Screenshot" component={ScreenshotScreen} options={{ title: '', presentation: 'modal' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
