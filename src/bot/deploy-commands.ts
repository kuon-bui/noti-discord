import 'dotenv/config'
import { REST, Routes } from 'discord.js'
import { loadConfig } from '../config.js'
import { makeLogger } from '../shared/logger.js'
import { allCommands } from './commands/index.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = makeLogger(config.logLevel)
  const body = allCommands().map((command) => command.data.toJSON())
  const rest = new REST().setToken(config.discordToken)

  logger.info(`Đang đăng ký ${body.length} slash command vào guild ${config.guildId}`)
  await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.guildId), { body })
  logger.info('Đăng ký xong. Lệnh có hiệu lực ngay trong guild.')
}

main().catch((error) => {
  console.error('Đăng ký slash command thất bại:', error)
  process.exit(1)
})
