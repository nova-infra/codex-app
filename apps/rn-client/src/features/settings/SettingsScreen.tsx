import { Text, View } from 'react-native'

import { ScreenShell } from '@/src/shared/components/ScreenShell'
import { createClientBootConfig } from '@/src/shared/config/clientBootConfig'

export function SettingsScreen() {
  const config = createClientBootConfig()

  return (
    <ScreenShell
      eyebrow="Connection"
      title="Client settings"
      description="这里先放最基础的连接配置展示，后续再补充环境切换、账号绑定和调试工具。"
    >
      <View
        style={{
          gap: 10,
          borderRadius: 20,
          backgroundColor: '#efe5d4',
          padding: 20,
        }}
      >
        <Text style={{ color: '#5f564c', fontSize: 12, fontWeight: '700' }}>
          CURRENT TARGET
        </Text>
        <Text style={{ color: '#1b1611', fontSize: 20, fontWeight: '700' }}>
          {config.serverUrl}
        </Text>
        <Text style={{ color: '#5f564c', fontSize: 14, lineHeight: 20 }}>
          Expo 端建议优先只消费服务端公开的 WebSocket 协议，不把 Bun 或文件系统相关逻辑带进客户端。
        </Text>
      </View>
    </ScreenShell>
  )
}
