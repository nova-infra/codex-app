export type CapabilityKey =
  | 'skills'
  | 'tools'
  | 'mcp'
  | 'provider-profiles'
  | 'storage-adapter'
  | 'image-relay'
  | 'notification-adapter'

export type CapabilityMeta = {
  readonly key: CapabilityKey
  readonly label: string
  readonly description: string
  readonly defaultEnabled: boolean
}

const CAPABILITIES: readonly CapabilityMeta[] = [
  { key: 'skills', label: 'Skills', description: 'Skill registry for Codex runtime capabilities.', defaultEnabled: true },
  { key: 'tools', label: 'Tools', description: 'Tool registry and execution capabilities.', defaultEnabled: true },
  { key: 'mcp', label: 'MCP', description: 'MCP registry and routing.', defaultEnabled: true },
  { key: 'provider-profiles', label: 'Provider Profiles', description: 'Provider and model profile registry.', defaultEnabled: true },
  { key: 'storage-adapter', label: 'Storage Adapter', description: 'Persisted state adapter for sessions and bindings.', defaultEnabled: true },
  { key: 'image-relay', label: 'Image Relay', description: 'Generated image relay for channels that need media forwarding.', defaultEnabled: true },
  { key: 'notification-adapter', label: 'Notification Adapter', description: 'Notification formatting and delivery helpers.', defaultEnabled: true },
] as const

export function listCapabilities(): readonly CapabilityMeta[] {
  return CAPABILITIES
}

export function getCapability(key: string): CapabilityMeta | null {
  return CAPABILITIES.find(capability => capability.key === key) ?? null
}
