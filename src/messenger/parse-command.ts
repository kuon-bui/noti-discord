import type { Command } from '../bot/types.js'

export const OPTION_TYPE = { STRING: 3, INTEGER: 4, CHANNEL: 7 } as const

type OptionSpec = { name: string; type: number; required?: boolean }
type CommandJson = { name: string; description?: string; options?: OptionSpec[] }

export type ParseResult =
  | {
      ok: true
      commandName: string
      strings: Map<string, string>
      integers: Map<string, number>
    }
  | { ok: false; kind: 'unknown-command' | 'bad-argument'; message: string }

const NAMED_RE = /^([a-zA-Z][a-zA-Z0-9_-]*)=(.*)$/

function specsOf(command: Command): OptionSpec[] {
  return ((command.data.toJSON() as CommandJson).options ?? []).map((spec) => ({
    name: spec.name,
    type: spec.type,
    required: spec.required === true,
  }))
}

export function parseCommandText(text: string, commands: readonly Command[]): ParseResult {
  const tokens = text
    .trim()
    .replace(/^\//, '')
    .split(/\s+/)
    .filter((token) => token.length > 0)

  const head = tokens.shift()
  if (head === undefined) {
    return { ok: false, kind: 'unknown-command', message: 'Chưa có lệnh nào.' }
  }

  const commandName = head.toLowerCase()
  const command = commands.find((candidate) => candidate.name === commandName)
  if (!command) {
    return {
      ok: false,
      kind: 'unknown-command',
      message: `Không nhận ra lệnh \`${commandName}\`.`,
    }
  }

  const specs = specsOf(command)

  const named = new Map<string, string>()
  const positional: string[] = []
  for (const token of tokens) {
    const match = NAMED_RE.exec(token)
    const key = match?.[1]?.toLowerCase()
    if (key !== undefined && specs.some((spec) => spec.name === key)) {
      named.set(key, match?.[2] ?? '')
    } else {
      positional.push(token)
    }
  }

  const slots = specs.filter(
    (spec) => spec.type !== OPTION_TYPE.CHANNEL && !named.has(spec.name),
  )
  if (positional.length > slots.length) {
    return {
      ok: false,
      kind: 'bad-argument',
      message: `Lệnh \`${commandName}\` nhận tối đa ${slots.length} tham số vị trí, nhận được ${positional.length}.`,
    }
  }

  const raw = new Map(named)
  slots.forEach((spec, index) => {
    const value = positional[index]
    if (value !== undefined) raw.set(spec.name, value)
  })

  const strings = new Map<string, string>()
  const integers = new Map<string, number>()

  for (const spec of specs) {
    const value = raw.get(spec.name)
    if (value === undefined) {
      if (spec.required) {
        return {
          ok: false,
          kind: 'bad-argument',
          message: `\`${spec.name}\` là bắt buộc cho lệnh \`${commandName}\`.`,
        }
      }
      continue
    }

    if (spec.type === OPTION_TYPE.INTEGER) {
      if (!/^-?\d+$/.test(value)) {
        return {
          ok: false,
          kind: 'bad-argument',
          message: `\`${spec.name}\` phải là số nguyên, nhận được \`${value}\`.`,
        }
      }
      integers.set(spec.name, Number(value))
      continue
    }

    if (spec.type === OPTION_TYPE.STRING) {
      strings.set(spec.name, value)
    }
  }

  return { ok: true, commandName, strings, integers }
}

export function helpText(commands: readonly Command[], isAdmin: boolean): string {
  const usable = commands.filter((command) => isAdmin || !command.adminOnly)
  const lines = usable.map((command) => {
    const args = specsOf(command)
      .filter((spec) => spec.type !== OPTION_TYPE.CHANNEL)
      .map((spec) => (spec.required ? `<${spec.name}>` : `[${spec.name}]`))
      .join(' ')
    return args.length > 0 ? `• ${command.name} ${args}` : `• ${command.name}`
  })
  return ['Lệnh dùng được:', ...lines].join('\n')
}
