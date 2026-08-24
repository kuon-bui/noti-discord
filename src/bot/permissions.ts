import type { AppConfig } from '../config.js'

export function isAdmin(userId: string, config: Pick<AppConfig, 'adminUserIds'>): boolean {
  return config.adminUserIds.includes(userId)
}
