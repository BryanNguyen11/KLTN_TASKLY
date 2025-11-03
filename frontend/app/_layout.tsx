import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import React from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';

export const unstable_settings = { anchor: '(tabs)' };

// Show notifications even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex:1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <NotificationProvider>
          {/* Force light mode only */}
          <ThemeProvider value={DefaultTheme}>
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
                gestureEnabled: true,
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="auth/login" />
              <Stack.Screen name="auth/register" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="create-task" options={{ headerShown:false, animation:'slide_from_right' }} />
              <Stack.Screen name="create-calendar" options={{ headerShown:false, animation:'slide_from_right' }} />
              <Stack.Screen name="create-project" options={{ headerShown:false, animation:'slide_from_right' }} />
              <Stack.Screen name="project-settings/[id]" options={{ headerShown:false, animation:'slide_from_right' }} />
              <Stack.Screen name="search" options={{ headerShown:false, animation:'slide_from_right' }} />
              <Stack.Screen name="notifications" options={{ headerShown:false, animation:'slide_from_right' }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
            </Stack>
            <StatusBar style="dark" />
          </ThemeProvider>
          </NotificationProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
