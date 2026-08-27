import type { AlertMessage } from '../shared/types.js'

export type ProviderName = 'discord' | 'messenger'

export const PROVIDER_NAMES: readonly ProviderName[] = ['discord', 'messenger']

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value)
}

export type Destination = { provider: ProviderName; address: string }

export type Notifier = {
  readonly provider: ProviderName
  send(msg: AlertMessage, address: string): Promise<void>
}

export type Dispatcher = {
  dispatch(msg: AlertMessage, dests: readonly Destination[]): Promise<void>
}
