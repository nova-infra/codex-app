import { Text, View } from 'react-native'

import { ScreenShell } from '@/src/shared/components/ScreenShell'
import { ConfigCard } from '@/src/shared/components/ConfigCard'
import { createClientBootConfig } from '@/src/shared/config/clientBootConfig'

export function HomeScreen() {
  const config = createClientBootConfig()

  return (
    <ScreenShell
      eyebrow="Codex App"
      title="RN client scaffold"
      description="Expo 客户端骨架已经就位，下一步可以接入会话列表、消息流和 WebSocket 连接。"
    >
      <ConfigCard
        label="Server URL"
        value={config.serverUrl}
        caption="通过 EXPO_PUBLIC_CODEX_SERVER_URL 覆盖默认连接地址。"
      />
      <ConfigCard
        label="Transport"
        value={config.transport}
        caption={`重连间隔 ${config.reconnectIntervalMs}ms`}
      />
      <View
        style={{
          borderRadius: 20,
          backgroundColor: '#1b312c',
          padding: 20,
          gap: 8,
        }}
      >
        <Text
          style={{
            color: '#f7f1e6',
            fontSize: 18,
            fontWeight: '700',
          }}
        >
          下一步
        </Text>
        <Text style={{ color: '#d9d0c0', fontSize: 14, lineHeight: 20 }}>
          先做连接状态、会话列表和发送输入，再决定哪些能力直接复用
          `@codex-app/core`，哪些留在移动端适配层。
        </Text>
      </View>
    </ScreenShell>
  )
}
