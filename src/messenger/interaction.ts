import type { InteractionLike, InteractionReply } from '../bot/types.js'
import {
  embedToText,
  splitForMessenger,
  stripMarkdown,
  type EmbedLike,
} from '../notify/messenger-text.js'

export type MessengerInteractionDeps = {
  commandName: string
  psid: string
  strings: ReadonlyMap<string, string>
  integers: ReadonlyMap<string, number>
  send(texts: readonly string[]): Promise<void>
  typing(): Promise<void>
}

function toEmbedLike(embed: unknown): EmbedLike {
  const candidate = embed as { toJSON?: () => unknown }
  const json = typeof candidate?.toJSON === 'function' ? candidate.toJSON() : embed
  const shaped = (json ?? {}) as EmbedLike
  return { title: shaped.title, description: shaped.description, fields: shaped.fields }
}

function payloadToTexts(payload: InteractionReply): string[] {
  const texts: string[] = []
  if (payload.content) {
    texts.push(...splitForMessenger(stripMarkdown(payload.content)))
  }
  for (const embed of payload.embeds ?? []) {
    texts.push(...embedToText(toEmbedLike(embed)))
  }
  return texts.filter((text) => text.length > 0)
}

export function makeMessengerInteraction(deps: MessengerInteractionDeps): InteractionLike {
  async function emit(payload: InteractionReply): Promise<void> {
    const texts = payloadToTexts(payload)
    if (texts.length > 0) await deps.send(texts)
  }

  return {
    commandName: deps.commandName,
    user: { id: deps.psid },
    options: {
      getString: (name) => deps.strings.get(name) ?? null,
      getInteger: (name) => deps.integers.get(name) ?? null,
      getChannel: () => null,
    },
    async reply(payload) {
      await emit(payload)
      return {}
    },
    async followUp(payload) {
      await emit(payload)
      return {}
    },
    async deferReply() {
      await deps.typing()
      return {}
    },
    async editReply(payload) {
      await emit(payload)
      return {}
    },
  }
}
