import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import LoginScreen from '../screens/LoginScreen';
import UtakaiListScreen from '../screens/UtakaiListScreen';
import TimelineScreen from '../screens/TimelineScreen';
import ComposeScreen from '../screens/ComposeScreen';
import TankaDetailScreen from '../screens/TankaDetailScreen';
import GroupSettingsScreen from '../screens/GroupSettingsScreen';
import TayoriScreen from '../screens/TayoriScreen';
import KashuScreen from '../screens/KashuScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useAuth } from '../hooks/useAuth';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const commonHeaderStyle = {
  headerStyle: { backgroundColor: '#F5F0E8' },
  headerTintColor: '#2C2418',
  headerTitleStyle: { fontFamily: 'NotoSerifJP_400Regular', fontWeight: '300' as const, letterSpacing: 2 },
  headerShadowVisible: false,
};

function HomeTabs() {
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
        options={{ title: '便り', tabBarIcon: ({ color }) => <MaterialCommunityIcons name="bell-outline" size={22} color={color} /> }} />
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
