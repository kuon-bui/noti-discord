import { addCommand } from './add.js'
import { checkCommand } from './check.js'
import { destAddCommand, destListCommand, destRemoveCommand } from './dest.js'
import { historyCommand } from './history.js'
import { listCommand } from './list.js'
import { pauseCommand, resumeCommand } from './pause.js'
import { removeCommand } from './remove.js'
import { statusCommand } from './status.js'
import type { Command } from '../types.js'
import { uptimeCommand } from './uptime.js'

export function allCommands(): Command[] {
  return [
    addCommand,
    removeCommand,
    listCommand,
    statusCommand,
    checkCommand,
    pauseCommand,
    resumeCommand,
    historyCommand,
    uptimeCommand,
    destListCommand,
    destAddCommand,
    destRemoveCommand,
  ]
}
