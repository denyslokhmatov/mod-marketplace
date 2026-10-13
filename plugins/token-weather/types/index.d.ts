export type Reading = { tokens: number; window: number }
export type Cache = { reused: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    'token-weather': { history: Reading[]; cache: Cache | null; tick: number; ttl: number }
  }
}
