import type { AppConfig } from '../config.js'
import type { Logger } from '../shared/logger.js'
import { isAdmin } from './permissions.js'
import { EPHEMERAL, type Command, type CommandContext, type InteractionLike } from './types.js'

export type RouterDeps = {
  commands: readonly Command[]
  ctx: CommandContext
  config: Pick<AppConfig, 'adminUserIds'>
  logger: Logger
}

export type Router = {
  handle(interaction: InteractionLike): Promise<void>
}

export function makeRouter(deps: RouterDeps): Router {
  const byName = new Map(deps.commands.map((command) => [command.name, command]))

  async function replySafe(interaction: InteractionLike, content: string): Promise<void> {
    try {
      await interaction.reply({ content, flags: EPHEMERAL })
    } catch (error) {
      deps.logger.warn('Không trả lời được interaction', error)
    }
  }

  return {
    async handle(interaction) {
      const command = byName.get(interaction.commandName)

      if (!command) {
        deps.logger.warn(`Không nhận ra lệnh "${interaction.commandName}"`)
        await replySafe(interaction, `Không nhận ra lệnh \`/${interaction.commandName}\`.`)
        return
      }

      if (command.adminOnly && !isAdmin(interaction.user.id, deps.config)) {
        await replySafe(interaction, 'Bạn không có quyền dùng lệnh này.')
        return
      }

      try {
        await command.execute(deps.ctx, interaction)
      } catch (error) {
        deps.logger.error(`Lệnh /${command.name} thất bại`, error)
        await replySafe(interaction, 'Đã có lỗi khi chạy lệnh này. Xem log của bot để biết chi tiết.')
      }
    },
  }
}
