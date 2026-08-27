import type { Logger } from '../shared/logger.js'
import { EPHEMERAL, type Command, type CommandContext, type InteractionLike } from './types.js'

export type RouterDeps = {
  commands: readonly Command[]
  ctx: CommandContext
  isAdmin: (userId: string) => boolean
  logger: Logger
}

export type Router = {
  handle(interaction: InteractionLike): Promise<void>
}

export function makeRouter(deps: RouterDeps): Router {
  const byName = new Map(deps.commands.map((command) => [command.name, command]))
  const runningCommandsByUser = new Map<string, Set<string>>()

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

      if (command.adminOnly && !deps.isAdmin(interaction.user.id)) {
        await replySafe(interaction, 'Bạn không có quyền dùng lệnh này.')
        return
      }

      const runningCommands = runningCommandsByUser.get(interaction.user.id)
      if (runningCommands?.has(command.name)) {
        await replySafe(
          interaction,
          'Lệnh này của bạn đang được xử lý. Vui lòng đợi hoàn tất trước khi gửi lại.',
        )
        return
      }

      const userCommands = runningCommands ?? new Set<string>()
      userCommands.add(command.name)
      runningCommandsByUser.set(interaction.user.id, userCommands)

      try {
        await command.execute(deps.ctx, interaction)
      } catch (error) {
        deps.logger.error(`Lệnh /${command.name} thất bại`, error)
        await replySafe(interaction, 'Đã có lỗi khi chạy lệnh này. Xem log của bot để biết chi tiết.')
      } finally {
        userCommands.delete(command.name)
        if (userCommands.size === 0) {
          runningCommandsByUser.delete(interaction.user.id)
        }
      }
    },
  }
}
