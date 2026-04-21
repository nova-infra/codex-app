import {
  findBinding,
  listBindings,
  saveBinding,
  updateBinding,
  type ChannelBinding,
  type ChannelType,
} from '@/store/bindingStore'
import { SessionStore, type SessionMeta } from '@/session/sessionStore'

export type SessionStorageAdapter = {
  save(meta: SessionMeta): Promise<void>
  findByUser(userId: string): Promise<readonly SessionMeta[]>
  findByProject(userId: string, projectDir: string): Promise<readonly SessionMeta[]>
  findLatest(userId: string, projectDir: string): Promise<SessionMeta | null>
  findById(sessionId: string): Promise<SessionMeta | null>
  updateLastActive(sessionId: string): Promise<void>
  remove(sessionId: string): Promise<void>
  incrementTurn(sessionId: string, tokensUsed?: number): Promise<void>
}

export type BindingStorageAdapter = {
  find(type: ChannelType, externalId: string): Promise<ChannelBinding | null>
  save(binding: ChannelBinding): Promise<void>
  update(
    type: ChannelType,
    externalId: string,
    patch: Partial<Omit<ChannelBinding, 'type' | 'externalId'>>,
  ): Promise<void>
  list(type?: ChannelType): Promise<readonly ChannelBinding[]>
}

export class JsonSessionStorageAdapter implements SessionStorageAdapter {
  private readonly store = new SessionStore()

  save(meta: SessionMeta): Promise<void> {
    return this.store.save(meta)
  }

  findByUser(userId: string): Promise<readonly SessionMeta[]> {
    return this.store.findByUser(userId)
  }

  findByProject(userId: string, projectDir: string): Promise<readonly SessionMeta[]> {
    return this.store.findByProject(userId, projectDir)
  }

  findLatest(userId: string, projectDir: string): Promise<SessionMeta | null> {
    return this.store.findLatest(userId, projectDir)
  }

  findById(sessionId: string): Promise<SessionMeta | null> {
    return this.store.findById(sessionId)
  }

  updateLastActive(sessionId: string): Promise<void> {
    return this.store.updateLastActive(sessionId)
  }

  remove(sessionId: string): Promise<void> {
    return this.store.remove(sessionId)
  }

  incrementTurn(sessionId: string, tokensUsed?: number): Promise<void> {
    return this.store.incrementTurn(sessionId, tokensUsed)
  }
}

export class JsonBindingStorageAdapter implements BindingStorageAdapter {
  find(type: ChannelType, externalId: string): Promise<ChannelBinding | null> {
    return findBinding(type, externalId)
  }

  save(binding: ChannelBinding): Promise<void> {
    return saveBinding(binding)
  }

  update(
    type: ChannelType,
    externalId: string,
    patch: Partial<Omit<ChannelBinding, 'type' | 'externalId'>>,
  ): Promise<void> {
    return updateBinding(type, externalId, patch)
  }

  list(type?: ChannelType): Promise<readonly ChannelBinding[]> {
    return listBindings(type)
  }
}
