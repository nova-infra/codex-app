import { Tabs } from 'expo-router'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#17594a',
        tabBarInactiveTintColor: '#82786d',
        tabBarStyle: {
          backgroundColor: '#fcf8f2',
          borderTopWidth: 0,
          height: 76,
          paddingTop: 10,
          paddingBottom: 12,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '会话',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
        }}
      />
    </Tabs>
  )
}
