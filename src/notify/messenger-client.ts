import type { Logger } from '../shared/logger.js'

export class MessengerApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
    readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'MessengerApiError'
  }
}

/**
 * Lỗi "ngoài cửa sổ nhắn tin" của Meta: code 10, hoặc subcode 2018278.
 * Chỉ đúng hai mã này — coi mọi lỗi là hết cửa sổ sẽ khiến token sai âm thầm
 * bơm đầy outbox thay vì báo lỗi.
 */
export function isOutsideWindowError(error: unknown): boolean {
  if (!(error instanceof MessengerApiError)) return false
  return error.code === 10 || error.subcode === 2_018_278
}

export type MessengerClient = {
  sendText(psid: string, text: string): Promise<void>
  sendTyping(psid: string): Promise<void>
}

export type MessengerClientDeps = {
  pageAccessToken: string
  apiVersion: string
  fetchImpl?: typeof fetch
  logger: Logger
}

type MetaErrorBody = {
  error?: { code?: number; error_subcode?: number; message?: string }
}

export function makeMessengerClient(deps: MessengerClientDeps): MessengerClient {
  const doFetch = deps.fetchImpl ?? fetch
  const url = `https://graph.facebook.com/${deps.apiVersion}/me/messages`

  async function post(body: unknown): Promise<void> {
    const response = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${deps.pageAccessToken}`,
      },
      body: JSON.stringify(body),
    })

    if (response.ok) return

    const raw = await response.text().catch(() => '')
    let code: number | undefined
    let subcode: number | undefined
    let detail = raw

    try {
      const parsed = JSON.parse(raw) as MetaErrorBody
      code = parsed.error?.code
      subcode = parsed.error?.error_subcode
      detail = parsed.error?.message ?? raw
    } catch {
      // Body không phải JSON — giữ nguyên raw làm ngữ cảnh.
    }

    throw new MessengerApiError(
      `Send API trả ${response.status}: ${detail}`,
      code,
      subcode,
      response.status,
    )
  }

  return {
    async sendText(psid, text) {
      await post({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } })
    },

    async sendTyping(psid) {
      await post({ recipient: { id: psid }, sender_action: 'typing_on' })
    },
  }
}
