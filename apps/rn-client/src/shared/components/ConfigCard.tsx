import { Text, View } from 'react-native'

type ConfigCardProps = {
  readonly label: string
  readonly value: string
  readonly caption: string
}

export function ConfigCard({ label, value, caption }: ConfigCardProps) {
  return (
    <View
      style={{
        gap: 8,
        borderRadius: 20,
        backgroundColor: '#ffffff',
        padding: 18,
      }}
    >
      <Text style={{ color: '#857b71', fontSize: 12, fontWeight: '700' }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ color: '#16130f', fontSize: 18, fontWeight: '700' }}>
        {value}
      </Text>
      <Text style={{ color: '#5f564c', fontSize: 14, lineHeight: 20 }}>
        {caption}
      </Text>
    </View>
  )
}
