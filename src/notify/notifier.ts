import type { AlertMessage } from '../shared/types.js'

export type Notifier = {
  send(msg: AlertMessage, channelId: string): Promise<void>
}
