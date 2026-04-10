import type { PropsWithChildren } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type ScreenShellProps = PropsWithChildren<{
  readonly eyebrow: string
  readonly title: string
  readonly description: string
}>

export function ScreenShell({
  children,
  eyebrow,
  title,
  description,
}: ScreenShellProps) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f3ee' }}>
      <ScrollView
        contentContainerStyle={{
          gap: 18,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 32,
        }}
      >
        <View
          style={{
            gap: 10,
            borderRadius: 28,
            backgroundColor: '#d7ebdf',
            padding: 22,
          }}
        >
          <Text style={{ color: '#17594a', fontSize: 12, fontWeight: '700' }}>
            {eyebrow.toUpperCase()}
          </Text>
          <Text style={{ color: '#10211c', fontSize: 30, fontWeight: '800' }}>
            {title}
          </Text>
          <Text style={{ color: '#37534b', fontSize: 15, lineHeight: 22 }}>
            {description}
          </Text>
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}
