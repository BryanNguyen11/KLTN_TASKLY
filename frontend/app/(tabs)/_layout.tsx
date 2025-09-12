import { Tabs } from 'expo-router';
import React from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';

// Hide bottom tab bar completely (still uses Tabs for routing structure)
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
        tabBarItemStyle: { display: 'none' },
        tabBarShowLabel: false,
        lazy: true,
      }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          // still need an icon component to avoid warnings
          tabBarIcon: ({ color }) => <IconSymbol size={1} name="square" color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={1} name="square" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color }) => <IconSymbol size={1} name="square" color={color} />,
        }}
      />
    </Tabs>
  );
}
