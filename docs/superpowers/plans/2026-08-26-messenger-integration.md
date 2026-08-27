# Tích hợp Facebook Messenger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách tầng thông báo thành kiến trúc đa provider rồi thêm Facebook Messenger làm provider thứ hai, nhận cả alert lẫn toàn bộ slash command qua tin nhắn text.

**Architecture:** Hai đường nối. Outbound: `Notifier.send(msg, address)` cộng `Dispatcher` fan-out ra nhiều destination, mỗi destination lỗi độc lập. Inbound: `InteractionLike` đã là structural type không dính discord.js, nên một adapter Messenger tái dùng cả 9 command handler mà không sửa file lệnh nào. Định tuyến chuyển từ cột `targets.alert_channel_id` sang bảng `destinations` đa hình.

**Tech Stack:** Bun >= 1.3, TypeScript, drizzle-orm + `bun:sqlite`, discord.js v14, Elysia (mới), zod, `bun test`.

**Spec:** `docs/superpowers/specs/2026-08-26-messenger-integration-design.md`

## Global Constraints

- Runtime là Bun >= 1.3. Không dùng `Date.now()` trực tiếp trong code nghiệp vụ — mọi thời gian đi qua `Clock = () => Date` đã có.
- Mọi thời gian lưu DB là chuỗi ISO 8601 UTC (`toISOString()`).
- Mọi text hướng tới người dùng viết bằng tiếng Việt, khớp giọng các file hiện có.
- Migration là **forward-only**, không có `down`. Sinh bằng `bun run db:generate` (DDL) hoặc `bun run db:data <tên>` (DML). **Phải đọc file SQL sinh ra** rồi commit cùng thay đổi `schema.ts`.
- Không dùng `drizzle-kit push`. Không chạy drizzle-kit bằng `bunx --bun` (Bun panic vì `better-sqlite3` là NAPI).
- `MESSENGER_ENABLED=false` là mặc định. Khi tắt: **không dựng Elysia app, không mở port**, app chạy y hệt trước.
- Dependency injection qua tham số `deps`/`context`, theo đúng khuôn `makeX(deps)` đang dùng khắp `src/`.
- Cửa sổ nhắn tin Messenger: biên an toàn **23 giờ** (không phải 24) kể từ `last_inbound_at`.
- `MESSENGER_OUTBOX_MAX_AGE_HOURS` mặc định **48**. Gộp outbox khi còn **> 3** entry.
- Giới hạn ký tự một tin Messenger: **2000**.
- Không dùng tag `HUMAN_AGENT`, One-Time Notification, Marketing Messages, hay Sponsored Messages.
- Hành vi Discord hiện tại **không được đổi một ly**, kể cả từng ký tự của bảng digest.

## File Structure

**Phase 1 — refactor đa provider (chỉ Discord, hành vi không đổi)**

| File | Trách nhiệm |
|---|---|
| `src/notify/notifier.ts` (sửa) | Khai `ProviderName`, `Destination`, `Notifier`, `Dispatcher` |
| `src/notify/dispatcher.ts` (mới) | `makeDispatcher` — fan-out, cô lập lỗi từng destination |
| `src/notify/discord-notifier.ts` (sửa) | Thêm `provider: 'discord'` |
| `src/shared/types.ts` (sửa) | `AlertMessage` nhận `table?` và `targetName?`; `Target` bỏ `alertChannelId` |
| `src/notify/messages.ts` (sửa) | `digestMessage` trả `table` có cấu trúc thay vì chuỗi đã pad |
| `src/notify/embeds.ts` (sửa) | Nhận trách nhiệm pad cột và bọc code block |
| `src/db/schema.ts` (sửa) | Bảng `destinations`; bỏ cột `targets.alert_channel_id` |
| `src/db/destinations.repo.ts` (mới) | CRUD destinations, chống trùng row global |
| `src/notify/routing.ts` (mới) | `destinationsFor(targetId)`, `digestDestinations()` |
| `src/bot/commands/dest.ts` (mới) | `/dest list|add|remove` |
| `tests/helpers/context.ts` (mới) | `makeTestContext` — một chỗ duy nhất dựng `CommandContext` |

**Phase 2 — provider Messenger**

| File | Trách nhiệm |
|---|---|
| `src/config.ts` (sửa) | Nhóm `messenger: MessengerConfig \| null` |
| `src/notify/messenger-text.ts` (mới) | Strip markdown, cắt 2000, render `table` và APIEmbed thành text |
| `src/db/messenger.repo.ts` (mới) | Identities, link codes, seen mids |
| `src/db/outbox.repo.ts` (mới) | Enqueue / list / delete outbox |
| `src/notify/messenger-client.ts` (mới) | Send API + `sender_action`, `MessengerApiError` |
| `src/notify/messenger-notifier.ts` (mới) | Chính sách cửa sổ 23h, enqueue outbox |
| `src/notify/messenger-flush.ts` (mới) | Flush outbox, gộp khi > 3 |
| `src/web/signature.ts` (mới) | HMAC-SHA256 trên raw bytes, timing-safe |
| `src/messenger/parse-command.ts` (mới) | Text → options, schema lấy từ `data.toJSON()` |
| `src/messenger/interaction.ts` (mới) | Adapter `InteractionLike` |
| `src/messenger/handle-event.ts` (mới) | Lọc echo, dedupe mid, link code, định tuyến lệnh |
| `src/web/messenger-webhook.ts` (mới) | Plugin Elysia: GET verify, POST nhận event |
| `src/web/server.ts` (mới) | Dựng app Elysia, `/healthz`, listen |
| `src/bot/router.ts` (sửa) | `isAdmin` thành hàm inject, không còn đọc `adminUserIds` |
| `src/bot/commands/messenger.ts` (mới) | `/messenger-link`, `/messenger-unlink` |
| `src/index.ts` (sửa) | Lắp dispatcher, hai router, Elysia server, shutdown |

---

# PHASE 1 — Refactor đa provider

Kết thúc Phase 1, app vẫn **chỉ có Discord** nhưng đã đứng trên kiến trúc đa provider, và
toàn bộ test hiện có phải xanh với hành vi Discord không đổi. Không viết dòng code
Messenger nào trước khi Phase 1 gate (Task 10) xanh.

---

### Task 1: `Dispatcher` fan-out nhiều provider

**Files:**
- Modify: `src/notify/notifier.ts`
- Modify: `src/notify/discord-notifier.ts:38-44`
- Create: `src/notify/dispatcher.ts`
- Test: `tests/notify/dispatcher.test.ts`

**Interfaces:**
- Consumes: `AlertMessage` từ `src/shared/types.ts`, `Logger` từ `src/shared/logger.ts`
- Produces: `type ProviderName = 'discord' | 'messenger'`; `type Destination = { provider: ProviderName; address: string }`; `type Notifier = { readonly provider: ProviderName; send(msg: AlertMessage, address: string): Promise<void> }`; `type Dispatcher = { dispatch(msg: AlertMessage, dests: readonly Destination[]): Promise<void> }`; `makeDispatcher(deps: { notifiers: readonly Notifier[]; logger: Logger }): Dispatcher`

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/notify/dispatcher.test.ts
import { describe, expect, it } from 'bun:test'
import { makeDispatcher } from '../../src/notify/dispatcher.js'
import type { Notifier, ProviderName } from '../../src/notify/notifier.js'
import { silentLogger, type Logger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

const MSG: AlertMessage = {
  kind: 'down',
  title: 'x',
  description: 'y',
  color: 1,
  fields: [],
  timestampIso: '2026-08-26T00:00:00.000Z',
}

function spyNotifier(provider: ProviderName, behaviour: 'ok' | 'throw' = 'ok') {
  const calls: string[] = []
  const notifier: Notifier = {
    provider,
    async send(_msg, address) {
      calls.push(address)
      if (behaviour === 'throw') throw new Error('nổ')
    },
  }
  return { notifier, calls }
}

function collectingLogger(): { logger: Logger; warns: string[]; errors: string[] } {
  const warns: string[] = []
  const errors: string[] = []
  return {
    logger: { ...silentLogger, warn: (m) => warns.push(m), error: (m) => errors.push(m) },
    warns,
    errors,
  }
}

describe('makeDispatcher', () => {
  it('gửi mỗi destination tới notifier đúng provider', async () => {
    const discord = spyNotifier('discord')
    const messenger = spyNotifier('messenger')
    const dispatcher = makeDispatcher({
      notifiers: [discord.notifier, messenger.notifier],
      logger: silentLogger,
    })

    await dispatcher.dispatch(MSG, [
      { provider: 'discord', address: 'chan-1' },
      { provider: 'messenger', address: 'psid-9' },
    ])

    expect(discord.calls).toEqual(['chan-1'])
    expect(messenger.calls).toEqual(['psid-9'])
  })

  it('một provider lỗi không chặn provider khác và không throw ra ngoài', async () => {
    const broken = spyNotifier('messenger', 'throw')
    const healthy = spyNotifier('discord')
    const { logger, errors } = collectingLogger()
    const dispatcher = makeDispatcher({
      notifiers: [broken.notifier, healthy.notifier],
      logger,
    })

    await expect(
      dispatcher.dispatch(MSG, [
        { provider: 'messenger', address: 'psid-9' },
        { provider: 'discord', address: 'chan-1' },
      ]),
    ).resolves.toBeUndefined()

    expect(healthy.calls).toEqual(['chan-1'])
    expect(errors.some((m) => m.includes('psid-9'))).toBe(true)
  })

  it('provider không có notifier thì chỉ log warn, không throw', async () => {
    const { logger, warns } = collectingLogger()
    const dispatcher = makeDispatcher({ notifiers: [], logger })

    await expect(
      dispatcher.dispatch(MSG, [{ provider: 'messenger', address: 'psid-9' }]),
    ).resolves.toBeUndefined()

    expect(warns.some((m) => m.includes('messenger'))).toBe(true)
  })

  it('danh sách destination rỗng thì không làm gì', async () => {
    const discord = spyNotifier('discord')
    const dispatcher = makeDispatcher({ notifiers: [discord.notifier], logger: silentLogger })
    await dispatcher.dispatch(MSG, [])
    expect(discord.calls).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `bun test tests/notify/dispatcher.test.ts`
Expected: FAIL — không resolve được `../../src/notify/dispatcher.js`

- [ ] **Step 3: Mở rộng `notifier.ts`**

```ts
// src/notify/notifier.ts
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
```

- [ ] **Step 4: Viết `dispatcher.ts`**

```ts
// src/notify/dispatcher.ts
import type { Logger } from '../shared/logger.js'
import type { Destination, Dispatcher, Notifier } from './notifier.js'

export type DispatcherDeps = {
  notifiers: readonly Notifier[]
  logger: Logger
}

/**
 * Fan-out một AlertMessage ra nhiều destination. Không bao giờ throw: một provider
 * chết không được phép chặn provider khác, vì Messenger là kênh best-effort còn
 * Discord là kênh đảm bảo.
 */
export function makeDispatcher(deps: DispatcherDeps): Dispatcher {
  const byProvider = new Map(deps.notifiers.map((n) => [n.provider, n]))

  return {
    async dispatch(msg, dests) {
      await Promise.all(
        dests.map(async (dest) => {
          const notifier = byProvider.get(dest.provider)
          if (!notifier) {
            deps.logger.warn(
              `Không có notifier cho provider "${dest.provider}", bỏ qua ${dest.address}`,
            )
            return
          }
          try {
            await notifier.send(msg, dest.address)
          } catch (error) {
            deps.logger.error(`Gửi tới ${dest.provider}:${dest.address} thất bại`, error)
          }
        }),
      )
    },
  }
}
```

- [ ] **Step 5: Thêm `provider` vào Discord notifier**

Trong `src/notify/discord-notifier.ts`, đổi `return {` của `makeDiscordNotifier` thành:

```ts
  return {
    provider: 'discord',

    async send(message: AlertMessage, channelId: string): Promise<void> {
```

Phần thân `send` giữ nguyên hoàn toàn, kể cả retry-một-lần.

- [ ] **Step 6: Chạy test**

Run: `bun test tests/notify/dispatcher.test.ts tests/notify/discord-notifier.test.ts`
Expected: PASS cả hai file

- [ ] **Step 7: Typecheck rồi commit**

```bash
bun run typecheck
git add src/notify/notifier.ts src/notify/dispatcher.ts src/notify/discord-notifier.ts tests/notify/dispatcher.test.ts
git commit -m "feat: thêm Dispatcher fan-out nhiều provider"
```

---

### Task 2: `AlertMessage` nhận `table` và `targetName`

Digest hiện nhồi bảng đã pad cột vào `description`, nên Messenger không render lại được.
Chuyển việc pad sang `toEmbed`, còn `messages.ts` chỉ trả dữ liệu. **Hiển thị trên
Discord phải giống hệt từng ký tự.**

**Files:**
- Modify: `src/shared/types.ts:35-42`
- Modify: `src/notify/messages.ts:96-124`
- Modify: `src/notify/embeds.ts`
- Test: `tests/notify/messages.test.ts` (sửa), `tests/notify/embeds.test.ts` (thêm)

**Interfaces:**
- Consumes: `Destination`/`Notifier` từ Task 1 (không trực tiếp, chỉ cùng module)
- Produces: `AlertMessage.table?: { rows: string[][] }` với đúng 6 ô mỗi hàng theo thứ tự `[icon, name, uptime, latency, incidentCount, downtime]` — ô `downtime` đã bao gồm hậu tố `' (paused)'` khi target đang pause. `AlertMessage.targetName?: string` được `downMessage`/`recoveredMessage`/`manualCheckMessage` gán, `digestMessage` để trống.

- [ ] **Step 1: Sửa test digest hiện có sang assert `table`**

Trong `tests/notify/messages.test.ts`, thay ba test của `describe('digestMessage')` đang
assert `message.description` bằng:

```ts
  it('liệt kê đủ mọi target trong table', () => {
    const names = message.table?.rows.map((cells) => cells[1])
    expect(names).toContain('web-prod')
    expect(names).toContain('api')
    expect(names).toContain('staging')
  })

  it('hiển thị uptime và đánh dấu target đang pause', () => {
    const flat = (message.table?.rows ?? []).flat().join('|')
    expect(flat).toContain('99.9%')
    expect(flat).toContain('(paused)')
  })

  it('không tự format bảng vào description', () => {
    expect(message.description).toBe('')
    expect(message.table?.rows).toHaveLength(3)
  })
```

- [ ] **Step 2: Thêm test cho `toEmbed` giữ nguyên bảng đã pad**

Thêm vào `tests/notify/embeds.test.ts`:

```ts
import { digestMessage } from '../../src/notify/messages.js'
import type { DigestReport } from '../../src/shared/types.js'

describe('toEmbed với table', () => {
  const report: DigestReport = {
    rangeLabel: '24 giờ qua',
    lines: [
      {
        name: 'web-prod',
        currentStatus: 'UP',
        paused: false,
        uptimePct: 99.9,
        avgLatencyMs: 120,
        incidentCount: 1,
        downtimeMs: 65_000,
      },
    ],
  }

  it('render table thành code block với cột đã pad', () => {
    const json = toEmbed(digestMessage(report, '2026-08-26T00:00:00.000Z')).toJSON()
    // Đúng khuôn cũ: icon + name padEnd(16) + uptime padStart(14) + 2 space + ...
    expect(json.description).toBe(
      '```\n🟢 web-prod                  99.9%    120ms    1 sự cố  1m 5s\n```',
    )
  })

  it('table rỗng vẫn có câu thay thế', () => {
    const json = toEmbed(
      digestMessage({ rangeLabel: '24 giờ qua', lines: [] }, '2026-08-26T00:00:00.000Z'),
    ).toJSON()
    expect(json.description).toBe('```\nChưa có target nào được theo dõi.\n```')
  })
})
```

Chuỗi mong đợi ở test đầu **phải** lấy từ output thật của code hiện tại trước khi sửa —
chạy `bun test tests/notify/messages.test.ts` trên `main` và copy `description` ra, đừng
tự đếm khoảng trắng bằng mắt.

- [ ] **Step 3: Chạy test để xác nhận fail**

Run: `bun test tests/notify/messages.test.ts tests/notify/embeds.test.ts`
Expected: FAIL — `message.table` là `undefined`

- [ ] **Step 4: Thêm field vào `AlertMessage`**

```ts
// src/shared/types.ts — thay khối AlertMessage
export type AlertMessage = {
  kind: 'down' | 'recovered' | 'manual' | 'digest'
  title: string
  description: string
  color: number
  fields: AlertField[]
  timestampIso: string
  /** Tên target liên quan, để outbox gộp được theo target. Digest không có. */
  targetName?: string
  /** Dữ liệu bảng chưa format. Provider tự render. 6 ô: icon, name, uptime, latency, incidents, downtime. */
  table?: { rows: string[][] }
}
```

- [ ] **Step 5: `messages.ts` trả dữ liệu thay vì chuỗi đã pad**

Thêm `targetName` vào ba hàm alert — trong `downMessage` và `recoveredMessage` thêm
`targetName: target.name`, trong `manualCheckMessage` thêm `targetName: outcome.target.name`.

Thay toàn bộ `digestMessage`:

```ts
export function digestMessage(report: DigestReport, atIso: string): AlertMessage {
  const rows = report.lines.map((line) => [
    STATUS_ICON[line.currentStatus] ?? '⚪',
    line.name,
    line.uptimePct == null ? 'chưa có dữ liệu' : `${line.uptimePct}%`,
    line.avgLatencyMs == null ? '-' : `${line.avgLatencyMs}ms`,
    String(line.incidentCount),
    `${formatDuration(line.downtimeMs)}${line.paused ? ' (paused)' : ''}`,
  ])

  return {
    kind: 'digest',
    title: `📊 Báo cáo tình trạng — ${report.rangeLabel}`,
    description: '',
    color: COLOR_INFO,
    fields: [{ name: 'Số target', value: String(report.lines.length), inline: true }],
    timestampIso: atIso,
    table: { rows },
  }
}
```

- [ ] **Step 6: `embeds.ts` nhận trách nhiệm pad**

Thêm trước `toEmbed`:

```ts
const EMPTY_TABLE = 'Chưa có target nào được theo dõi.'

function digestTableText(rows: readonly string[][]): string {
  if (rows.length === 0) return EMPTY_TABLE
  return rows
    .map((cells) => {
      const [icon = '', name = '', uptime = '', latency = '', incidents = '', downtime = ''] =
        cells
      return `${icon} ${name.padEnd(16)}${uptime.padStart(14)}  ${latency.padStart(8)}  ${incidents.padStart(3)} sự cố  ${downtime}`
    })
    .join('\n')
}
```

Trong `toEmbed`, thay hai dòng đầu tính `title`/`description`:

```ts
  const tableBlock = message.table ? `\`\`\`\n${digestTableText(message.table.rows)}\n\`\`\`` : ''
  const combined = [message.description, tableBlock].filter((part) => part.length > 0).join('\n')
  const title = truncate(message.title, MAX_TITLE)
  const description = truncate(combined, MAX_DESCRIPTION)
```

Và ở khối dựng embed, đổi `.setDescription(description)` thành gọi có điều kiện:

```ts
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(message.color)
    .setTimestamp(new Date(message.timestampIso))

  if (description.length > 0) embed.setDescription(description)
```

- [ ] **Step 7: Chạy test**

Run: `bun test tests/notify/`
Expected: PASS toàn bộ. Nếu chuỗi pad lệch, sửa **test** theo output thật của `main`, không sửa công thức pad.

- [ ] **Step 8: Typecheck rồi commit**

```bash
bun run typecheck
git add src/shared/types.ts src/notify/messages.ts src/notify/embeds.ts tests/notify/messages.test.ts tests/notify/embeds.test.ts
git commit -m "refactor: AlertMessage mang table có cấu trúc, embeds lo việc pad cột"
```

---

### Task 3: Bảng `destinations` và repo

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/destinations.repo.ts`
- Create: `drizzle/NNNN_*.sql` (sinh ra)
- Test: `tests/db/destinations.repo.test.ts`

**Interfaces:**
- Consumes: `ProviderName`, `Destination` từ Task 1; `Db` từ `src/db/connection.ts`
- Produces: `type DestinationRow = { id: number; targetId: number | null; provider: ProviderName; address: string }`; `type DestinationsRepo = { add(input: { targetId: number | null; provider: ProviderName; address: string; createdAt: string }): boolean; remove(targetId: number | null, provider: ProviderName, address: string): boolean; listForTarget(targetId: number): DestinationRow[]; listGlobal(): DestinationRow[]; listByProvider(provider: ProviderName): DestinationRow[] }`; `makeDestinationsRepo(db: Db): DestinationsRepo`. `add` trả `false` khi đã tồn tại đúng bộ ba, không throw.

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/db/destinations.repo.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { makeDestinationsRepo, type DestinationsRepo } from '../../src/db/destinations.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeTargetsRepo, type TargetsRepo } from '../../src/db/targets.repo.js'

const AT = '2026-08-26T00:00:00.000Z'

describe('DestinationsRepo', () => {
  let repo: DestinationsRepo
  let targets: TargetsRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeDestinationsRepo(db)
    targets = makeTargetsRepo(db)
  })

  function target(name: string) {
    return targets.create({
      name,
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: AT,
    })
  }

  it('add rồi listForTarget trả đúng row', () => {
    const web = target('web')
    expect(repo.add({ targetId: web.id, provider: 'discord', address: 'chan-1', createdAt: AT })).toBe(true)

    const rows = repo.listForTarget(web.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.provider).toBe('discord')
    expect(rows[0]?.address).toBe('chan-1')
  })

  it('targetId null là destination toàn cục, không lẫn vào listForTarget', () => {
    const web = target('web')
    repo.add({ targetId: null, provider: 'messenger', address: 'psid-1', createdAt: AT })

    expect(repo.listForTarget(web.id)).toEqual([])
    expect(repo.listGlobal().map((r) => r.address)).toEqual(['psid-1'])
  })

  it('add trùng bộ ba trả false và không tạo row thứ hai — kể cả row toàn cục', () => {
    repo.add({ targetId: null, provider: 'messenger', address: 'psid-1', createdAt: AT })
    expect(repo.add({ targetId: null, provider: 'messenger', address: 'psid-1', createdAt: AT })).toBe(false)
    expect(repo.listGlobal()).toHaveLength(1)
  })

  it('remove trả false khi không có gì để xoá', () => {
    expect(repo.remove(null, 'discord', 'không-có')).toBe(false)
  })

  it('xoá target thì cascade xoá destination của nó', () => {
    const web = target('web')
    repo.add({ targetId: web.id, provider: 'discord', address: 'chan-1', createdAt: AT })
    targets.remove('web')
    expect(repo.listForTarget(web.id)).toEqual([])
  })

  it('listByProvider chỉ trả đúng provider', () => {
    const web = target('web')
    repo.add({ targetId: web.id, provider: 'discord', address: 'chan-1', createdAt: AT })
    repo.add({ targetId: null, provider: 'messenger', address: 'psid-1', createdAt: AT })
    expect(repo.listByProvider('messenger').map((r) => r.address)).toEqual(['psid-1'])
  })
})
```

Test "add trùng ... kể cả row toàn cục" là chốt quan trọng: SQLite coi mỗi `NULL` là
**khác nhau** trong UNIQUE constraint, nên constraint DB không chặn được trùng row global.
Việc chống trùng nằm ở tầng repo và test này là thứ giữ nó.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/db/destinations.repo.test.ts`
Expected: FAIL — không resolve được `destinations.repo.js`

- [ ] **Step 3: Thêm bảng vào `schema.ts`**

```ts
// src/db/schema.ts — thêm sau khối targets, dùng thêm uniqueIndex trong import
export const destinations = sqliteTable(
  'destinations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    targetId: integer('target_id').references(() => targets.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    address: text('address').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_destinations_target').on(t.targetId, t.provider),
    // Chỉ chặn được trùng khi target_id NOT NULL — SQLite coi các NULL là khác nhau.
    // Row toàn cục được chống trùng ở tầng repo.
    uniqueIndex('idx_destinations_unique').on(t.targetId, t.provider, t.address),
  ],
)
```

Đổi dòng import đầu file thành:

```ts
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
```

- [ ] **Step 4: Sinh migration và đọc nó**

```bash
bun run db:generate
```

Mở file `drizzle/NNNN_*.sql` vừa sinh, xác nhận nó `CREATE TABLE destinations` với
`REFERENCES targets(id) ON DELETE cascade` và hai index. Không sửa tay file đó.

- [ ] **Step 5: Viết repo**

```ts
// src/db/destinations.repo.ts
import type { Changes } from 'bun:sqlite'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ProviderName } from '../notify/notifier.js'
import type { Db } from './connection.js'
import { destinations } from './schema.js'

export type DestinationRow = {
  id: number
  targetId: number | null
  provider: ProviderName
  address: string
}

export type AddDestinationInput = {
  targetId: number | null
  provider: ProviderName
  address: string
  createdAt: string
}

export type DestinationsRepo = {
  /** Trả false nếu bộ ba (targetId, provider, address) đã tồn tại. */
  add(input: AddDestinationInput): boolean
  remove(targetId: number | null, provider: ProviderName, address: string): boolean
  listForTarget(targetId: number): DestinationRow[]
  listGlobal(): DestinationRow[]
  listByProvider(provider: ProviderName): DestinationRow[]
}

type Row = typeof destinations.$inferSelect

function toRow(row: Row): DestinationRow {
  return {
    id: row.id,
    targetId: row.targetId,
    provider: row.provider as ProviderName,
    address: row.address,
  }
}

function matches(targetId: number | null, provider: ProviderName, address: string) {
  return and(
    targetId === null ? isNull(destinations.targetId) : eq(destinations.targetId, targetId),
    eq(destinations.provider, provider),
    eq(destinations.address, address),
  )
}

export function makeDestinationsRepo(db: Db): DestinationsRepo {
  return {
    add(input) {
      const existing = db
        .select()
        .from(destinations)
        .where(matches(input.targetId, input.provider, input.address))
        .get()
      if (existing) return false

      db.insert(destinations)
        .values({
          targetId: input.targetId,
          provider: input.provider,
          address: input.address,
          createdAt: input.createdAt,
        })
        .run()
      return true
    },

    remove(targetId, provider, address) {
      const result = db
        .delete(destinations)
        .where(matches(targetId, provider, address))
        .run() as unknown as Changes
      return result.changes > 0
    },

    listForTarget(targetId) {
      return db
        .select()
        .from(destinations)
        .where(eq(destinations.targetId, targetId))
        .orderBy(asc(destinations.id))
        .all()
        .map(toRow)
    },

    listGlobal() {
      return db
        .select()
        .from(destinations)
        .where(isNull(destinations.targetId))
        .orderBy(asc(destinations.id))
        .all()
        .map(toRow)
    },

    listByProvider(provider) {
      return db
        .select()
        .from(destinations)
        .where(eq(destinations.provider, provider))
        .orderBy(asc(destinations.id))
        .all()
        .map(toRow)
    },
  }
}
```

- [ ] **Step 6: Chạy test**

Run: `bun test tests/db/destinations.repo.test.ts && bun run db:drift`
Expected: PASS, và drift báo schema khớp

- [ ] **Step 7: Typecheck rồi commit**

```bash
bun run typecheck
git add src/db/schema.ts src/db/destinations.repo.ts drizzle/ tests/db/destinations.repo.test.ts
git commit -m "feat: bảng destinations đa provider và repo của nó"
```

---

### Task 4: Quy tắc phân giải destination

Chỗ dễ làm sai nhất của cả plan: fallback là **theo từng provider**, không phải fallback
toàn bộ. Override channel Discord của một target không được làm im Messenger.

**Files:**
- Create: `src/notify/routing.ts`
- Test: `tests/notify/routing.test.ts`

**Interfaces:**
- Consumes: `DestinationsRepo` từ Task 3; `Destination` từ Task 1; `AppConfig` từ `src/config.ts`
- Produces: `type Routing = { destinationsFor(targetId: number): Destination[]; digestDestinations(): Destination[] }`; `makeRouting(deps: { destinations: DestinationsRepo; config: Pick<AppConfig, 'defaultAlertChannelId' | 'digestChannelId'>; messengerAdminPsids: () => readonly string[] }): Routing`

`messengerAdminPsids` là seam cho Phase 2. Phase 1 truyền `() => []`.

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/notify/routing.test.ts
import { describe, expect, it } from 'bun:test'
import type { DestinationRow, DestinationsRepo } from '../../src/db/destinations.repo.js'
import { makeRouting } from '../../src/notify/routing.js'
import type { ProviderName } from '../../src/notify/notifier.js'

const CONFIG = { defaultAlertChannelId: 'default-chan', digestChannelId: 'digest-chan' }

function fakeRepo(rows: readonly DestinationRow[]): DestinationsRepo {
  return {
    add: () => true,
    remove: () => true,
    listForTarget: (targetId) => rows.filter((r) => r.targetId === targetId),
    listGlobal: () => rows.filter((r) => r.targetId === null),
    listByProvider: (p) => rows.filter((r) => r.provider === p),
  }
}

function row(
  targetId: number | null,
  provider: ProviderName,
  address: string,
  id = 1,
): DestinationRow {
  return { id, targetId, provider, address }
}

function routing(rows: readonly DestinationRow[], admins: readonly string[] = []) {
  return makeRouting({
    destinations: fakeRepo(rows),
    config: CONFIG,
    messengerAdminPsids: () => admins,
  })
}

describe('destinationsFor', () => {
  it('rỗng hoàn toàn thì fallback về DEFAULT_ALERT_CHANNEL_ID', () => {
    expect(routing([]).destinationsFor(1)).toEqual([
      { provider: 'discord', address: 'default-chan' },
    ])
  })

  it('có row riêng của target thì dùng nó thay cho global cùng provider', () => {
    const result = routing([
      row(1, 'discord', 'chan-riêng', 1),
      row(null, 'discord', 'chan-global', 2),
    ]).destinationsFor(1)

    expect(result).toEqual([{ provider: 'discord', address: 'chan-riêng' }])
  })

  it('override Discord của target KHÔNG làm im Messenger global', () => {
    const result = routing([
      row(1, 'discord', 'chan-riêng', 1),
      row(null, 'messenger', 'psid-1', 2),
    ]).destinationsFor(1)

    expect(result).toEqual([
      { provider: 'discord', address: 'chan-riêng' },
      { provider: 'messenger', address: 'psid-1' },
    ])
  })

  it('không có row riêng thì lấy global của mọi provider', () => {
    const result = routing([
      row(null, 'discord', 'chan-global', 1),
      row(null, 'messenger', 'psid-1', 2),
    ]).destinationsFor(1)

    expect(result).toEqual([
      { provider: 'discord', address: 'chan-global' },
      { provider: 'messenger', address: 'psid-1' },
    ])
  })

  it('nhiều row cùng provider cho một target thì giữ hết', () => {
    const result = routing([
      row(1, 'messenger', 'psid-1', 1),
      row(1, 'messenger', 'psid-2', 2),
    ]).destinationsFor(1)

    expect(result).toHaveLength(2)
  })
})

describe('digestDestinations', () => {
  it('luôn có DIGEST_CHANNEL_ID và không bị destination Discord global ghi đè', () => {
    expect(routing([row(null, 'discord', 'chan-global')]).digestDestinations()).toEqual([
      { provider: 'discord', address: 'digest-chan' },
    ])
  })

  it('cộng thêm mọi PSID admin', () => {
    expect(routing([], ['psid-a', 'psid-b']).digestDestinations()).toEqual([
      { provider: 'discord', address: 'digest-chan' },
      { provider: 'messenger', address: 'psid-a' },
      { provider: 'messenger', address: 'psid-b' },
    ])
  })

  it('PSID đã link nhưng không phải admin thì không nhận digest', () => {
    // messengerAdminPsids chỉ trả admin; destination messenger global không được kéo vào.
    const result = routing([row(null, 'messenger', 'psid-thường')], []).digestDestinations()
    expect(result).toEqual([{ provider: 'discord', address: 'digest-chan' }])
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/notify/routing.test.ts`
Expected: FAIL — không resolve được `routing.js`

- [ ] **Step 3: Viết `routing.ts`**

```ts
// src/notify/routing.ts
import type { AppConfig } from '../config.js'
import type { DestinationsRepo } from '../db/destinations.repo.js'
import type { Destination } from './notifier.js'

export type Routing = {
  /** Destination nhận alert của một target. Fallback là theo từng provider. */
  destinationsFor(targetId: number): Destination[]
  /** Destination nhận digest. Messenger ở đây là identity-driven, xem spec. */
  digestDestinations(): Destination[]
}

export type RoutingDeps = {
  destinations: DestinationsRepo
  config: Pick<AppConfig, 'defaultAlertChannelId' | 'digestChannelId'>
  /** PSID của mọi identity có is_admin = 1. Phase 1 truyền () => []. */
  messengerAdminPsids: () => readonly string[]
}

export function makeRouting(deps: RoutingDeps): Routing {
  return {
    destinationsFor(targetId) {
      const own = deps.destinations.listForTarget(targetId)
      const providersWithOwn = new Set(own.map((row) => row.provider))
      const global = deps.destinations
        .listGlobal()
        .filter((row) => !providersWithOwn.has(row.provider))

      const all = [...own, ...global].map((row) => ({
        provider: row.provider,
        address: row.address,
      }))

      if (all.length === 0) {
        return [{ provider: 'discord', address: deps.config.defaultAlertChannelId }]
      }
      return all
    },

    digestDestinations() {
      return [
        { provider: 'discord', address: deps.config.digestChannelId },
        ...deps.messengerAdminPsids().map((psid) => ({
          provider: 'messenger' as const,
          address: psid,
        })),
      ]
    },
  }
}
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/notify/routing.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/notify/routing.ts tests/notify/routing.test.ts
git commit -m "feat: quy tắc phân giải destination với fallback theo từng provider"
```

---

### Task 5: Test helper `makeTestContext` và `CommandContext` nhận `destinations`

`CommandContext` sẽ còn phình thêm ở Phase 2. Hiện 5 file test dựng nó bằng tay, nên mỗi
lần thêm field là sửa 5 chỗ. Gom vào một helper trước khi thêm field.

**Files:**
- Modify: `src/bot/types.ts:36-44`
- Create: `tests/helpers/context.ts`
- Modify: `tests/bot/commands/add.test.ts`, `tests/bot/commands/pause-history-uptime.test.ts`, `tests/bot/commands/remove-list.test.ts`, `tests/bot/commands/status-check.test.ts`, `tests/bot/router.test.ts`

**Interfaces:**
- Consumes: `DestinationsRepo` từ Task 3
- Produces: `CommandContext` có thêm `destinations: DestinationsRepo`; `makeTestContext(db: Db, overrides?: Partial<CommandContext>): CommandContext` và `TEST_NOW` xuất từ `tests/helpers/context.ts`

- [ ] **Step 1: Thêm `destinations` vào `CommandContext`**

```ts
// src/bot/types.ts — thêm import và field
import type { DestinationsRepo } from '../db/destinations.repo.js'

export type CommandContext = {
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  destinations: DestinationsRepo
  runner: Runner
  config: AppConfig
  clock: Clock
  logger: Logger
}
```

- [ ] **Step 2: Chạy test để xem đúng những chỗ nào vỡ**

Run: `bun test`
Expected: FAIL ở các file dựng `CommandContext` bằng tay.

Lưu ý: `tests/` **không** nằm trong `include` của `tsconfig.json`, nên `bun run typecheck`
sẽ xanh dù test đỏ. Dùng `bun test` để tìm danh sách file cần sửa, đừng tin typecheck ở bước này.

- [ ] **Step 3: Viết helper**

```ts
// tests/helpers/context.ts
import type { CommandContext } from '../../src/bot/types.js'
import { makeChecksRepo } from '../../src/db/checks.repo.js'
import type { Db } from '../../src/db/connection.js'
import { makeDestinationsRepo } from '../../src/db/destinations.repo.js'
import { makeIncidentsRepo } from '../../src/db/incidents.repo.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'
import type { Runner } from '../../src/monitor/runner.js'
import { silentLogger } from '../../src/shared/logger.js'

export const TEST_NOW = '2026-08-24T00:00:00.000Z'

/**
 * Một chỗ duy nhất dựng CommandContext cho test. Thêm field vào CommandContext
 * thì chỉ sửa file này.
 */
export function makeTestContext(db: Db, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    targets: makeTargetsRepo(db),
    checks: makeChecksRepo(db),
    incidents: makeIncidentsRepo(db),
    destinations: makeDestinationsRepo(db),
    runner: {} as Runner,
    config: {
      defaultIntervalSeconds: 60,
      defaultTimeoutMs: 10_000,
      defaultLatencyThresholdMs: 2_000,
      defaultAlertChannelId: 'default-chan',
      digestChannelId: 'digest-chan',
    } as CommandContext['config'],
    clock: () => new Date(TEST_NOW),
    logger: silentLogger,
    ...overrides,
  }
}
```

- [ ] **Step 4: Chuyển từng file test sang helper**

Trong mỗi file test lệnh, thay khối `beforeEach` dựng context bằng:

```ts
import { makeTestContext } from '../../helpers/context.js'   // đường dẫn tuỳ độ sâu

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  context = makeTestContext(db)
})
```

Nơi nào file cũ truyền `runner` thật hoặc `clock` khác thì đưa vào overrides, ví dụ
`makeTestContext(db, { runner: fakeRunner })`. **Giữ nguyên mọi assertion** — task này
không được đổi hành vi nào.

- [ ] **Step 5: Chạy toàn bộ test**

Run: `bun test`
Expected: PASS toàn bộ

- [ ] **Step 6: Typecheck rồi commit**

```bash
bun run typecheck
git add src/bot/types.ts tests/
git commit -m "refactor: gom việc dựng CommandContext cho test vào một helper"
```

---

### Task 6: Backfill destinations rồi bỏ cột `alert_channel_id`

Thứ tự migration là load-bearing: backfill **phải** chạy trước khi cột bị drop. Journal của
drizzle chạy theo thứ tự file, nên sinh migration dữ liệu trước, DDL sau.

**Files:**
- Create: `drizzle/NNNN_backfill_destinations.sql` (sinh bằng `db:data`)
- Modify: `src/db/schema.ts` (bỏ `alertChannelId`)
- Create: `drizzle/NNNN_*.sql` (DDL drop cột, sinh bằng `db:generate`)
- Modify: `src/shared/types.ts`, `src/db/targets.repo.ts`, `src/bot/commands/add.ts`
- Test: `tests/db/migrate.test.ts`, `tests/db/targets.repo.test.ts`, `tests/bot/commands/add.test.ts`

**Interfaces:**
- Consumes: `DestinationsRepo` từ Task 3, `CommandContext.destinations` từ Task 5
- Produces: `Target` không còn field `alertChannelId`; `CreateTargetInput` không còn `alertChannelId`

- [ ] **Step 1: Sinh file migration dữ liệu rỗng**

```bash
bun run db:data backfill_destinations
```

- [ ] **Step 2: Viết SQL backfill vào file vừa sinh**

```sql
INSERT INTO destinations (target_id, provider, address, created_at)
SELECT id, 'discord', alert_channel_id, created_at
FROM targets
WHERE alert_channel_id IS NOT NULL;
```

- [ ] **Step 3: Thêm test chặn backfill sinh row rác**

Thêm vào `tests/db/migrate.test.ts`:

```ts
it('backfill không sinh destination rác', async () => {
  const { raw, db } = openTestDb()
  await applyMigrations(db)

  const rows = raw.prepare('SELECT provider, target_id FROM destinations').all() as Array<{
    provider: string
    target_id: number | null
  }>

  // DB test rỗng nên backfill không chèn gì; test này chặn việc SQL backfill
  // vô tình chèn row khi không có dữ liệu cũ.
  expect(rows).toEqual([])
})
```

Bất biến thật của backfill (dữ liệu cũ chuyển đúng) chỉ verify được trên DB có dữ liệu, nên
nó nằm ở bước 4 của mục Xác minh — chạy `db:migrate` trên bản copy DB thật — không phải ở unit test.

- [ ] **Step 4: Bỏ cột khỏi `schema.ts`**

Xoá dòng `alertChannelId: text('alert_channel_id'),` khỏi khối `targets`.

- [ ] **Step 5: Sinh migration DDL và đọc nó**

```bash
bun run db:generate
```

Mở file SQL vừa sinh. SQLite không drop cột được trong mọi phiên bản, nên drizzle-kit có thể
sinh chuỗi rebuild bảng (tạo bảng mới, copy, drop, rename). Xác nhận file đó:

- giữ `PRIMARY KEY` và `UNIQUE(name)` của `targets`
- không làm mất FK của `checks`, `incidents`, `destinations` trỏ vào `targets`

Nếu nó rebuild bảng mà không tắt FK, thêm thủ công `PRAGMA foreign_keys=OFF;` ở đầu file và
`PRAGMA foreign_keys=ON;` ở cuối, phân tách bằng `--> statement-breakpoint`.

- [ ] **Step 6: Bỏ `alertChannelId` khỏi type và repo**

Trong `src/shared/types.ts`, xoá `alertChannelId: string | null` khỏi `Target`.

Trong `src/db/targets.repo.ts`: xoá `alertChannelId?: string | null` khỏi `CreateTargetInput`,
xoá `alertChannelId: row.alertChannelId,` khỏi `toTarget`, và xoá
`alertChannelId: input.alertChannelId ?? null,` khỏi `create`.

- [ ] **Step 7: `/add` ghi destination thay vì cột**

Trong `src/bot/commands/add.ts`, thay khối `context.targets.create({...})` cùng phần dưới nó:

```ts
      const createdAt = context.clock().toISOString()
      const created = context.targets.create({
        name,
        url,
        intervalSeconds,
        timeoutMs,
        latencyThresholdMs,
        createdBy: interaction.user.id,
        createdAt,
      })

      if (alertChannelId !== null) {
        context.destinations.add({
          targetId: created.id,
          provider: 'discord',
          address: alertChannelId,
          createdAt,
        })
      }
```

Phần validate channel ở trên giữ nguyên, kể cả thứ tự validate trước khi kiểm tra trùng tên.

- [ ] **Step 8: Sửa test đang assert cột cũ**

Chạy `grep -rn "alertChannelId" tests/ src/` và xử lý từng chỗ.

Trong `tests/bot/commands/add.test.ts`, thay `expect(target?.alertChannelId).toBe('chan-9')` bằng:

```ts
    const rows = context.destinations.listForTarget(target!.id)
    expect(rows.map((r) => `${r.provider}:${r.address}`)).toEqual(['discord:chan-9'])
```

Thêm một test mới ngay dưới nó:

```ts
  it('không truyền channel thì không tạo destination nào', async () => {
    const { interaction: value } = interaction({ name: 'web', url: 'https://a.test' })
    await addCommand.execute(context, value)
    const target = context.targets.findByName('web')
    expect(context.destinations.listForTarget(target!.id)).toEqual([])
  })
```

- [ ] **Step 9: Chạy toàn bộ test và drift**

Run: `bun test && bun run db:drift`
Expected: PASS, drift báo khớp

- [ ] **Step 10: Typecheck rồi commit**

```bash
bun run typecheck
git add src/db/schema.ts src/shared/types.ts src/db/targets.repo.ts src/bot/commands/add.ts drizzle/ tests/
git commit -m "refactor: chuyển alert_channel_id sang bảng destinations"
```

---

### Task 7: Runner dùng dispatcher

**Files:**
- Modify: `src/monitor/runner.ts`
- Test: `tests/monitor/runner.test.ts`

**Interfaces:**
- Consumes: `Dispatcher` từ Task 1, `Routing` từ Task 4
- Produces: `RunnerDeps` đổi `notifier: Notifier` thành `dispatcher: Dispatcher` + `routing: Routing`, và `config` thu về `Pick<AppConfig, 'defaultLatencyThresholdMs'>` — bỏ `defaultAlertChannelId` vì nó đã về `Routing`

- [ ] **Step 1: Sửa test hiện có sang dispatcher và thêm test mới**

Trong `tests/monitor/runner.test.ts`, thay chỗ dựng `notifier` giả bằng:

```ts
import type { Destination } from '../../src/notify/notifier.js'
import type { Routing } from '../../src/notify/routing.js'
import type { AlertMessage } from '../../src/shared/types.js'

function fakeDispatcher() {
  const sent: Array<{ kind: string; addresses: string[] }> = []
  return {
    sent,
    dispatcher: {
      async dispatch(msg: AlertMessage, dests: readonly Destination[]) {
        sent.push({ kind: msg.kind, addresses: dests.map((d) => d.address) })
      },
    },
  }
}

const oneChannel: Routing = {
  destinationsFor: () => [{ provider: 'discord', address: 'chan-1' }],
  digestDestinations: () => [],
}
```

Mọi assertion cũ dạng "đã gửi vào channel X" chuyển sang đọc `sent`. Thêm một test mới:

```ts
it('alert đi tới đúng mọi destination mà routing trả về', async () => {
  const { sent, dispatcher } = fakeDispatcher()
  const runner = makeRunner({
    probe: downProbe,
    targets,
    checks,
    incidents,
    dispatcher,
    routing: {
      destinationsFor: () => [
        { provider: 'discord', address: 'chan-1' },
        { provider: 'messenger', address: 'psid-1' },
      ],
      digestDestinations: () => [],
    },
    config: { defaultLatencyThresholdMs: 2_000 },
    clock,
    logger: silentLogger,
  })

  await runner.runCheck(target)

  expect(sent).toHaveLength(1)
  expect(sent[0]?.addresses).toEqual(['chan-1', 'psid-1'])
})
```

Tên biến `downProbe`, `targets`, `checks`, `incidents`, `clock`, `target` là các biến đã có
trong file test đó — dùng lại đúng tên đang có, đừng tạo mới.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/monitor/runner.test.ts`
Expected: FAIL — `makeRunner` chưa nhận `dispatcher`

- [ ] **Step 3: Sửa `runner.ts`**

Bỏ `import type { Notifier } from '../notify/notifier.js'`, thêm:

```ts
import type { Dispatcher } from '../notify/notifier.js'
import type { Routing } from '../notify/routing.js'
```

Đổi `RunnerDeps`:

```ts
export type RunnerDeps = {
  probe: Probe
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  dispatcher: Dispatcher
  routing: Routing
  config: Pick<AppConfig, 'defaultLatencyThresholdMs'>
  clock: Clock
  logger: Logger
}
```

Trong `makeRunner`, xoá hàm `channelOf` và thay `notifySafe`:

```ts
  async function notifySafe(message: AlertMessage, target: Target): Promise<void> {
    try {
      await deps.dispatcher.dispatch(message, deps.routing.destinationsFor(target.id))
    } catch (error) {
      // dispatcher đã cô lập lỗi từng destination; đây là chốt cuối cho lỗi ngoài dự kiến.
      deps.logger.error(`Không gửi được alert cho ${target.name}`, error)
    }
  }
```

Hai chỗ gọi đổi thành `await notifySafe(downMessage(target, result, at), target)` và
`await notifySafe(recoveredMessage(target, downtimeMs, at), target)`.

- [ ] **Step 4: Chạy test**

Run: `bun test tests/monitor/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/monitor/runner.ts tests/monitor/runner.test.ts
git commit -m "refactor: runner gửi alert qua dispatcher"
```

---

### Task 8: Digest dùng dispatcher

**Files:**
- Modify: `src/digest/schedule.ts`
- Test: `tests/digest/schedule.test.ts`

**Interfaces:**
- Consumes: `Dispatcher` từ Task 1, `Routing` từ Task 4
- Produces: `DigestJobDeps` đổi `notifier: Notifier` thành `dispatcher: Dispatcher` + `routing: Routing`, và `config` thu về `Pick<AppConfig, 'digestHourLocal' | 'checkRetentionDays'>` — bỏ `digestChannelId` vì nó đã về `Routing`

- [ ] **Step 1: Sửa test và thêm test cho destination của digest**

Trong `tests/digest/schedule.test.ts`, thay `notifier` giả bằng `fakeDispatcher` cùng khuôn
Task 7, rồi thêm:

```ts
it('digest tới DIGEST_CHANNEL_ID cộng mọi PSID admin', async () => {
  const { sent, dispatcher } = fakeDispatcher()
  const job = makeDigestJob({
    targets,
    checks,
    incidents,
    meta,
    dispatcher,
    routing: {
      destinationsFor: () => [],
      digestDestinations: () => [
        { provider: 'discord', address: 'digest-chan' },
        { provider: 'messenger', address: 'psid-admin' },
      ],
    },
    config: { digestHourLocal: 9, checkRetentionDays: 30 },
    clock: () => new Date('2026-08-26T05:00:00.000Z'), // 12h giờ VN, đã quá mốc gửi
    logger: silentLogger,
  })

  const result = await job.maybeSend()

  expect(result.sent).toBe(true)
  expect(sent[0]?.addresses).toEqual(['digest-chan', 'psid-admin'])
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/digest/schedule.test.ts`
Expected: FAIL — `makeDigestJob` chưa nhận `dispatcher`

- [ ] **Step 3: Sửa `schedule.ts`**

Đổi import `Notifier` thành:

```ts
import type { Dispatcher } from '../notify/notifier.js'
import type { Routing } from '../notify/routing.js'
```

Đổi `DigestJobDeps`:

```ts
export type DigestJobDeps = {
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  meta: MetaRepo
  dispatcher: Dispatcher
  routing: Routing
  config: Pick<AppConfig, 'digestHourLocal' | 'checkRetentionDays'>
  clock: Clock
  logger: Logger
}
```

Thay dòng gửi:

```ts
      await deps.dispatcher.dispatch(
        digestMessage(report, nowIso),
        deps.routing.digestDestinations(),
      )
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/digest/`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/digest/schedule.ts tests/digest/schedule.test.ts
git commit -m "refactor: digest gửi qua dispatcher"
```

---

### Task 9: Lệnh `/dest-list`, `/dest-add`, `/dest-remove`

**Chệch khỏi spec có chủ đích:** spec viết `/dest list|add|remove` dạng subcommand. Dùng ba
lệnh phẳng thay vì subcommand, vì subcommand buộc phải thêm `getSubcommand()` vào
`InteractionLike` và dạy parser Messenger hiểu cây option lồng nhau, đổi lấy đúng con số
không lợi ích cho người dùng.

**Files:**
- Create: `src/bot/commands/dest.ts`
- Modify: `src/bot/commands/index.ts`
- Test: `tests/bot/commands/dest.test.ts`

**Interfaces:**
- Consumes: `CommandContext.destinations` từ Task 5, `isProviderName` và `PROVIDER_NAMES` từ Task 1, `makeTestContext`/`TEST_NOW` từ Task 5
- Produces: `destListCommand`, `destAddCommand`, `destRemoveCommand` — đều là `Command`. `destAddCommand.adminOnly === true`, `destRemoveCommand.adminOnly === true`, `destListCommand.adminOnly === false`

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/bot/commands/dest.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  destAddCommand,
  destListCommand,
  destRemoveCommand,
} from '../../../src/bot/commands/dest.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeTestContext, TEST_NOW } from '../../helpers/context.js'

type Options = { provider?: string; address?: string; name?: string }

function interaction(commandName: string, options: Options) {
  const replies: InteractionReply[] = []
  const value: InteractionLike = {
    commandName,
    user: { id: 'admin-1' },
    options: {
      getString: (name) => (options as Record<string, string | undefined>)[name] ?? null,
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: async (p) => {
      replies.push(p)
      return {}
    },
    followUp: async (p) => {
      replies.push(p)
      return {}
    },
    deferReply: async () => ({}),
    editReply: async (p) => {
      replies.push(p)
      return {}
    },
  }
  return { interaction: value, replies }
}

let context: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  context = makeTestContext(db)
})

function createTarget(name: string) {
  return context.targets.create({
    name,
    url: 'https://a.test',
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: TEST_NOW,
  })
}

describe('/dest-add', () => {
  it('khai báo quyền đúng', () => {
    expect(destAddCommand.adminOnly).toBe(true)
    expect(destRemoveCommand.adminOnly).toBe(true)
    expect(destListCommand.adminOnly).toBe(false)
  })

  it('không truyền name thì tạo destination toàn cục', async () => {
    const { interaction: v, replies } = interaction('dest-add', {
      provider: 'messenger',
      address: 'psid-1',
    })
    await destAddCommand.execute(context, v)

    expect(context.destinations.listGlobal().map((r) => r.address)).toEqual(['psid-1'])
    expect(replies[0]?.content).toContain('toàn cục')
  })

  it('truyền name thì gắn vào target đó', async () => {
    const web = createTarget('web')
    const { interaction: v } = interaction('dest-add', {
      provider: 'discord',
      address: 'chan-1',
      name: 'web',
    })
    await destAddCommand.execute(context, v)

    expect(context.destinations.listForTarget(web.id)).toHaveLength(1)
    expect(context.destinations.listGlobal()).toEqual([])
  })

  it('provider lạ thì báo lỗi, không tạo gì', async () => {
    const { interaction: v, replies } = interaction('dest-add', {
      provider: 'zalo',
      address: 'x',
    })
    await destAddCommand.execute(context, v)
    expect(context.destinations.listGlobal()).toEqual([])
    expect(replies[0]?.content).toMatch(/provider/i)
  })

  it('target không tồn tại thì báo lỗi', async () => {
    const { interaction: v, replies } = interaction('dest-add', {
      provider: 'discord',
      address: 'chan-1',
      name: 'không-có',
    })
    await destAddCommand.execute(context, v)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('thêm trùng thì báo đã tồn tại, không tạo row thứ hai', async () => {
    const first = interaction('dest-add', { provider: 'messenger', address: 'psid-1' })
    await destAddCommand.execute(context, first.interaction)
    const second = interaction('dest-add', { provider: 'messenger', address: 'psid-1' })
    await destAddCommand.execute(context, second.interaction)

    expect(context.destinations.listGlobal()).toHaveLength(1)
    expect(second.replies[0]?.content).toMatch(/đã tồn tại/i)
  })
})

describe('/dest-remove', () => {
  it('xoá được, và báo rõ khi không có gì để xoá', async () => {
    const add = interaction('dest-add', { provider: 'messenger', address: 'psid-1' })
    await destAddCommand.execute(context, add.interaction)

    const hit = interaction('dest-remove', { provider: 'messenger', address: 'psid-1' })
    await destRemoveCommand.execute(context, hit.interaction)
    expect(context.destinations.listGlobal()).toEqual([])

    const miss = interaction('dest-remove', { provider: 'messenger', address: 'psid-1' })
    await destRemoveCommand.execute(context, miss.interaction)
    expect(miss.replies[0]?.content).toMatch(/không tìm thấy/i)
  })
})

describe('/dest-list', () => {
  it('chưa có gì thì nói rõ', async () => {
    const { interaction: v, replies } = interaction('dest-list', {})
    await destListCommand.execute(context, v)
    expect(replies[0]?.content).toMatch(/chưa có/i)
  })

  it('liệt kê destination toàn cục khi không truyền name', async () => {
    const add = interaction('dest-add', { provider: 'messenger', address: 'psid-1' })
    await destAddCommand.execute(context, add.interaction)

    const { interaction: v, replies } = interaction('dest-list', {})
    await destListCommand.execute(context, v)
    expect(replies[0]?.content).toContain('psid-1')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/bot/commands/dest.test.ts`
Expected: FAIL — không resolve được `dest.js`

- [ ] **Step 3: Viết `dest.ts`**

```ts
// src/bot/commands/dest.ts
import { SlashCommandBuilder } from 'discord.js'
import { isProviderName, PROVIDER_NAMES } from '../../notify/notifier.js'
import { EPHEMERAL, type Command, type CommandContext, type InteractionLike } from '../types.js'

const PROVIDER_LIST = PROVIDER_NAMES.join(', ')
const PROVIDER_CHOICES = PROVIDER_NAMES.map((p) => ({ name: p, value: p }))

type Resolved =
  | { ok: true; targetId: number | null; label: string }
  | { ok: false; message: string }

function resolveTarget(context: CommandContext, name: string | null): Resolved {
  if (name === null) return { ok: true, targetId: null, label: 'toàn cục' }
  const target = context.targets.findByName(name)
  if (!target) return { ok: false, message: `Không tìm thấy target \`${name}\`.` }
  return { ok: true, targetId: target.id, label: `\`${name}\`` }
}

/** Trả về provider đã hợp lệ, hoặc null sau khi đã trả lời lỗi cho người dùng. */
async function readProvider(interaction: InteractionLike): Promise<'discord' | 'messenger' | null> {
  const provider = interaction.options.getString('provider')
  const address = interaction.options.getString('address')

  if (!provider || !address) {
    await interaction.reply({ content: '`provider` và `address` là bắt buộc.', flags: EPHEMERAL })
    return null
  }
  if (!isProviderName(provider)) {
    await interaction.reply({
      content: `provider phải là một trong: ${PROVIDER_LIST}.`,
      flags: EPHEMERAL,
    })
    return null
  }
  return provider
}

export const destAddCommand: Command = {
  name: 'dest-add',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('dest-add')
    .setDescription('Thêm nơi nhận alert')
    .addStringOption((o) =>
      o
        .setName('provider')
        .setDescription(`Một trong: ${PROVIDER_LIST}`)
        .setRequired(true)
        .addChoices(...PROVIDER_CHOICES),
    )
    .addStringOption((o) =>
      o
        .setName('address')
        .setDescription('Channel ID với discord, PSID với messenger')
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('name').setDescription('Gắn riêng cho một target; bỏ trống là toàn cục'),
    ),

  async execute(context, interaction) {
    const provider = await readProvider(interaction)
    if (provider === null) return

    const address = interaction.options.getString('address') as string
    const resolved = resolveTarget(context, interaction.options.getString('name'))
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.message, flags: EPHEMERAL })
      return
    }

    const added = context.destinations.add({
      targetId: resolved.targetId,
      provider,
      address,
      createdAt: context.clock().toISOString(),
    })

    await interaction.reply({
      content: added
        ? `Đã thêm ${provider} → \`${address}\` cho ${resolved.label}.`
        : `Destination ${provider} → \`${address}\` cho ${resolved.label} đã tồn tại.`,
    })
  },
}

export const destRemoveCommand: Command = {
  name: 'dest-remove',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('dest-remove')
    .setDescription('Bỏ một nơi nhận alert')
    .addStringOption((o) =>
      o
        .setName('provider')
        .setDescription(`Một trong: ${PROVIDER_LIST}`)
        .setRequired(true)
        .addChoices(...PROVIDER_CHOICES),
    )
    .addStringOption((o) => o.setName('address').setDescription('Địa chỉ cần bỏ').setRequired(true))
    .addStringOption((o) =>
      o.setName('name').setDescription('Target tương ứng; bỏ trống là toàn cục'),
    ),

  async execute(context, interaction) {
    const provider = await readProvider(interaction)
    if (provider === null) return

    const address = interaction.options.getString('address') as string
    const resolved = resolveTarget(context, interaction.options.getString('name'))
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.message, flags: EPHEMERAL })
      return
    }

    const removed = context.destinations.remove(resolved.targetId, provider, address)
    if (!removed) {
      await interaction.reply({
        content: `Không tìm thấy destination ${provider} → \`${address}\` ở ${resolved.label}.`,
        flags: EPHEMERAL,
      })
      return
    }

    await interaction.reply({
      content: `Đã bỏ ${provider} → \`${address}\` khỏi ${resolved.label}.`,
    })
  },
}

export const destListCommand: Command = {
  name: 'dest-list',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('dest-list')
    .setDescription('Xem nơi nhận alert')
    .addStringOption((o) =>
      o.setName('name').setDescription('Chỉ xem của một target; bỏ trống là toàn cục'),
    ),

  async execute(context, interaction) {
    const resolved = resolveTarget(context, interaction.options.getString('name'))
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.message, flags: EPHEMERAL })
      return
    }

    const rows =
      resolved.targetId === null
        ? context.destinations.listGlobal()
        : context.destinations.listForTarget(resolved.targetId)

    if (rows.length === 0) {
      await interaction.reply({ content: `Chưa có destination nào cho ${resolved.label}.` })
      return
    }

    const lines = rows.map((row) => `• ${row.provider} → \`${row.address}\``)
    await interaction.reply({
      content: `**Destination của ${resolved.label}**\n${lines.join('\n')}`,
    })
  },
}
```

- [ ] **Step 4: Đăng ký vào registry**

Trong `src/bot/commands/index.ts` thêm import:

```ts
import { destAddCommand, destListCommand, destRemoveCommand } from './dest.js'
```

và ba dòng vào mảng trả về của `allCommands()`:

```ts
    destListCommand,
    destAddCommand,
    destRemoveCommand,
```

- [ ] **Step 5: Chạy test**

Run: `bun test tests/bot/`
Expected: PASS. Nếu `tests/bot/commands/registry.test.ts` assert số lượng lệnh, cập nhật con số từ 9 lên 12.

- [ ] **Step 6: Typecheck rồi commit**

```bash
bun run typecheck
git add src/bot/commands/dest.ts src/bot/commands/index.ts tests/bot/
git commit -m "feat: lệnh quản lý destination"
```

---

### Task 10: Lắp lại `src/index.ts` — PHASE 1 GATE

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: mọi thứ từ Task 1–9
- Produces: app chạy được, chỉ Discord, hành vi không đổi

- [ ] **Step 1: Sửa phần lắp ghép**

Thêm import:

```ts
import { makeDestinationsRepo } from './db/destinations.repo.js'
import { makeDispatcher } from './notify/dispatcher.js'
import { makeRouting } from './notify/routing.js'
```

Sau `const meta = makeMetaRepo(db)` thêm:

```ts
  const destinations = makeDestinationsRepo(db)
```

Thay khối dựng `notifier`, `runner`, `digestJob`:

```ts
  const client = createClient()
  const dispatcher = makeDispatcher({
    notifiers: [makeDiscordNotifier({ client, logger })],
    logger,
  })
  const routing = makeRouting({
    destinations,
    config,
    // Phase 2 thay bằng hàm đọc messenger_identities.
    messengerAdminPsids: () => [],
  })
  const runner = makeRunner({
    probe: makeHttpProbe(),
    targets,
    checks,
    incidents,
    dispatcher,
    routing,
    config,
    clock,
    logger,
  })
  const digestJob = makeDigestJob({
    targets,
    checks,
    incidents,
    meta,
    dispatcher,
    routing,
    config,
    clock,
    logger,
  })
```

Trong `makeRouter`, thêm `destinations` vào `ctx`:

```ts
    ctx: { targets, checks, incidents, destinations, runner, config, clock, logger },
```

- [ ] **Step 2: Chạy toàn bộ cửa xác minh của Phase 1**

```bash
bun run typecheck
bun test
bun run db:drift
```
Expected: cả ba xanh

- [ ] **Step 3: Smoke test thật**

```bash
bun run db:migrate
bun src/index.ts
```
Expected: login được Discord gateway, scheduler chạy. Thử `/list`, `/status`, `/dest-list`
trên server thật. Alert vẫn vào đúng channel như trước khi refactor.

- [ ] **Step 4: Đăng ký lệnh mới lên Discord**

```bash
bun run deploy-commands
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: lắp dispatcher và routing vào entrypoint"
```

**PHASE 1 GATE.** Không sang Phase 2 khi bước 2 và 3 chưa xanh. Nếu refactor làm hỏng
Discord, phải phát hiện ở đây — lúc chưa có biến số Messenger nào trong ảnh.

---

# PHASE 2 — Provider Messenger

Chỉ bắt đầu khi Phase 1 gate đã xanh.

---

### Task 11: Config `MESSENGER_*`

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `type MessengerConfig = Readonly<{ pageAccessToken: string; appSecret: string; verifyToken: string; port: number; webhookPath: string; apiVersion: string; outboxMaxAgeHours: number }>`; `AppConfig` có thêm `messenger: MessengerConfig | null` (`null` khi tắt)

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/config.test.ts`:

```ts
const BASE = {
  DISCORD_TOKEN: 't',
  DISCORD_CLIENT_ID: 'c',
  GUILD_ID: 'g',
  DEFAULT_ALERT_CHANNEL_ID: 'a',
  DIGEST_CHANNEL_ID: 'd',
  ADMIN_USER_IDS: 'u1',
}

describe('config messenger', () => {
  it('mặc định tắt và messenger là null', () => {
    expect(loadConfig({ ...BASE } as NodeJS.ProcessEnv).messenger).toBeNull()
  })

  it('MESSENGER_ENABLED=false vẫn là null dù có secret', () => {
    const config = loadConfig({
      ...BASE,
      MESSENGER_ENABLED: 'false',
      MESSENGER_PAGE_ACCESS_TOKEN: 'p',
      MESSENGER_APP_SECRET: 's',
      MESSENGER_VERIFY_TOKEN: 'v',
    } as NodeJS.ProcessEnv)
    expect(config.messenger).toBeNull()
  })

  it('bật mà thiếu secret thì throw, và nêu đúng tên biến còn thiếu', () => {
    expect(() =>
      loadConfig({ ...BASE, MESSENGER_ENABLED: 'true' } as NodeJS.ProcessEnv),
    ).toThrow(/MESSENGER_PAGE_ACCESS_TOKEN/)
  })

  it('bật đủ secret thì trả nhóm messenger với default đã áp', () => {
    const config = loadConfig({
      ...BASE,
      MESSENGER_ENABLED: 'true',
      MESSENGER_PAGE_ACCESS_TOKEN: 'p',
      MESSENGER_APP_SECRET: 's',
      MESSENGER_VERIFY_TOKEN: 'v',
    } as NodeJS.ProcessEnv)

    expect(config.messenger).toEqual({
      pageAccessToken: 'p',
      appSecret: 's',
      verifyToken: 'v',
      port: 8080,
      webhookPath: '/webhook/messenger',
      apiVersion: 'v21.0',
      outboxMaxAgeHours: 48,
    })
  })

  it('MESSENGER_ENABLED nhận giá trị lạ thì throw', () => {
    expect(() =>
      loadConfig({ ...BASE, MESSENGER_ENABLED: 'yes' } as NodeJS.ProcessEnv),
    ).toThrow(/MESSENGER_ENABLED/)
  })

  it('webhook path phải bắt đầu bằng /', () => {
    expect(() =>
      loadConfig({
        ...BASE,
        MESSENGER_ENABLED: 'true',
        MESSENGER_PAGE_ACCESS_TOKEN: 'p',
        MESSENGER_APP_SECRET: 's',
        MESSENGER_VERIFY_TOKEN: 'v',
        MESSENGER_WEBHOOK_PATH: 'webhook',
      } as NodeJS.ProcessEnv),
    ).toThrow(/MESSENGER_WEBHOOK_PATH/)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/config.test.ts`
Expected: FAIL — `config.messenger` là `undefined`

- [ ] **Step 3: Thêm vào zod schema**

Thêm các key vào object trong `src/config.ts`:

```ts
  MESSENGER_ENABLED: z.enum(['true', 'false']).default('false'),
  MESSENGER_PAGE_ACCESS_TOKEN: z.string().default(''),
  MESSENGER_APP_SECRET: z.string().default(''),
  MESSENGER_VERIFY_TOKEN: z.string().default(''),
  MESSENGER_PORT: z.coerce.number().int().min(1).max(65_535).default(8_080),
  MESSENGER_WEBHOOK_PATH: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('/'), 'phải bắt đầu bằng /')
    .default('/webhook/messenger'),
  MESSENGER_API_VERSION: z.string().min(1).default('v21.0'),
  MESSENGER_OUTBOX_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(720).default(48),
```

`MESSENGER_ENABLED` dùng `z.enum` chứ **không** dùng `z.coerce.boolean()` — `Boolean('false')`
là `true`, nên coerce sẽ bật tính năng khi người ta viết `false`.

Bọc `.superRefine` quanh object để chỉ bắt buộc secret khi bật:

```ts
const schema = z
  .object({
    // ...toàn bộ key hiện có
  })
  .superRefine((raw, ctx) => {
    if (raw.MESSENGER_ENABLED !== 'true') return
    const required = [
      'MESSENGER_PAGE_ACCESS_TOKEN',
      'MESSENGER_APP_SECRET',
      'MESSENGER_VERIFY_TOKEN',
    ] as const
    for (const key of required) {
      if (raw[key].length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'bắt buộc khi MESSENGER_ENABLED=true',
        })
      }
    }
  })
```

- [ ] **Step 4: Thêm type và dựng nhóm `messenger`**

```ts
export type MessengerConfig = Readonly<{
  pageAccessToken: string
  appSecret: string
  verifyToken: string
  port: number
  webhookPath: string
  apiVersion: string
  outboxMaxAgeHours: number
}>
```

Thêm `messenger: MessengerConfig | null` vào `AppConfig`, và trong `loadConfig` trước
`return Object.freeze({...})`:

```ts
  const messenger: MessengerConfig | null =
    raw.MESSENGER_ENABLED === 'true'
      ? Object.freeze({
          pageAccessToken: raw.MESSENGER_PAGE_ACCESS_TOKEN,
          appSecret: raw.MESSENGER_APP_SECRET,
          verifyToken: raw.MESSENGER_VERIFY_TOKEN,
          port: raw.MESSENGER_PORT,
          webhookPath: raw.MESSENGER_WEBHOOK_PATH,
          apiVersion: raw.MESSENGER_API_VERSION,
          outboxMaxAgeHours: raw.MESSENGER_OUTBOX_MAX_AGE_HOURS,
        })
      : null
```

rồi thêm `messenger,` vào object trả về.

- [ ] **Step 5: Cập nhật `.env.example`**

Thêm vào cuối file:

```
# Messenger (tắt mặc định; bật thì 3 biến secret là bắt buộc)
MESSENGER_ENABLED=false
MESSENGER_PAGE_ACCESS_TOKEN=
MESSENGER_APP_SECRET=
MESSENGER_VERIFY_TOKEN=
MESSENGER_PORT=8080
MESSENGER_WEBHOOK_PATH=/webhook/messenger
MESSENGER_API_VERSION=v21.0
MESSENGER_OUTBOX_MAX_AGE_HOURS=48
```

- [ ] **Step 6: Chạy test**

Run: `bun test tests/config.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck rồi commit**

```bash
bun run typecheck
git add src/config.ts .env.example tests/config.test.ts
git commit -m "feat: config cho Messenger, tắt mặc định"
```

---

### Task 12: Render `AlertMessage` và embed thành text Messenger

**Files:**
- Create: `src/notify/messenger-text.ts`
- Test: `tests/notify/messenger-text.test.ts`

**Interfaces:**
- Consumes: `AlertMessage` (đã có `table`, `targetName` từ Task 2)
- Produces: `MESSENGER_MAX_TEXT = 2000`; `stripMarkdown(text: string): string`; `splitForMessenger(text: string, max?: number): string[]`; `alertMessageToText(msg: AlertMessage): string[]`; `type EmbedLike = { title?: string; description?: string; fields?: ReadonlyArray<{ name: string; value: string }> }`; `embedToText(embed: EmbedLike): string[]`

`embedToText` là cách adapter đọc `payload.embeds[0].toJSON()` của `/check` mà **không phải
sửa file lệnh nào**.

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/notify/messenger-text.test.ts
import { describe, expect, it } from 'bun:test'
import {
  alertMessageToText,
  embedToText,
  MESSENGER_MAX_TEXT,
  splitForMessenger,
  stripMarkdown,
} from '../../src/notify/messenger-text.js'
import type { AlertMessage } from '../../src/shared/types.js'

describe('stripMarkdown', () => {
  it('bỏ bold, inline code và code fence', () => {
    expect(stripMarkdown('**web** dùng `api` trong ```khối```')).toBe('web dùng api trong khối')
  })

  it('không đụng text thường', () => {
    expect(stripMarkdown('web-prod — UP — 120 ms')).toBe('web-prod — UP — 120 ms')
  })
})

describe('splitForMessenger', () => {
  it('text ngắn thì trả một phần tử', () => {
    expect(splitForMessenger('ngắn')).toEqual(['ngắn'])
  })

  it('cắt theo ranh giới dòng, mỗi phần không vượt hạn', () => {
    const line = 'x'.repeat(90)
    const parts = splitForMessenger(Array.from({ length: 40 }, () => line).join('\n'), 200)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(200)
  })

  it('một dòng dài hơn hạn thì cắt cứng, không mất ký tự', () => {
    const parts = splitForMessenger('y'.repeat(500), 200)
    expect(parts.join('')).toBe('y'.repeat(500))
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(200)
  })

  it('hạn mặc định là 2000', () => {
    expect(MESSENGER_MAX_TEXT).toBe(2_000)
    const parts = splitForMessenger('z'.repeat(4_500))
    expect(parts).toHaveLength(3)
  })
})

describe('alertMessageToText', () => {
  const down: AlertMessage = {
    kind: 'down',
    targetName: 'api',
    title: '🔴 api đang DOWN',
    description: 'Không đạt điều kiện kiểm tra sức khoẻ.',
    color: 1,
    fields: [
      { name: 'URL', value: 'https://a.test/…' },
      { name: 'Lý do', value: 'HTTP 500' },
    ],
    timestampIso: '2026-08-26T00:00:00.000Z',
  }

  it('gộp title, description và field thành text phẳng', () => {
    const [text] = alertMessageToText(down)
    expect(text).toContain('🔴 api đang DOWN')
    expect(text).toContain('Không đạt điều kiện')
    expect(text).toContain('URL: https://a.test/…')
    expect(text).toContain('Lý do: HTTP 500')
  })

  it('render table thành từng dòng, không pad và không code fence', () => {
    const digest: AlertMessage = {
      kind: 'digest',
      title: '📊 Báo cáo',
      description: '',
      color: 1,
      fields: [],
      timestampIso: '2026-08-26T00:00:00.000Z',
      table: { rows: [['🟢', 'web', '99.9%', '120ms', '1', '1m 5s']] },
    }
    const [text] = alertMessageToText(digest)
    expect(text).toContain('🟢 web — 99.9% — 120ms — 1 sự cố — 1m 5s')
    expect(text).not.toContain('```')
    expect(text).not.toContain('  ')
  })

  it('table rỗng vẫn có câu thay thế', () => {
    const digest: AlertMessage = {
      kind: 'digest',
      title: '📊 Báo cáo',
      description: '',
      color: 1,
      fields: [],
      timestampIso: '2026-08-26T00:00:00.000Z',
      table: { rows: [] },
    }
    expect(alertMessageToText(digest)[0]).toContain('Chưa có target nào được theo dõi.')
  })
})

describe('embedToText', () => {
  it('đọc được hình dạng APIEmbed của discord.js', () => {
    const [text] = embedToText({
      title: '🟢 Kết quả kiểm tra web',
      description: 'Trạng thái: **UP**',
      fields: [{ name: 'Latency', value: '120 ms' }],
    })
    expect(text).toContain('🟢 Kết quả kiểm tra web')
    expect(text).toContain('Trạng thái: UP')
    expect(text).toContain('Latency: 120 ms')
  })

  it('embed thiếu field vẫn render được', () => {
    expect(embedToText({ title: 'chỉ có title' })).toEqual(['chỉ có title'])
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/notify/messenger-text.test.ts`
Expected: FAIL — không resolve được `messenger-text.js`

- [ ] **Step 3: Viết `messenger-text.ts`**

```ts
// src/notify/messenger-text.ts
import type { AlertMessage } from '../shared/types.js'

/** Hạn ký tự một tin nhắn Messenger. */
export const MESSENGER_MAX_TEXT = 2_000

const EMPTY_TABLE = 'Chưa có target nào được theo dõi.'

/**
 * Messenger không render markdown, nó hiện nguyên ký tự. Các lệnh list/status/
 * history/uptime đang phát **bold** và `code`, nên phải bóc trước khi gửi.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```/g, '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

export function splitForMessenger(text: string, max = MESSENGER_MAX_TEXT): string[] {
  const chunks: string[] = []
  let current = ''

  for (const line of text.split('\n')) {
    const candidate = current.length > 0 ? `${current}\n${line}` : line
    if (candidate.length <= max) {
      current = candidate
      continue
    }

    if (current.length > 0) chunks.push(current)

    // Một dòng đơn dài hơn hạn thì cắt cứng — thà xấu còn hơn mất chữ.
    let rest = line
    while (rest.length > max) {
      chunks.push(rest.slice(0, max))
      rest = rest.slice(max)
    }
    current = rest
  }

  if (current.length > 0) chunks.push(current)
  return chunks.length > 0 ? chunks : ['']
}

function tableToLines(rows: readonly string[][]): string {
  if (rows.length === 0) return EMPTY_TABLE
  return rows
    .map((cells) => {
      const [icon = '', name = '', uptime = '', latency = '', incidents = '', downtime = ''] =
        cells
      return `${icon} ${name} — ${uptime} — ${latency} — ${incidents} sự cố — ${downtime}`
    })
    .join('\n')
}

type Parts = {
  title?: string
  body?: string
  fields?: ReadonlyArray<{ name: string; value: string }>
}

function compose(parts: Parts): string[] {
  const lines: string[] = []
  if (parts.title) lines.push(parts.title)
  if (parts.body) lines.push(parts.body)
  for (const field of parts.fields ?? []) lines.push(`${field.name}: ${field.value}`)
  return splitForMessenger(stripMarkdown(lines.join('\n')))
}

export function alertMessageToText(msg: AlertMessage): string[] {
  const body = msg.table ? tableToLines(msg.table.rows) : msg.description
  return compose({ title: msg.title, body, fields: msg.fields })
}

/** Hình dạng APIEmbed mà `EmbedBuilder.toJSON()` trả về, thu gọn còn phần ta dùng. */
export type EmbedLike = {
  title?: string
  description?: string
  fields?: ReadonlyArray<{ name: string; value: string }>
}

export function embedToText(embed: EmbedLike): string[] {
  return compose({ title: embed.title, body: embed.description, fields: embed.fields })
}
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/notify/messenger-text.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/notify/messenger-text.ts tests/notify/messenger-text.test.ts
git commit -m "feat: render AlertMessage và embed thành text Messenger"
```

---

### Task 13: Bảng Messenger và repo identity

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/messenger.repo.ts`
- Create: `drizzle/NNNN_*.sql` (sinh ra)
- Test: `tests/db/messenger.repo.test.ts`

**Interfaces:**
- Consumes: `Db` từ `src/db/connection.ts`
- Produces: `type MessengerIdentity = { psid: string; discordUserId: string | null; isAdmin: boolean; lastInboundAt: string | null }`; `type MessengerRepo = { findIdentity(psid: string): MessengerIdentity | null; adminPsids(): string[]; touchInbound(psid: string, atIso: string): void; link(input: { psid: string; discordUserId: string; isAdmin: boolean; atIso: string }): void; unlink(psid: string): boolean; createLinkCode(input: { code: string; discordUserId: string; expiresAtIso: string }): void; consumeLinkCode(code: string, nowIso: string): { discordUserId: string } | null; markMidSeen(mid: string, atIso: string): boolean; deleteMidsOlderThan(cutoffIso: string): number }`; `makeMessengerRepo(db: Db): MessengerRepo`

`markMidSeen` trả `false` khi `mid` đã thấy trước đó. `touchInbound` **chỉ update**, không
tạo identity mới — PSID chưa link thì không có hàng nào để chạm.

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/db/messenger.repo.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { makeMessengerRepo, type MessengerRepo } from '../../src/db/messenger.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'

const NOW = '2026-08-26T10:00:00.000Z'

describe('MessengerRepo', () => {
  let repo: MessengerRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeMessengerRepo(db)
  })

  describe('identity', () => {
    it('chưa link thì findIdentity trả null', () => {
      expect(repo.findIdentity('psid-1')).toBeNull()
    })

    it('link tạo identity với quyền và mốc inbound', () => {
      repo.link({ psid: 'psid-1', discordUserId: 'd1', isAdmin: true, atIso: NOW })
      expect(repo.findIdentity('psid-1')).toEqual({
        psid: 'psid-1',
        discordUserId: 'd1',
        isAdmin: true,
        lastInboundAt: NOW,
      })
    })

    it('link lại cùng PSID thì cập nhật, không nhân bản', () => {
      repo.link({ psid: 'psid-1', discordUserId: 'd1', isAdmin: false, atIso: NOW })
      repo.link({ psid: 'psid-1', discordUserId: 'd2', isAdmin: true, atIso: NOW })
      expect(repo.findIdentity('psid-1')?.discordUserId).toBe('d2')
      expect(repo.findIdentity('psid-1')?.isAdmin).toBe(true)
    })

    it('adminPsids chỉ trả identity có quyền admin', () => {
      repo.link({ psid: 'psid-admin', discordUserId: 'd1', isAdmin: true, atIso: NOW })
      repo.link({ psid: 'psid-thường', discordUserId: 'd2', isAdmin: false, atIso: NOW })
      expect(repo.adminPsids()).toEqual(['psid-admin'])
    })

    it('touchInbound cập nhật mốc, và không tạo identity cho PSID chưa link', () => {
      repo.link({ psid: 'psid-1', discordUserId: 'd1', isAdmin: true, atIso: NOW })
      repo.touchInbound('psid-1', '2026-08-26T11:00:00.000Z')
      expect(repo.findIdentity('psid-1')?.lastInboundAt).toBe('2026-08-26T11:00:00.000Z')

      repo.touchInbound('psid-lạ', NOW)
      expect(repo.findIdentity('psid-lạ')).toBeNull()
    })

    it('unlink trả false khi không có gì để xoá', () => {
      expect(repo.unlink('psid-1')).toBe(false)
      repo.link({ psid: 'psid-1', discordUserId: 'd1', isAdmin: true, atIso: NOW })
      expect(repo.unlink('psid-1')).toBe(true)
      expect(repo.findIdentity('psid-1')).toBeNull()
    })
  })

  describe('link code', () => {
    it('consume code hợp lệ trả discordUserId và chỉ dùng được một lần', () => {
      repo.createLinkCode({
        code: 'ABC12345',
        discordUserId: 'd1',
        expiresAtIso: '2026-08-26T10:10:00.000Z',
      })

      expect(repo.consumeLinkCode('ABC12345', NOW)).toEqual({ discordUserId: 'd1' })
      expect(repo.consumeLinkCode('ABC12345', NOW)).toBeNull()
    })

    it('code hết hạn thì không consume được', () => {
      repo.createLinkCode({
        code: 'OLD00000',
        discordUserId: 'd1',
        expiresAtIso: '2026-08-26T09:00:00.000Z',
      })
      expect(repo.consumeLinkCode('OLD00000', NOW)).toBeNull()
    })

    it('code không tồn tại thì trả null', () => {
      expect(repo.consumeLinkCode('KHONGCO1', NOW)).toBeNull()
    })
  })

  describe('seen mids', () => {
    it('mid mới trả true, mid lặp trả false', () => {
      expect(repo.markMidSeen('m1', NOW)).toBe(true)
      expect(repo.markMidSeen('m1', NOW)).toBe(false)
    })

    it('dọn được mid cũ', () => {
      repo.markMidSeen('m-cũ', '2026-08-20T00:00:00.000Z')
      repo.markMidSeen('m-mới', NOW)
      expect(repo.deleteMidsOlderThan('2026-08-25T00:00:00.000Z')).toBe(1)
      expect(repo.markMidSeen('m-cũ', NOW)).toBe(true)
      expect(repo.markMidSeen('m-mới', NOW)).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/db/messenger.repo.test.ts`
Expected: FAIL — không resolve được `messenger.repo.js`

- [ ] **Step 3: Thêm ba bảng vào `schema.ts`**

```ts
export const messengerIdentities = sqliteTable('messenger_identities', {
  psid: text('psid').primaryKey(),
  discordUserId: text('discord_user_id'),
  isAdmin: integer('is_admin').notNull().default(0),
  lastInboundAt: text('last_inbound_at'),
  linkedAt: text('linked_at'),
})

export const messengerLinkCodes = sqliteTable('messenger_link_codes', {
  code: text('code').primaryKey(),
  discordUserId: text('discord_user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
})

export const messengerSeenMids = sqliteTable(
  'messenger_seen_mids',
  {
    mid: text('mid').primaryKey(),
    seenAt: text('seen_at').notNull(),
  },
  (t) => [index('idx_messenger_seen_mids_time').on(t.seenAt)],
)
```

- [ ] **Step 4: Sinh migration và đọc nó**

```bash
bun run db:generate
```

Mở file SQL vừa sinh, xác nhận ba `CREATE TABLE` và index trên `seen_at`.

- [ ] **Step 5: Viết repo**

```ts
// src/db/messenger.repo.ts
import type { Changes } from 'bun:sqlite'
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from './connection.js'
import { messengerIdentities, messengerLinkCodes, messengerSeenMids } from './schema.js'

export type MessengerIdentity = {
  psid: string
  discordUserId: string | null
  isAdmin: boolean
  lastInboundAt: string | null
}

export type LinkCodeInput = {
  code: string
  discordUserId: string
  expiresAtIso: string
}

export type LinkInput = {
  psid: string
  discordUserId: string
  isAdmin: boolean
  atIso: string
}

export type MessengerRepo = {
  findIdentity(psid: string): MessengerIdentity | null
  adminPsids(): string[]
  /** Chỉ update. PSID chưa link thì không có hàng nào để chạm. */
  touchInbound(psid: string, atIso: string): void
  link(input: LinkInput): void
  unlink(psid: string): boolean
  createLinkCode(input: LinkCodeInput): void
  consumeLinkCode(code: string, nowIso: string): { discordUserId: string } | null
  /** false nếu mid đã xử lý trước đó. */
  markMidSeen(mid: string, atIso: string): boolean
  deleteMidsOlderThan(cutoffIso: string): number
}

type IdentityRow = typeof messengerIdentities.$inferSelect

function toIdentity(row: IdentityRow): MessengerIdentity {
  return {
    psid: row.psid,
    discordUserId: row.discordUserId,
    isAdmin: row.isAdmin === 1,
    lastInboundAt: row.lastInboundAt,
  }
}

export function makeMessengerRepo(db: Db): MessengerRepo {
  return {
    findIdentity(psid) {
      const row = db
        .select()
        .from(messengerIdentities)
        .where(eq(messengerIdentities.psid, psid))
        .get()
      return row ? toIdentity(row) : null
    },

    adminPsids() {
      return db
        .select()
        .from(messengerIdentities)
        .where(eq(messengerIdentities.isAdmin, 1))
        .orderBy(asc(messengerIdentities.psid))
        .all()
        .map((row) => row.psid)
    },

    touchInbound(psid, atIso) {
      db.update(messengerIdentities)
        .set({ lastInboundAt: atIso })
        .where(eq(messengerIdentities.psid, psid))
        .run()
    },

    link(input) {
      db.insert(messengerIdentities)
        .values({
          psid: input.psid,
          discordUserId: input.discordUserId,
          isAdmin: input.isAdmin ? 1 : 0,
          lastInboundAt: input.atIso,
          linkedAt: input.atIso,
        })
        .onConflictDoUpdate({
          target: messengerIdentities.psid,
          set: {
            discordUserId: input.discordUserId,
            isAdmin: input.isAdmin ? 1 : 0,
            lastInboundAt: input.atIso,
            linkedAt: input.atIso,
          },
        })
        .run()
    },

    unlink(psid) {
      const result = db
        .delete(messengerIdentities)
        .where(eq(messengerIdentities.psid, psid))
        .run() as unknown as Changes
      return result.changes > 0
    },

    createLinkCode(input) {
      db.insert(messengerLinkCodes)
        .values({
          code: input.code,
          discordUserId: input.discordUserId,
          expiresAt: input.expiresAtIso,
        })
        .run()
    },

    consumeLinkCode(code, nowIso) {
      const row = db
        .select()
        .from(messengerLinkCodes)
        .where(and(eq(messengerLinkCodes.code, code), isNull(messengerLinkCodes.usedAt)))
        .get()

      if (!row) return null
      // So sánh chuỗi ISO UTC là so sánh thời gian đúng vì cùng định dạng, cùng độ dài.
      if (row.expiresAt <= nowIso) return null

      db.update(messengerLinkCodes)
        .set({ usedAt: nowIso })
        .where(eq(messengerLinkCodes.code, code))
        .run()

      return { discordUserId: row.discordUserId }
    },

    markMidSeen(mid, atIso) {
      const existing = db
        .select()
        .from(messengerSeenMids)
        .where(eq(messengerSeenMids.mid, mid))
        .get()
      if (existing) return false

      db.insert(messengerSeenMids).values({ mid, seenAt: atIso }).run()
      return true
    },

    deleteMidsOlderThan(cutoffIso) {
      const result = db
        .delete(messengerSeenMids)
        .where(lt(messengerSeenMids.seenAt, cutoffIso))
        .run() as unknown as Changes
      return result.changes
    },
  }
}
```

Nếu `sql` không được dùng, bỏ nó khỏi dòng import để tránh lỗi unused.

- [ ] **Step 6: Chạy test và drift**

Run: `bun test tests/db/messenger.repo.test.ts && bun run db:drift`
Expected: PASS, drift khớp

- [ ] **Step 7: Typecheck rồi commit**

```bash
bun run typecheck
git add src/db/schema.ts src/db/messenger.repo.ts drizzle/ tests/db/messenger.repo.test.ts
git commit -m "feat: bảng identity, link code, seen mid của Messenger"
```

---

### Task 14: Bảng và repo `outbox`

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/outbox.repo.ts`
- Create: `drizzle/NNNN_*.sql` (sinh ra)
- Test: `tests/db/outbox.repo.test.ts`

**Interfaces:**
- Consumes: `ProviderName` từ Task 1, `AlertMessage` từ Task 2
- Produces: `type OutboxEntry = { id: number; provider: ProviderName; address: string; targetName: string | null; message: AlertMessage; createdAt: string }`; `type OutboxRepo = { enqueue(input: { provider: ProviderName; address: string; targetName: string | null; message: AlertMessage; createdAt: string; lastError?: string | null }): void; listFor(provider: ProviderName, address: string): OutboxEntry[]; deleteIds(ids: readonly number[]): number; deleteOlderThan(provider: ProviderName, address: string, cutoffIso: string): number }`; `makeOutboxRepo(db: Db): OutboxRepo`

`listFor` trả theo `createdAt` tăng dần. Hàng có `payload` không parse được JSON thì **bỏ
qua và không làm sập** — dữ liệu rác không được chặn cả hàng đợi.

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/db/outbox.repo.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeOutboxRepo, type OutboxRepo } from '../../src/db/outbox.repo.js'
import type { AlertMessage } from '../../src/shared/types.js'

function msg(title: string): AlertMessage {
  return {
    kind: 'down',
    title,
    description: 'd',
    color: 1,
    fields: [],
    timestampIso: '2026-08-26T00:00:00.000Z',
  }
}

describe('OutboxRepo', () => {
  let repo: OutboxRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeOutboxRepo(db)
  })

  function enqueue(title: string, createdAt: string, targetName: string | null = 'api') {
    repo.enqueue({
      provider: 'messenger',
      address: 'psid-1',
      targetName,
      message: msg(title),
      createdAt,
    })
  }

  it('enqueue rồi listFor trả về theo thứ tự thời gian tăng dần', () => {
    enqueue('sau', '2026-08-26T02:00:00.000Z')
    enqueue('trước', '2026-08-26T01:00:00.000Z')

    const rows = repo.listFor('messenger', 'psid-1')
    expect(rows.map((r) => r.message.title)).toEqual(['trước', 'sau'])
    expect(rows[0]?.targetName).toBe('api')
  })

  it('không lẫn địa chỉ khác', () => {
    enqueue('của psid-1', '2026-08-26T01:00:00.000Z')
    repo.enqueue({
      provider: 'messenger',
      address: 'psid-2',
      targetName: null,
      message: msg('của psid-2'),
      createdAt: '2026-08-26T01:00:00.000Z',
    })

    expect(repo.listFor('messenger', 'psid-1')).toHaveLength(1)
  })

  it('deleteIds xoá đúng số hàng', () => {
    enqueue('a', '2026-08-26T01:00:00.000Z')
    enqueue('b', '2026-08-26T02:00:00.000Z')
    const ids = repo.listFor('messenger', 'psid-1').map((r) => r.id)

    expect(repo.deleteIds(ids)).toBe(2)
    expect(repo.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('deleteIds với mảng rỗng không xoá gì và không throw', () => {
    enqueue('a', '2026-08-26T01:00:00.000Z')
    expect(repo.deleteIds([])).toBe(0)
    expect(repo.listFor('messenger', 'psid-1')).toHaveLength(1)
  })

  it('deleteOlderThan chỉ xoá hàng quá hạn của đúng địa chỉ', () => {
    enqueue('cũ', '2026-08-20T00:00:00.000Z')
    enqueue('mới', '2026-08-26T00:00:00.000Z')

    expect(repo.deleteOlderThan('messenger', 'psid-1', '2026-08-25T00:00:00.000Z')).toBe(1)
    expect(repo.listFor('messenger', 'psid-1').map((r) => r.message.title)).toEqual(['mới'])
  })

  it('payload rác bị bỏ qua, không làm sập cả hàng đợi', () => {
    const { raw, db } = openTestDb()
    // Dựng lại trên cùng kết nối để chèn được SQL thô.
    void db
    raw.exec(
      "CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, address TEXT NOT NULL, target_name TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)",
    )
    raw.exec(
      "INSERT INTO outbox (provider, address, payload, created_at) VALUES ('messenger','psid-1','{ không phải json','2026-08-26T00:00:00.000Z')",
    )
    const local = makeOutboxRepo(db)
    expect(local.listFor('messenger', 'psid-1')).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/db/outbox.repo.test.ts`
Expected: FAIL — không resolve được `outbox.repo.js`

- [ ] **Step 3: Thêm bảng vào `schema.ts`**

```ts
export const outbox = sqliteTable(
  'outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider').notNull(),
    address: text('address').notNull(),
    targetName: text('target_name'),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [index('idx_outbox_addr').on(t.provider, t.address, t.createdAt)],
)
```

- [ ] **Step 4: Sinh migration và đọc nó**

```bash
bun run db:generate
```

- [ ] **Step 5: Viết repo**

```ts
// src/db/outbox.repo.ts
import type { Changes } from 'bun:sqlite'
import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import type { ProviderName } from '../notify/notifier.js'
import type { AlertMessage } from '../shared/types.js'
import type { Db } from './connection.js'
import { outbox } from './schema.js'

export type OutboxEntry = {
  id: number
  provider: ProviderName
  address: string
  targetName: string | null
  message: AlertMessage
  createdAt: string
}

export type EnqueueInput = {
  provider: ProviderName
  address: string
  targetName: string | null
  message: AlertMessage
  createdAt: string
  lastError?: string | null
}

export type OutboxRepo = {
  enqueue(input: EnqueueInput): void
  /** Theo createdAt tăng dần. Hàng có payload rác bị bỏ qua. */
  listFor(provider: ProviderName, address: string): OutboxEntry[]
  deleteIds(ids: readonly number[]): number
  deleteOlderThan(provider: ProviderName, address: string, cutoffIso: string): number
}

export function makeOutboxRepo(db: Db): OutboxRepo {
  return {
    enqueue(input) {
      db.insert(outbox)
        .values({
          provider: input.provider,
          address: input.address,
          targetName: input.targetName,
          payload: JSON.stringify(input.message),
          createdAt: input.createdAt,
          lastError: input.lastError ?? null,
        })
        .run()
    },

    listFor(provider, address) {
      const rows = db
        .select()
        .from(outbox)
        .where(and(eq(outbox.provider, provider), eq(outbox.address, address)))
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .all()

      const entries: OutboxEntry[] = []
      for (const row of rows) {
        let message: AlertMessage
        try {
          message = JSON.parse(row.payload) as AlertMessage
        } catch {
          // Payload rác không được chặn cả hàng đợi.
          continue
        }
        entries.push({
          id: row.id,
          provider: row.provider as ProviderName,
          address: row.address,
          targetName: row.targetName,
          message,
          createdAt: row.createdAt,
        })
      }
      return entries
    },

    deleteIds(ids) {
      if (ids.length === 0) return 0
      const result = db
        .delete(outbox)
        .where(inArray(outbox.id, [...ids]))
        .run() as unknown as Changes
      return result.changes
    },

    deleteOlderThan(provider, address, cutoffIso) {
      const result = db
        .delete(outbox)
        .where(
          and(
            eq(outbox.provider, provider),
            eq(outbox.address, address),
            lt(outbox.createdAt, cutoffIso),
          ),
        )
        .run() as unknown as Changes
      return result.changes
    },
  }
}
```

- [ ] **Step 6: Chạy test và drift**

Run: `bun test tests/db/outbox.repo.test.ts && bun run db:drift`
Expected: PASS, drift khớp

- [ ] **Step 7: Typecheck rồi commit**

```bash
bun run typecheck
git add src/db/schema.ts src/db/outbox.repo.ts drizzle/ tests/db/outbox.repo.test.ts
git commit -m "feat: bảng outbox cho alert bị chặn ngoài cửa sổ"
```

---

### Task 15: Client Send API

**Files:**
- Create: `src/notify/messenger-client.ts`
- Test: `tests/notify/messenger-client.test.ts`

**Interfaces:**
- Consumes: `Logger`
- Produces: `class MessengerApiError extends Error` với `code?: number`, `subcode?: number`, `httpStatus?: number`; `isOutsideWindowError(error: unknown): boolean`; `type MessengerClient = { sendText(psid: string, text: string): Promise<void>; sendTyping(psid: string): Promise<void> }`; `makeMessengerClient(deps: { pageAccessToken: string; apiVersion: string; fetchImpl?: typeof fetch; logger: Logger }): MessengerClient`

Token đi trong header `Authorization: Bearer`, **không** trong query string — query string
dễ lọt vào log của proxy và của chính ta.

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/notify/messenger-client.test.ts
import { describe, expect, it } from 'bun:test'
import {
  isOutsideWindowError,
  makeMessengerClient,
  MessengerApiError,
} from '../../src/notify/messenger-client.js'
import { silentLogger } from '../../src/shared/logger.js'

type Captured = { url: string; init: RequestInit }

function client(response: Response, captured: Captured[] = []) {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} })
    return response
  }) as unknown as typeof fetch

  return {
    captured,
    client: makeMessengerClient({
      pageAccessToken: 'secret-token',
      apiVersion: 'v21.0',
      fetchImpl,
      logger: silentLogger,
    }),
  }
}

describe('makeMessengerClient', () => {
  it('gửi text đúng endpoint, đúng body, token trong header', async () => {
    const { client: c, captured } = client(new Response('{}', { status: 200 }))
    await c.sendText('psid-1', 'xin chào')

    expect(captured[0]?.url).toBe('https://graph.facebook.com/v21.0/me/messages')
    expect(captured[0]?.url).not.toContain('secret-token')

    const headers = captured[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer secret-token')

    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      recipient: { id: 'psid-1' },
      messaging_type: 'RESPONSE',
      message: { text: 'xin chào' },
    })
  })

  it('sendTyping gửi sender_action', async () => {
    const { client: c, captured } = client(new Response('{}', { status: 200 }))
    await c.sendTyping('psid-1')

    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      recipient: { id: 'psid-1' },
      sender_action: 'typing_on',
    })
  })

  it('lỗi HTTP thì throw MessengerApiError mang code và subcode', async () => {
    const body = JSON.stringify({
      error: { code: 10, error_subcode: 2_018_278, message: 'outside window' },
    })
    const { client: c } = client(new Response(body, { status: 400 }))

    try {
      await c.sendText('psid-1', 'x')
      throw new Error('phải throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MessengerApiError)
      const api = error as MessengerApiError
      expect(api.code).toBe(10)
      expect(api.subcode).toBe(2_018_278)
      expect(api.httpStatus).toBe(400)
      expect(api.message).toContain('outside window')
    }
  })

  it('body lỗi không phải JSON vẫn throw có ngữ cảnh', async () => {
    const { client: c } = client(new Response('gateway sập', { status: 502 }))
    await expect(c.sendText('psid-1', 'x')).rejects.toThrow(/502/)
  })
})

describe('isOutsideWindowError', () => {
  it('nhận đúng lỗi ngoài cửa sổ', () => {
    expect(isOutsideWindowError(new MessengerApiError('m', 10))).toBe(true)
    expect(isOutsideWindowError(new MessengerApiError('m', undefined, 2_018_278))).toBe(true)
  })

  it('không nhận lỗi khác — token sai không được coi là hết cửa sổ', () => {
    expect(isOutsideWindowError(new MessengerApiError('m', 190))).toBe(false)
    expect(isOutsideWindowError(new MessengerApiError('m', 100))).toBe(false)
    expect(isOutsideWindowError(new Error('bất kỳ'))).toBe(false)
  })
})
```

Test cuối là chốt quan trọng: nếu coi mọi lỗi là "hết cửa sổ" thì một token sai sẽ âm thầm
bơm đầy outbox mãi mãi thay vì báo lỗi.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/notify/messenger-client.test.ts`
Expected: FAIL — không resolve được `messenger-client.js`

- [ ] **Step 3: Viết `messenger-client.ts`**

```ts
// src/notify/messenger-client.ts
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
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/notify/messenger-client.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/notify/messenger-client.ts tests/notify/messenger-client.test.ts
git commit -m "feat: client Send API của Messenger"
```

---

### Task 16: Notifier Messenger với chính sách cửa sổ 23h

**Files:**
- Create: `src/notify/messenger-notifier.ts`
- Test: `tests/notify/messenger-notifier.test.ts`

**Interfaces:**
- Consumes: `MessengerClient`/`isOutsideWindowError` từ Task 15, `MessengerRepo` từ Task 13, `OutboxRepo` từ Task 14, `alertMessageToText` từ Task 12, `Notifier` từ Task 1
- Produces: `MESSENGER_WINDOW_MS = 23 * 60 * 60 * 1000`; `makeMessengerNotifier(deps: { client: MessengerClient; messenger: MessengerRepo; outbox: OutboxRepo; clock: Clock; logger: Logger; windowMs?: number }): Notifier`

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/notify/messenger-notifier.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { makeMessengerRepo, type MessengerRepo } from '../../src/db/messenger.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeOutboxRepo, type OutboxRepo } from '../../src/db/outbox.repo.js'
import { MessengerApiError, type MessengerClient } from '../../src/notify/messenger-client.js'
import { makeMessengerNotifier } from '../../src/notify/messenger-notifier.js'
import type { Notifier } from '../../src/notify/notifier.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

const NOW = new Date('2026-08-26T12:00:00.000Z')

const MSG: AlertMessage = {
  kind: 'down',
  targetName: 'api',
  title: '🔴 api đang DOWN',
  description: 'd',
  color: 1,
  fields: [],
  timestampIso: NOW.toISOString(),
}

function fakeClient(behaviour: 'ok' | MessengerApiError = 'ok') {
  const sent: Array<{ psid: string; text: string }> = []
  const client: MessengerClient = {
    async sendText(psid, text) {
      sent.push({ psid, text })
      if (behaviour !== 'ok') throw behaviour
    },
    async sendTyping() {},
  }
  return { client, sent }
}

describe('makeMessengerNotifier', () => {
  let messenger: MessengerRepo
  let outbox: OutboxRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    messenger = makeMessengerRepo(db)
    outbox = makeOutboxRepo(db)
  })

  function notifier(client: MessengerClient): Notifier {
    return makeMessengerNotifier({
      client,
      messenger,
      outbox,
      clock: () => NOW,
      logger: silentLogger,
    })
  }

  it('khai báo provider messenger', () => {
    expect(notifier(fakeClient().client).provider).toBe('messenger')
  })

  it('cửa sổ mở thì gửi thật, không vào outbox', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-26T11:00:00.000Z',
    })
    const { client, sent } = fakeClient()

    await notifier(client).send(MSG, 'psid-1')

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain('api đang DOWN')
    expect(outbox.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('cửa sổ đóng thì vào outbox VÀ KHÔNG gọi API', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-24T00:00:00.000Z', // hơn 2 ngày trước
    })
    const { client, sent } = fakeClient()

    await notifier(client).send(MSG, 'psid-1')

    expect(sent).toEqual([])
    const queued = outbox.listFor('messenger', 'psid-1')
    expect(queued).toHaveLength(1)
    expect(queued[0]?.targetName).toBe('api')
    expect(queued[0]?.message.title).toBe(MSG.title)
  })

  it('biên là 23h, không phải 24h', async () => {
    // 23h30m trước — trong cửa sổ 24h của Meta nhưng ngoài biên an toàn của ta.
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-25T12:30:00.000Z',
    })
    const { client, sent } = fakeClient()

    await notifier(client).send(MSG, 'psid-1')

    expect(sent).toEqual([])
    expect(outbox.listFor('messenger', 'psid-1')).toHaveLength(1)
  })

  it('PSID chưa link thì vào outbox, không gọi API', async () => {
    const { client, sent } = fakeClient()
    await notifier(client).send(MSG, 'psid-lạ')

    expect(sent).toEqual([])
    expect(outbox.listFor('messenger', 'psid-lạ')).toHaveLength(1)
  })

  it('Meta trả lỗi cửa sổ thì vào outbox kèm lastError', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-26T11:00:00.000Z',
    })
    const { client } = fakeClient(new MessengerApiError('outside window', 10))

    await expect(notifier(client).send(MSG, 'psid-1')).resolves.toBeUndefined()
    expect(outbox.listFor('messenger', 'psid-1')).toHaveLength(1)
  })

  it('lỗi KHÁC cửa sổ thì throw ra cho dispatcher, không vào outbox', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-26T11:00:00.000Z',
    })
    const { client } = fakeClient(new MessengerApiError('token sai', 190))

    await expect(notifier(client).send(MSG, 'psid-1')).rejects.toThrow(/token sai/)
    expect(outbox.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('tin dài bị cắt thành nhiều lần gửi', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-26T11:00:00.000Z',
    })
    const { client, sent } = fakeClient()

    await notifier(client).send({ ...MSG, description: 'x'.repeat(5_000) }, 'psid-1')

    expect(sent.length).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/notify/messenger-notifier.test.ts`
Expected: FAIL — không resolve được `messenger-notifier.js`

- [ ] **Step 3: Viết `messenger-notifier.ts`**

```ts
// src/notify/messenger-notifier.ts
import type { MessengerRepo } from '../db/messenger.repo.js'
import type { OutboxRepo } from '../db/outbox.repo.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import type { AlertMessage } from '../shared/types.js'
import { isOutsideWindowError, type MessengerClient } from './messenger-client.js'
import { alertMessageToText } from './messenger-text.js'
import type { Notifier } from './notifier.js'

/**
 * Cửa sổ chuẩn của Meta là 24h; ta dùng 23h làm biên an toàn. Chủ động chặn thay vì
 * để Meta từ chối, vì gọi API vi phạm liên tục là đường dẫn tới việc Page bị hạn chế.
 */
export const MESSENGER_WINDOW_MS = 23 * 60 * 60 * 1_000

export type MessengerNotifierDeps = {
  client: MessengerClient
  messenger: MessengerRepo
  outbox: OutboxRepo
  clock: Clock
  logger: Logger
  windowMs?: number
}

export function makeMessengerNotifier(deps: MessengerNotifierDeps): Notifier {
  const windowMs = deps.windowMs ?? MESSENGER_WINDOW_MS

  function enqueue(msg: AlertMessage, psid: string, reason: string, lastError?: string): void {
    deps.outbox.enqueue({
      provider: 'messenger',
      address: psid,
      targetName: msg.targetName ?? null,
      message: msg,
      createdAt: deps.clock().toISOString(),
      lastError: lastError ?? null,
    })
    deps.logger.warn(`Hoãn thông báo Messenger cho ${psid}: ${reason}`)
  }

  return {
    provider: 'messenger',

    async send(msg, psid) {
      const identity = deps.messenger.findIdentity(psid)
      const lastInboundAt = identity?.lastInboundAt

      if (lastInboundAt == null) {
        enqueue(msg, psid, 'chưa có mốc tin nhắn nào từ người nhận')
        return
      }
      if (deps.clock().getTime() - Date.parse(lastInboundAt) > windowMs) {
        enqueue(msg, psid, 'cửa sổ nhắn tin đã đóng')
        return
      }

      try {
        for (const text of alertMessageToText(msg)) {
          await deps.client.sendText(psid, text)
        }
      } catch (error) {
        if (isOutsideWindowError(error)) {
          enqueue(msg, psid, 'Meta từ chối vì ngoài cửa sổ', String(error))
          return
        }
        // Lỗi khác là lỗi thật — để dispatcher log, đừng chôn vào outbox.
        throw error
      }
    },
  }
}
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/notify/messenger-notifier.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/notify/messenger-notifier.ts tests/notify/messenger-notifier.test.ts
git commit -m "feat: notifier Messenger với chính sách cửa sổ 23h và outbox"
```

---

### Task 17: Flush outbox, gộp khi bỏ lỡ nhiều

**Files:**
- Modify: `src/notify/messages.ts` (export `STATUS_ICON`)
- Create: `src/notify/messenger-flush.ts`
- Test: `tests/notify/messenger-flush.test.ts`

**Interfaces:**
- Consumes: `MessengerClient` từ Task 15, `OutboxRepo` từ Task 14, `TargetsRepo`, `splitForMessenger`/`alertMessageToText` từ Task 12
- Produces: `COLLAPSE_THRESHOLD = 3`; `type MessengerFlusher = { flush(psid: string): Promise<void> }`; `makeMessengerFlusher(deps: { client: MessengerClient; outbox: OutboxRepo; targets: TargetsRepo; clock: Clock; logger: Logger; maxAgeHours: number }): MessengerFlusher`. Cũng export `STATUS_ICON` từ `src/notify/messages.ts` để không tạo bản copy thứ tư.

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/notify/messenger-flush.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeOutboxRepo, type OutboxRepo } from '../../src/db/outbox.repo.js'
import { makeTargetsRepo, type TargetsRepo } from '../../src/db/targets.repo.js'
import type { MessengerClient } from '../../src/notify/messenger-client.js'
import { makeMessengerFlusher } from '../../src/notify/messenger-flush.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

const NOW = new Date('2026-08-26T12:00:00.000Z')

function msg(title: string, targetName = 'api'): AlertMessage {
  return {
    kind: 'down',
    targetName,
    title,
    description: 'd',
    color: 1,
    fields: [],
    timestampIso: NOW.toISOString(),
  }
}

function fakeClient() {
  const sent: string[] = []
  const client: MessengerClient = {
    async sendText(_psid, text) {
      sent.push(text)
    },
    async sendTyping() {},
  }
  return { client, sent }
}

describe('makeMessengerFlusher', () => {
  let outbox: OutboxRepo
  let targets: TargetsRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    outbox = makeOutboxRepo(db)
    targets = makeTargetsRepo(db)
  })

  function flusher(client: MessengerClient, maxAgeHours = 48) {
    return makeMessengerFlusher({
      client,
      outbox,
      targets,
      clock: () => NOW,
      logger: silentLogger,
      maxAgeHours,
    })
  }

  function enqueue(title: string, createdAt = '2026-08-26T11:00:00.000Z', targetName = 'api') {
    outbox.enqueue({
      provider: 'messenger',
      address: 'psid-1',
      targetName,
      message: msg(title, targetName),
      createdAt,
    })
  }

  it('outbox rỗng thì không gửi gì', async () => {
    const { client, sent } = fakeClient()
    await flusher(client).flush('psid-1')
    expect(sent).toEqual([])
  })

  it('từ 3 entry trở xuống thì gửi từng cái theo thứ tự thời gian, rồi xoá', async () => {
    enqueue('thứ hai', '2026-08-26T11:30:00.000Z')
    enqueue('thứ nhất', '2026-08-26T11:00:00.000Z')
    const { client, sent } = fakeClient()

    await flusher(client).flush('psid-1')

    expect(sent).toHaveLength(2)
    expect(sent[0]).toContain('thứ nhất')
    expect(sent[1]).toContain('thứ hai')
    expect(outbox.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('quá 3 entry thì gộp thành một tin kèm trạng thái hiện tại', async () => {
    targets.create({
      name: 'api',
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const api = targets.findByName('api')!
    targets.updateStatus(api.id, 'UP', NOW.toISOString())

    for (let i = 0; i < 7; i += 1) enqueue(`alert ${i}`)
    const { client, sent } = fakeClient()

    await flusher(client).flush('psid-1')

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Đã bỏ lỡ 7 thông báo')
    expect(sent[0]).toContain('Trạng thái hiện tại')
    expect(sent[0]).toContain('api — UP')
    expect(sent[0]).not.toContain('alert 0')
    expect(outbox.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('gộp mà target đã bị xoá thì chỉ báo số lượng', async () => {
    for (let i = 0; i < 5; i += 1) enqueue(`alert ${i}`, '2026-08-26T11:00:00.000Z', 'đã-xoá')
    const { client, sent } = fakeClient()

    await flusher(client).flush('psid-1')

    expect(sent[0]).toContain('Đã bỏ lỡ 5 thông báo')
    expect(sent[0]).not.toContain('Trạng thái hiện tại')
  })

  it('entry quá hạn bị bỏ, không gửi', async () => {
    enqueue('quá cũ', '2026-08-20T00:00:00.000Z')
    enqueue('còn hạn', '2026-08-26T11:00:00.000Z')
    const { client, sent } = fakeClient()

    await flusher(client, 48).flush('psid-1')

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('còn hạn')
  })

  it('gửi thất bại thì entry còn lại trong outbox để lần sau thử lại', async () => {
    enqueue('a')
    const client: MessengerClient = {
      async sendText() {
        throw new Error('mạng lỗi')
      },
      async sendTyping() {},
    }

    await expect(flusher(client).flush('psid-1')).rejects.toThrow(/mạng lỗi/)
    expect(outbox.listFor('messenger', 'psid-1')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/notify/messenger-flush.test.ts`
Expected: FAIL — không resolve được `messenger-flush.js`

- [ ] **Step 3: Export `STATUS_ICON` từ `messages.ts`**

Trong `src/notify/messages.ts`, đổi `const STATUS_ICON` thành `export const STATUS_ICON`.
Đây là bản đã có; export nó thay vì tạo bản copy thứ tư trong repo.

- [ ] **Step 4: Viết `messenger-flush.ts`**

```ts
// src/notify/messenger-flush.ts
import type { OutboxRepo } from '../db/outbox.repo.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import type { MessengerClient } from './messenger-client.js'
import { alertMessageToText, splitForMessenger } from './messenger-text.js'
import { STATUS_ICON } from './messages.js'

/** Quá ngưỡng này thì gộp thay vì dội lại từng alert. */
export const COLLAPSE_THRESHOLD = 3

const HOUR_MS = 60 * 60 * 1_000

export type MessengerFlusher = {
  /** Gọi khi PSID vừa nhắn tin — tức cửa sổ vừa mở lại. */
  flush(psid: string): Promise<void>
}

export type MessengerFlusherDeps = {
  client: MessengerClient
  outbox: OutboxRepo
  targets: TargetsRepo
  clock: Clock
  logger: Logger
  maxAgeHours: number
}

export function makeMessengerFlusher(deps: MessengerFlusherDeps): MessengerFlusher {
  return {
    async flush(psid) {
      const now = deps.clock()
      const cutoffIso = new Date(now.getTime() - deps.maxAgeHours * HOUR_MS).toISOString()
      const dropped = deps.outbox.deleteOlderThan('messenger', psid, cutoffIso)
      if (dropped > 0) {
        deps.logger.info(`Bỏ ${dropped} thông báo Messenger quá hạn của ${psid}`)
      }

      const entries = deps.outbox.listFor('messenger', psid)
      if (entries.length === 0) return

      if (entries.length <= COLLAPSE_THRESHOLD) {
        for (const entry of entries) {
          for (const text of alertMessageToText(entry.message)) {
            await deps.client.sendText(psid, text)
          }
        }
        deps.outbox.deleteIds(entries.map((entry) => entry.id))
        return
      }

      // Dội lại hàng chục alert cũ vừa spam vừa khiến người đọc tưởng hệ thống đang
      // DOWN trong khi nó đã hồi phục. Trạng thái hiện tại mới là thông tin còn đúng.
      const names = [
        ...new Set(
          entries
            .map((entry) => entry.targetName)
            .filter((name): name is string => name != null),
        ),
      ]
      const statuses = names
        .map((name) => deps.targets.findByName(name))
        .filter((target): target is NonNullable<typeof target> => target != null)
        .map(
          (target) =>
            `${STATUS_ICON[target.currentStatus] ?? '⚪'} ${target.name} — ${target.currentStatus}`,
        )

      const lines = [
        `⚠️ Đã bỏ lỡ ${entries.length} thông báo trong lúc cửa sổ Messenger đóng.`,
      ]
      if (statuses.length > 0) lines.push('Trạng thái hiện tại:', ...statuses)

      for (const text of splitForMessenger(lines.join('\n'))) {
        await deps.client.sendText(psid, text)
      }
      // Chỉ xoá sau khi gửi xong — gửi lỗi thì entry còn lại để lần sau thử lại.
      deps.outbox.deleteIds(entries.map((entry) => entry.id))
    },
  }
}
```

- [ ] **Step 5: Chạy test**

Run: `bun test tests/notify/`
Expected: PASS toàn bộ

- [ ] **Step 6: Typecheck rồi commit**

```bash
bun run typecheck
git add src/notify/messages.ts src/notify/messenger-flush.ts tests/notify/messenger-flush.test.ts
git commit -m "feat: flush outbox Messenger, gộp khi bỏ lỡ nhiều"
```

---

### Task 18: Verify HMAC `X-Hub-Signature-256`

**Files:**
- Create: `src/web/signature.ts`
- Test: `tests/web/signature.test.ts`

**Interfaces:**
- Produces: `verifySignature(raw: Uint8Array, header: string | undefined, appSecret: string): boolean`

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/web/signature.test.ts
import crypto from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { verifySignature } from '../../src/web/signature.js'

const SECRET = 'app-secret'

function sign(raw: Uint8Array, secret = SECRET): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`
}

const body = new TextEncoder().encode('{"object":"page","entry":[]}')

describe('verifySignature', () => {
  it('signature đúng thì pass', () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true)
  })

  it('secret khác thì fail', () => {
    expect(verifySignature(body, sign(body, 'secret-khác'), SECRET)).toBe(false)
  })

  it('body đổi một byte thì fail', () => {
    const tampered = new TextEncoder().encode('{"object":"page","entry":[1]}')
    expect(verifySignature(tampered, sign(body), SECRET)).toBe(false)
  })

  it('thiếu header thì fail', () => {
    expect(verifySignature(body, undefined, SECRET)).toBe(false)
  })

  it('sai prefix thì fail', () => {
    const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifySignature(body, `sha1=${hex}`, SECRET)).toBe(false)
    expect(verifySignature(body, hex, SECRET)).toBe(false)
  })

  it('hex không hợp lệ thì fail, không throw', () => {
    expect(verifySignature(body, 'sha256=không-phải-hex', SECRET)).toBe(false)
    expect(verifySignature(body, 'sha256=', SECRET)).toBe(false)
  })

  it('hex đúng định dạng nhưng sai độ dài thì fail', () => {
    expect(verifySignature(body, 'sha256=abcd', SECRET)).toBe(false)
  })

  it('tính trên raw bytes: JSON re-serialize khác thứ tự key thì fail', () => {
    // Đây là lý do webhook phải đọc arrayBuffer thay vì để framework parse rồi
    // stringify lại — round-trip đổi byte là HMAC sai.
    const original = new TextEncoder().encode('{"a":1,"b":2}')
    const reserialized = new TextEncoder().encode('{"b":2,"a":1}')
    expect(verifySignature(reserialized, sign(original), SECRET)).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/web/signature.test.ts`
Expected: FAIL — không resolve được `signature.js`

- [ ] **Step 3: Viết `signature.ts`**

```ts
// src/web/signature.ts
import crypto from 'node:crypto'

const PREFIX = 'sha256='

/**
 * Verify X-Hub-Signature-256 của Meta. `raw` phải là byte gốc đúng như nhận được —
 * JSON parse rồi stringify lại sẽ đổi byte và làm HMAC sai.
 */
export function verifySignature(
  raw: Uint8Array,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !header.startsWith(PREFIX)) return false

  const hex = header.slice(PREFIX.length)
  // Buffer.from(..., 'hex') im lặng cắt bớt ở ký tự không hợp lệ, nên phải tự chặn.
  if (hex.length === 0 || !/^[0-9a-fA-F]+$/.test(hex)) return false

  const expected = crypto.createHmac('sha256', appSecret).update(raw).digest()
  const received = Buffer.from(hex, 'hex')
  if (received.length !== expected.length) return false

  return crypto.timingSafeEqual(received, expected)
}
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/web/signature.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/web/signature.ts tests/web/signature.test.ts
git commit -m "feat: verify HMAC webhook trên raw bytes, timing-safe"
```

---

### Task 19: Parser text → options

Schema lấy từ `command.data.toJSON()` nên không thể lệch khỏi định nghĩa Discord.

**Files:**
- Create: `src/messenger/parse-command.ts`
- Test: `tests/messenger/parse-command.test.ts`

**Interfaces:**
- Consumes: `Command` từ `src/bot/types.ts`, `allCommands()` từ `src/bot/commands/index.ts`
- Produces: `OPTION_TYPE = { STRING: 3, INTEGER: 4, CHANNEL: 7 }`; `type ParseResult = { ok: true; commandName: string; strings: Map<string, string>; integers: Map<string, number> } | { ok: false; kind: 'unknown-command' | 'bad-argument'; message: string }`; `parseCommandText(text: string, commands: readonly Command[]): ParseResult`; `helpText(commands: readonly Command[], isAdmin: boolean): string`

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/messenger/parse-command.test.ts
import { describe, expect, it } from 'bun:test'
import { allCommands } from '../../src/bot/commands/index.js'
import { helpText, parseCommandText } from '../../src/messenger/parse-command.js'

const COMMANDS = allCommands()

function parse(text: string) {
  return parseCommandText(text, COMMANDS)
}

describe('parseCommandText', () => {
  it('lệnh không tham số', () => {
    const result = parse('status')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.commandName).toBe('status')
    expect(result.strings.size).toBe(0)
  })

  it('prefix / là tuỳ chọn', () => {
    expect(parse('/status').ok).toBe(true)
    expect(parse('status').ok).toBe(true)
  })

  it('không phân biệt hoa thường ở tên lệnh', () => {
    expect(parse('STATUS').ok).toBe(true)
  })

  it('positional theo đúng thứ tự khai báo trong builder', () => {
    const result = parse('add api https://x.dev')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strings.get('name')).toBe('api')
    expect(result.strings.get('url')).toBe('https://x.dev')
  })

  it('dạng key=value cho option tuỳ chọn', () => {
    const result = parse('add api https://x.dev interval=30 timeout=5000')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.integers.get('interval')).toBe(30)
    expect(result.integers.get('timeout')).toBe(5_000)
  })

  it('URL có dấu = trong query không bị hiểu là key=value', () => {
    const result = parse('add api https://x.dev/h?token=abc')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strings.get('url')).toBe('https://x.dev/h?token=abc')
  })

  it('integer sai thì báo lỗi rõ ràng, không im lặng thành null', () => {
    const result = parse('pause api abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('bad-argument')
    expect(result.message).toContain('minutes')
  })

  it('thiếu option bắt buộc thì báo tên nó', () => {
    const result = parse('add')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('name')
  })

  it('thừa tham số vị trí thì báo lỗi', () => {
    const result = parse('status a b c d e')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('bad-argument')
  })

  it('option kiểu channel không chiếm slot positional', () => {
    // /add có 6 option, option cuối là channel. 5 positional phải khớp hết 5 option
    // không phải channel, không lỗi thừa tham số.
    const result = parse('add api https://x.dev 30 5000 800')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.integers.get('latency')).toBe(800)
  })

  it('lệnh lạ thì trả kind unknown-command', () => {
    const result = parse('khongtontai')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('unknown-command')
  })

  it('text rỗng thì trả unknown-command', () => {
    const result = parse('   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('unknown-command')
  })
})

describe('helpText', () => {
  it('không phải admin thì không thấy lệnh admin', () => {
    const text = helpText(COMMANDS, false)
    expect(text).toContain('status')
    expect(text).not.toContain('add ')
    expect(text).not.toContain('remove')
  })

  it('admin thì thấy đủ', () => {
    const text = helpText(COMMANDS, true)
    expect(text).toContain('status')
    expect(text).toContain('add')
    expect(text).toContain('pause')
  })
})
```

Nếu tên option của `/pause` không phải `minutes`, sửa test theo tên thật trong
`src/bot/commands/pause.ts` — đừng đổi code cho khớp test sai.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/messenger/parse-command.test.ts`
Expected: FAIL — không resolve được `parse-command.js`

- [ ] **Step 3: Viết `parse-command.ts`**

```ts
// src/messenger/parse-command.ts
import type { Command } from '../bot/types.js'

/** Trùng ApplicationCommandOptionType của discord.js. */
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
    // Chỉ coi là key=value khi key trùng một option thật — nếu không thì URL có
    // "?token=abc" sẽ bị hiểu sai thành tham số tên token.
    if (key !== undefined && specs.some((spec) => spec.name === key)) {
      named.set(key, match?.[2] ?? '')
    } else {
      positional.push(token)
    }
  }

  // Channel không truyền được qua Messenger nên không chiếm slot positional.
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
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/messenger/parse-command.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/messenger/parse-command.ts tests/messenger/parse-command.test.ts
git commit -m "feat: parser lệnh text lấy schema từ SlashCommandBuilder"
```

---

### Task 20: Adapter `InteractionLike` cho Messenger

Đây là chỗ trả lời cho Phát hiện 2 của spec: adapter này làm cả 9 lệnh chạy được trên
Messenger mà **không sửa file lệnh nào**.

**Files:**
- Create: `src/messenger/interaction.ts`
- Test: `tests/messenger/interaction.test.ts`

**Interfaces:**
- Consumes: `InteractionLike`/`InteractionReply` từ `src/bot/types.ts`, `embedToText`/`splitForMessenger`/`stripMarkdown` từ Task 12
- Produces: `makeMessengerInteraction(deps: { commandName: string; psid: string; strings: ReadonlyMap<string, string>; integers: ReadonlyMap<string, number>; send(texts: readonly string[]): Promise<void>; typing(): Promise<void> }): InteractionLike`

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/messenger/interaction.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { addCommand } from '../../src/bot/commands/add.js'
import { statusCommand } from '../../src/bot/commands/status.js'
import type { CommandContext } from '../../src/bot/types.js'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeMessengerInteraction } from '../../src/messenger/interaction.js'
import { makeTestContext, TEST_NOW } from '../helpers/context.js'

function harness(
  commandName: string,
  strings: Record<string, string> = {},
  integers: Record<string, number> = {},
) {
  const sent: string[] = []
  let typingCount = 0
  const interaction = makeMessengerInteraction({
    commandName,
    psid: 'psid-1',
    strings: new Map(Object.entries(strings)),
    integers: new Map(Object.entries(integers)),
    send: async (texts) => {
      sent.push(...texts)
    },
    typing: async () => {
      typingCount += 1
    },
  })
  return { interaction, sent, typing: () => typingCount }
}

let context: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  context = makeTestContext(db)
})

describe('makeMessengerInteraction', () => {
  it('khớp hình dạng InteractionLike', () => {
    const { interaction } = harness('status')
    expect(interaction.commandName).toBe('status')
    expect(interaction.user.id).toBe('psid-1')
    expect(interaction.options.getChannel('channel')).toBeNull()
  })

  it('getString và getInteger đọc từ map, thiếu thì null', () => {
    const { interaction } = harness('add', { name: 'api' }, { interval: 30 })
    expect(interaction.options.getString('name')).toBe('api')
    expect(interaction.options.getString('url')).toBeNull()
    expect(interaction.options.getInteger('interval')).toBe(30)
    expect(interaction.options.getInteger('timeout')).toBeNull()
  })

  it('deferReply gửi typing chứ không gửi tin', async () => {
    const { interaction, sent, typing } = harness('check')
    await interaction.deferReply()
    expect(typing()).toBe(1)
    expect(sent).toEqual([])
  })

  it('bỏ markdown Discord khỏi content', async () => {
    const { interaction, sent } = harness('status')
    await interaction.reply({ content: '**web** — `UP`' })
    expect(sent).toEqual(['web — UP'])
  })

  it('bỏ qua flag EPHEMERAL thay vì làm hỏng tin', async () => {
    const { interaction, sent } = harness('status')
    await interaction.reply({ content: 'riêng tư', flags: 64 })
    expect(sent).toEqual(['riêng tư'])
  })

  it('render được embeds — cả EmbedBuilder lẫn APIEmbed thuần', async () => {
    const { interaction, sent } = harness('check')
    await interaction.editReply({
      embeds: [
        { toJSON: () => ({ title: 'từ builder', description: 'd1' }) },
        { title: 'thuần', description: 'd2' },
      ],
    })
    expect(sent.join('\n')).toContain('từ builder')
    expect(sent.join('\n')).toContain('thuần')
  })

  it('payload rỗng thì không gửi gì', async () => {
    const { interaction, sent } = harness('status')
    await interaction.reply({})
    expect(sent).toEqual([])
  })

  // Hai test dưới là bằng chứng tái dùng được, không chỉ là tuyên bố.
  it('chạy thật statusCommand qua adapter', async () => {
    context.targets.create({
      name: 'web',
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: TEST_NOW,
    })
    const { interaction, sent } = harness('status')
    await statusCommand.execute(context, interaction)

    expect(sent.join('\n')).toContain('web')
    expect(sent.join('\n')).not.toContain('**')
  })

  it('chạy thật addCommand qua adapter, không có channel', async () => {
    const { interaction, sent } = harness('add', { name: 'api', url: 'https://b.test' })
    await addCommand.execute(context, interaction)

    const target = context.targets.findByName('api')
    expect(target?.url).toBe('https://b.test')
    expect(target?.createdBy).toBe('psid-1')
    expect(context.destinations.listForTarget(target!.id)).toEqual([])
    expect(sent.join('\n')).toContain('api')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/messenger/interaction.test.ts`
Expected: FAIL — không resolve được `interaction.js`

- [ ] **Step 3: Viết `interaction.ts`**

```ts
// src/messenger/interaction.ts
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

/**
 * EmbedBuilder có toJSON(); APIEmbed thuần đã đúng hình dạng. Nhận cả hai để
 * /check không phải sửa gì.
 */
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
      // Messenger không có channel. /add từ đây dùng destination mặc định.
      getChannel: () => null,
    },
    // flags (kể cả EPHEMERAL = 64) vô nghĩa trên Messenger nên bị bỏ qua.
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
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/messenger/interaction.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/messenger/interaction.ts tests/messenger/interaction.test.ts
git commit -m "feat: adapter InteractionLike cho Messenger, tái dùng cả 9 lệnh"
```

---

### Task 21: Router nhận `isAdmin` thay vì đọc `adminUserIds`

PSID nằm ở không gian định danh khác Discord id, nên router không thể dùng chung một
danh sách. Tách nó thành hàm inject để mỗi nền tảng có một router instance riêng — việc
đó cũng tách luôn map `runningCommandsByUser`, chặn PSID trùng Discord id.

**Files:**
- Modify: `src/bot/router.ts`
- Test: `tests/bot/router.test.ts`

**Interfaces:**
- Consumes: không có gì mới
- Produces: `RouterDeps` bỏ `config: Pick<AppConfig, 'adminUserIds'>`, thêm `isAdmin: (userId: string) => boolean`. `src/bot/permissions.ts` không đổi.

- [ ] **Step 1: Sửa test hiện có và thêm test mới**

Trong `tests/bot/router.test.ts`, mọi chỗ dựng router đổi từ
`config: { adminUserIds: ['admin-1'] }` sang `isAdmin: (id) => id === 'admin-1'`. Thêm:

```ts
it('hai router instance không dùng chung khoá chống chạy trùng', async () => {
  let running = 0
  const slow: Command = {
    name: 'slow',
    adminOnly: false,
    data: { name: 'slow', toJSON: () => ({ name: 'slow' }) },
    async execute() {
      running += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
  }

  const discord = makeRouter({
    commands: [slow],
    ctx,
    isAdmin: () => true,
    logger: silentLogger,
  })
  const messenger = makeRouter({
    commands: [slow],
    ctx,
    isAdmin: () => true,
    logger: silentLogger,
  })

  // Cùng chuỗi id trên hai nền tảng khác nhau, phải chạy được cả hai.
  await Promise.all([
    discord.handle(interactionFor('slow', '12345')),
    messenger.handle(interactionFor('slow', '12345')),
  ])

  expect(running).toBe(2)
})
```

`interactionFor(commandName, userId)` là helper đã có trong file đó — nếu chưa có thì dựng
theo đúng khuôn các test khác trong cùng file.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/bot/router.test.ts`
Expected: FAIL — `makeRouter` vẫn đòi `config`

- [ ] **Step 3: Sửa `router.ts`**

Bỏ `import { isAdmin } from './permissions.js'` và `import type { AppConfig }`. Đổi:

```ts
export type RouterDeps = {
  commands: readonly Command[]
  ctx: CommandContext
  /** Quyền admin theo không gian định danh của nền tảng đang gọi. */
  isAdmin: (userId: string) => boolean
  logger: Logger
}
```

và dòng kiểm quyền:

```ts
      if (command.adminOnly && !deps.isAdmin(interaction.user.id)) {
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/bot/`
Expected: FAIL ở `src/index.ts` chưa cập nhật là bình thường — `tests/` không typecheck.
Test phải PASS.

- [ ] **Step 5: Cập nhật `src/index.ts` cho khớp**

```ts
  const router = makeRouter({
    commands: allCommands(),
    ctx: { targets, checks, incidents, destinations, runner, config, clock, logger },
    isAdmin: (userId) => isAdmin(userId, config),
    logger,
  })
```

Thêm `import { isAdmin } from './bot/permissions.js'`.

- [ ] **Step 6: Chạy test và typecheck**

Run: `bun run typecheck && bun test`
Expected: cả hai xanh

- [ ] **Step 7: Commit**

```bash
git add src/bot/router.ts src/index.ts tests/bot/router.test.ts
git commit -m "refactor: router nhận isAdmin thay vì đọc danh sách Discord id"
```

---

### Task 22: Xử lý event webhook

Bốn chốt bắt buộc, mỗi cái tương ứng một lỗi thật nếu bỏ: lọc `is_echo`, dedupe `mid`,
cập nhật `last_inbound_at` rồi flush, và chặn PSID chưa link không chạy được lệnh.

**Files:**
- Create: `src/messenger/handle-event.ts`
- Test: `tests/messenger/handle-event.test.ts`

**Interfaces:**
- Consumes: `MessengerRepo` từ Task 13, `MessengerFlusher` từ Task 17, `MessengerClient` từ Task 15, `DestinationsRepo` từ Task 3, `Router` từ Task 21, `parseCommandText`/`helpText` từ Task 19, `makeMessengerInteraction` từ Task 20
- Produces: `type MessengerEventHandler = { handle(payload: unknown): Promise<void> }`; `makeMessengerEventHandler(deps: { messenger: MessengerRepo; destinations: DestinationsRepo; flusher: MessengerFlusher; client: MessengerClient; router: Router; commands: readonly Command[]; adminUserIds: readonly string[]; clock: Clock; logger: Logger }): MessengerEventHandler`

- [ ] **Step 1: Viết test thất bại**

```ts
// tests/messenger/handle-event.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { allCommands } from '../../src/bot/commands/index.js'
import { makeRouter } from '../../src/bot/router.js'
import type { CommandContext } from '../../src/bot/types.js'
import { openTestDb } from '../../src/db/connection.js'
import { makeMessengerRepo, type MessengerRepo } from '../../src/db/messenger.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeMessengerEventHandler } from '../../src/messenger/handle-event.js'
import type { MessengerClient } from '../../src/notify/messenger-client.js'
import { silentLogger } from '../../src/shared/logger.js'
import { makeTestContext, TEST_NOW } from '../helpers/context.js'

const NOW = new Date('2026-08-26T12:00:00.000Z')

function pageEvent(psid: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    object: 'page',
    entry: [
      {
        messaging: [{ sender: { id: psid }, message: { mid: `m-${text}`, text, ...extra } }],
      },
    ],
  }
}

describe('makeMessengerEventHandler', () => {
  let context: CommandContext
  let messenger: MessengerRepo
  let sent: string[]
  let flushed: string[]
  let client: MessengerClient

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    context = makeTestContext(db)
    messenger = makeMessengerRepo(db)
    sent = []
    flushed = []
    client = {
      async sendText(_psid, text) {
        sent.push(text)
      },
      async sendTyping() {},
    }
  })

  function handler(adminUserIds: readonly string[] = ['d-admin']) {
    const commands = allCommands()
    return makeMessengerEventHandler({
      messenger,
      destinations: context.destinations,
      flusher: {
        async flush(psid) {
          flushed.push(psid)
        },
      },
      client,
      router: makeRouter({
        commands,
        ctx: context,
        isAdmin: (psid) => messenger.findIdentity(psid)?.isAdmin === true,
        logger: silentLogger,
      }),
      commands,
      adminUserIds,
      clock: () => NOW,
      logger: silentLogger,
    })
  }

  it('bỏ qua payload không phải object page', async () => {
    await handler().handle({ object: 'instagram', entry: [] })
    expect(sent).toEqual([])
  })

  it('bỏ qua tin echo do chính Page gửi', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'status', { is_echo: true }))
    expect(sent).toEqual([])
  })

  it('dedupe theo mid — event lặp không chạy lệnh lần hai', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    const h = handler()
    await h.handle(pageEvent('p1', 'add', {}))
    const first = sent.length
    await h.handle(pageEvent('p1', 'add', {}))
    expect(sent.length).toBe(first)
  })

  it('cập nhật last_inbound_at rồi flush outbox', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'status'))

    expect(messenger.findIdentity('p1')?.lastInboundAt).toBe(NOW.toISOString())
    expect(flushed).toEqual(['p1'])
  })

  it('PSID chưa link thì được hướng dẫn, KHÔNG chạy lệnh nào', async () => {
    await handler().handle(pageEvent('p-lạ', 'add api https://x.dev'))

    expect(context.targets.findAll()).toEqual([])
    expect(sent.join('\n')).toMatch(/messenger-link/)
  })

  it('nhắn link code thì liên kết, cấp quyền theo Discord id, và tạo destination', async () => {
    messenger.createLinkCode({
      code: 'ABC12345',
      discordUserId: 'd-admin',
      expiresAtIso: '2026-08-26T12:10:00.000Z',
    })

    await handler().handle(pageEvent('p1', 'ABC12345'))

    expect(messenger.findIdentity('p1')).toMatchObject({
      discordUserId: 'd-admin',
      isAdmin: true,
    })
    expect(context.destinations.listGlobal()).toMatchObject([
      { provider: 'messenger', address: 'p1' },
    ])
    expect(sent.join('\n')).toMatch(/liên kết/i)
  })

  it('link code của người không phải admin thì không được quyền admin', async () => {
    messenger.createLinkCode({
      code: 'ABC12345',
      discordUserId: 'd-thường',
      expiresAtIso: '2026-08-26T12:10:00.000Z',
    })

    await handler().handle(pageEvent('p1', 'abc12345'))
    expect(messenger.findIdentity('p1')?.isAdmin).toBe(false)
  })

  it('lệnh admin từ PSID không phải admin bị chặn', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-thường', isAdmin: false, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'add api https://x.dev'))

    expect(context.targets.findAll()).toEqual([])
    expect(sent.join('\n')).toMatch(/không có quyền/i)
  })

  it('lệnh lạ thì trả danh sách lệnh theo quyền người gửi', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-thường', isAdmin: false, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'khongtontai'))

    const text = sent.join('\n')
    expect(text).toContain('status')
    expect(text).not.toContain('remove')
  })

  it('tham số sai thì báo lỗi cụ thể chứ không trả help', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'pause api abc'))
    expect(sent.join('\n')).toMatch(/số nguyên/)
  })

  it('lệnh chạy thật: add rồi status', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    const h = handler()
    await h.handle(pageEvent('p1', 'add api https://x.dev'))
    expect(context.targets.findByName('api')).not.toBeNull()

    sent.length = 0
    await h.handle(pageEvent('p1', 'status'))
    expect(sent.join('\n')).toContain('api')
  })

  it('tin không có text (sticker, ảnh) thì bỏ qua', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle({
      object: 'page',
      entry: [{ messaging: [{ sender: { id: 'p1' }, message: { mid: 'm1' } }] }],
    })
    expect(sent).toEqual([])
  })

  it('một event lỗi không chặn event còn lại trong cùng batch', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle({
      object: 'page',
      entry: [
        { messaging: [{ sender: {}, message: { mid: 'm-thiếu-psid', text: 'status' } }] },
        { messaging: [{ sender: { id: 'p1' }, message: { mid: 'm-ok', text: 'status' } }] },
      ],
    })
    expect(sent.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test tests/messenger/handle-event.test.ts`
Expected: FAIL — không resolve được `handle-event.js`

- [ ] **Step 3: Viết `handle-event.ts`**

```ts
// src/messenger/handle-event.ts
import type { Router } from '../bot/router.js'
import type { Command } from '../bot/types.js'
import type { DestinationsRepo } from '../db/destinations.repo.js'
import type { MessengerRepo } from '../db/messenger.repo.js'
import type { MessengerClient } from '../notify/messenger-client.js'
import type { MessengerFlusher } from '../notify/messenger-flush.js'
import { splitForMessenger } from '../notify/messenger-text.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import { makeMessengerInteraction } from './interaction.js'
import { helpText, parseCommandText } from './parse-command.js'

export type MessengerEventHandler = {
  handle(payload: unknown): Promise<void>
}

export type MessengerEventDeps = {
  messenger: MessengerRepo
  destinations: DestinationsRepo
  flusher: MessengerFlusher
  client: MessengerClient
  router: Router
  commands: readonly Command[]
  adminUserIds: readonly string[]
  clock: Clock
  logger: Logger
}

type MessagingEvent = {
  sender?: { id?: string }
  message?: { mid?: string; text?: string; is_echo?: boolean }
}

type WebhookBody = {
  object?: string
  entry?: Array<{ messaging?: MessagingEvent[] }>
}

export function makeMessengerEventHandler(deps: MessengerEventDeps): MessengerEventHandler {
  async function send(psid: string, texts: readonly string[]): Promise<void> {
    for (const text of texts) {
      await deps.client.sendText(psid, text)
    }
  }

  async function handleOne(event: MessagingEvent): Promise<void> {
    const psid = event.sender?.id
    const message = event.message
    if (psid === undefined || message === undefined) return

    // Tin do chính Page gửi cũng vào webhook — không bỏ thì bot tự trả lời chính nó.
    if (message.is_echo === true) return

    const nowIso = deps.clock().toISOString()

    // Meta retry khi không nhận được 200 kịp; không dedupe thì một lệnh chạy hai lần.
    if (message.mid !== undefined && !deps.messenger.markMidSeen(message.mid, nowIso)) return

    const text = (message.text ?? '').trim()
    if (text.length === 0) return

    const identity = deps.messenger.findIdentity(psid)
    if (identity !== null) {
      // Đây chính là lúc cửa sổ 24h mở lại.
      deps.messenger.touchInbound(psid, nowIso)
      await deps.flusher.flush(psid)
    }

    const consumed = deps.messenger.consumeLinkCode(text.toUpperCase(), nowIso)
    if (consumed !== null) {
      const grantAdmin = deps.adminUserIds.includes(consumed.discordUserId)
      deps.messenger.link({
        psid,
        discordUserId: consumed.discordUserId,
        isAdmin: grantAdmin,
        atIso: nowIso,
      })
      deps.destinations.add({
        targetId: null,
        provider: 'messenger',
        address: psid,
        createdAt: nowIso,
      })
      await send(psid, [
        'Đã liên kết thành công. Từ giờ bạn sẽ nhận alert ở đây.',
        helpText(deps.commands, grantAdmin),
      ])
      return
    }

    if (identity === null) {
      await send(psid, [
        'Chưa liên kết. Chạy /messenger-link trên Discord để lấy mã, rồi nhắn mã đó vào đây.',
      ])
      return
    }

    const parsed = parseCommandText(text, deps.commands)
    if (!parsed.ok) {
      const body =
        parsed.kind === 'unknown-command'
          ? `${parsed.message}\n\n${helpText(deps.commands, identity.isAdmin)}`
          : parsed.message
      await send(psid, splitForMessenger(body))
      return
    }

    await deps.router.handle(
      makeMessengerInteraction({
        commandName: parsed.commandName,
        psid,
        strings: parsed.strings,
        integers: parsed.integers,
        send: (texts) => send(psid, texts),
        typing: () => deps.client.sendTyping(psid),
      }),
    )
  }

  return {
    async handle(payload) {
      const body = payload as WebhookBody
      if (body.object !== 'page') return

      for (const entry of body.entry ?? []) {
        for (const event of entry.messaging ?? []) {
          try {
            await handleOne(event)
          } catch (error) {
            // Một event lỗi không được chặn event còn lại trong cùng batch.
            deps.logger.error('Xử lý một event Messenger thất bại', error)
          }
        }
      }
    },
  }
}
```

- [ ] **Step 4: Chạy test**

Run: `bun test tests/messenger/`
Expected: PASS

- [ ] **Step 5: Typecheck rồi commit**

```bash
bun run typecheck
git add src/messenger/handle-event.ts tests/messenger/handle-event.test.ts
git commit -m "feat: xử lý event webhook Messenger"
```

---

### Task 23: Webhook và HTTP server bằng Elysia

**Files:**
- Modify: `package.json` (thêm `elysia`)
- Create: `src/web/messenger-webhook.ts`
- Create: `src/web/server.ts`
- Test: `tests/web/webhook.test.ts`

**Interfaces:**
- Consumes: `verifySignature` từ Task 18, `MessengerEventHandler` từ Task 22
- Produces: `makeMessengerWebhook(deps: { path: string; verifyToken: string; appSecret: string; logger: Logger; handleEvent(payload: unknown): Promise<void> }): Elysia`; `type WebServer = { stop(): Promise<void> }`; `startWebServer(deps: { port: number; webhook: Elysia; logger: Logger }): WebServer`

**Chệch khỏi spec có chủ đích:** spec nói dùng `t.Object` để Elysia tự trả 400 khi thiếu
field `hub.*`. Dùng `t.Optional` cộng nhánh 403 tường minh, vì mã lỗi validation của Elysia
là 422 chứ không phải 400, và ta muốn hành vi test được chính xác thay vì phụ thuộc mã lỗi
mặc định của framework.

- [ ] **Step 1: Cài dependency**

```bash
bun add elysia
```

- [ ] **Step 2: Viết test thất bại**

```ts
// tests/web/webhook.test.ts
import crypto from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { silentLogger } from '../../src/shared/logger.js'
import { makeMessengerWebhook } from '../../src/web/messenger-webhook.js'

const PATH = '/webhook/messenger'
const SECRET = 'app-secret'
const VERIFY = 'verify-token'
const BASE = 'http://localhost'

function app(handleEvent: (payload: unknown) => Promise<void> = async () => {}) {
  return makeMessengerWebhook({
    path: PATH,
    verifyToken: VERIFY,
    appSecret: SECRET,
    logger: silentLogger,
    handleEvent,
  })
}

function signed(bodyText: string, secret = SECRET): Request {
  const raw = new TextEncoder().encode(bodyText)
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`
  return new Request(`${BASE}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body: bodyText,
  })
}

describe('GET verify', () => {
  it('token đúng thì trả challenge', async () => {
    const url = `${BASE}${PATH}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=xyz123`
    const response = await app().handle(new Request(url))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('xyz123')
  })

  it('token sai thì 403 và không trả challenge', async () => {
    const url = `${BASE}${PATH}?hub.mode=subscribe&hub.verify_token=sai&hub.challenge=xyz123`
    const response = await app().handle(new Request(url))

    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('xyz123')
  })

  it('thiếu hub.mode thì 403, không phải 200', async () => {
    const response = await app().handle(new Request(`${BASE}${PATH}`))
    expect(response.status).toBe(403)
  })
})

describe('POST event', () => {
  it('signature đúng thì 200 và gọi handler', async () => {
    const seen: unknown[] = []
    const response = await app(async (payload) => {
      seen.push(payload)
    }).handle(signed('{"object":"page","entry":[]}'))

    expect(response.status).toBe(200)
    // Handler chạy async sau khi trả 200 — nhường một tick cho nó.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(seen).toEqual([{ object: 'page', entry: [] }])
  })

  it('signature sai thì 401 và KHÔNG gọi handler', async () => {
    let called = false
    const response = await app(async () => {
      called = true
    }).handle(signed('{"object":"page"}', 'secret-khác'))

    expect(response.status).toBe(401)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(called).toBe(false)
  })

  it('thiếu header signature thì 401', async () => {
    const response = await app().handle(
      new Request(`${BASE}${PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(response.status).toBe(401)
  })

  it('signature đúng nhưng body không phải JSON thì 400', async () => {
    const response = await app().handle(signed('{ không phải json'))
    expect(response.status).toBe(400)
  })

  it('handler throw không làm response khác 200', async () => {
    const response = await app(async () => {
      throw new Error('nổ trong handler')
    }).handle(signed('{"object":"page","entry":[]}'))

    expect(response.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 5))
  })

  it('trả 200 trước khi handler xong', async () => {
    let finished = false
    const response = await app(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      finished = true
    }).handle(signed('{"object":"page","entry":[]}'))

    expect(response.status).toBe(200)
    // Chốt quan trọng: Meta timeout ~20s, nên response không được chờ handler.
    expect(finished).toBe(false)
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận fail**

Run: `bun test tests/web/webhook.test.ts`
Expected: FAIL — không resolve được `messenger-webhook.js`

- [ ] **Step 4: Viết `messenger-webhook.ts`**

```ts
// src/web/messenger-webhook.ts
import { Elysia, t } from 'elysia'
import type { Logger } from '../shared/logger.js'
import { verifySignature } from './signature.js'

export type MessengerWebhookDeps = {
  path: string
  verifyToken: string
  appSecret: string
  logger: Logger
  handleEvent(payload: unknown): Promise<void>
}

export function makeMessengerWebhook(deps: MessengerWebhookDeps) {
  return new Elysia({ name: 'messenger-webhook' })
    .get(
      deps.path,
      ({ query, status }) => {
        if (
          query['hub.mode'] === 'subscribe' &&
          query['hub.verify_token'] === deps.verifyToken
        ) {
          return query['hub.challenge'] ?? ''
        }
        return status(403, 'Forbidden')
      },
      {
        query: t.Object({
          'hub.mode': t.Optional(t.String()),
          'hub.verify_token': t.Optional(t.String()),
          'hub.challenge': t.Optional(t.String()),
        }),
      },
    )
    .post(
      deps.path,
      async ({ request, headers, status }) => {
        // Body của Web Standard Request chỉ đọc được một lần, và HMAC phải tính
        // trên byte gốc — nên parse: 'none' bên dưới là bắt buộc, không phải tối ưu.
        const raw = new Uint8Array(await request.arrayBuffer())

        if (!verifySignature(raw, headers['x-hub-signature-256'], deps.appSecret)) {
          deps.logger.warn('Webhook Messenger: signature không hợp lệ')
          return status(401, 'Unauthorized')
        }

        let payload: unknown
        try {
          payload = JSON.parse(new TextDecoder().decode(raw))
        } catch {
          return status(400, 'Bad Request')
        }

        // Trả 200 trước khi xử lý: Meta timeout khoảng 20 giây và sẽ vô hiệu hoá
        // webhook nếu chậm liên tục, trong khi một lệnh check có thể lâu hơn thế.
        void deps
          .handleEvent(payload)
          .catch((error) => deps.logger.error('Xử lý webhook thất bại', error))

        return 'EVENT_RECEIVED'
      },
      { parse: 'none' },
    )
}
```

- [ ] **Step 5: Viết `server.ts`**

```ts
// src/web/server.ts
import type { Elysia } from 'elysia'
import { Elysia as ElysiaApp } from 'elysia'
import type { Logger } from '../shared/logger.js'

export type WebServer = { stop(): Promise<void> }

export type WebServerDeps = {
  port: number
  webhook: Elysia
  logger: Logger
}

export function startWebServer(deps: WebServerDeps): WebServer {
  const app = new ElysiaApp({ serve: { hostname: '0.0.0.0' } })
    .get('/healthz', () => 'ok')
    .use(deps.webhook)

  app.listen(deps.port)
  deps.logger.info(`HTTP server nghe trên 0.0.0.0:${deps.port}`)

  return {
    async stop() {
      await app.stop()
    },
  }
}
```

Chữ ký chính xác của `app.stop()` chưa xác nhận từ docs. Chạy `bun run typecheck` ngay sau
khi viết file này. Nếu nó không phải hàm async không tham số, đọc
`node_modules/elysia/dist/index.d.ts` tìm `stop` và sửa cho khớp — **đừng** bọc try/catch để
che lỗi kiểu.

- [ ] **Step 6: Chạy test**

Run: `bun test tests/web/ && bun run typecheck`
Expected: PASS cả hai

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock src/web/messenger-webhook.ts src/web/server.ts tests/web/webhook.test.ts
git commit -m "feat: webhook Messenger và HTTP server bằng Elysia"
```

---

### Task 24: Lệnh `/messenger-link` và `/messenger-unlink`

**Files:**
- Modify: `src/bot/types.ts` (thêm `messenger` vào `CommandContext`)
- Modify: `tests/helpers/context.ts`
- Create: `src/bot/commands/messenger.ts`
- Modify: `src/bot/commands/index.ts`
- Test: `tests/bot/commands/messenger.test.ts`

**Interfaces:**
- Consumes: `MessengerRepo` từ Task 13
- Produces: `CommandContext` có thêm `messenger: MessengerRepo`; `messengerLinkCommand` và `messengerUnlinkCommand` — cả hai `adminOnly === true`. `LINK_CODE_TTL_MS = 10 * 60 * 1000`

- [ ] **Step 1: Thêm `messenger` vào `CommandContext` và helper**

Trong `src/bot/types.ts` thêm import `MessengerRepo` và field `messenger: MessengerRepo`.

Trong `tests/helpers/context.ts` thêm import `makeMessengerRepo` và
`messenger: makeMessengerRepo(db),` vào object trả về. Đây là lợi ích của Task 5 — chỉ sửa
một chỗ thay vì sáu.

- [ ] **Step 2: Viết test thất bại**

```ts
// tests/bot/commands/messenger.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  LINK_CODE_TTL_MS,
  messengerLinkCommand,
  messengerUnlinkCommand,
} from '../../../src/bot/commands/messenger.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeTestContext, TEST_NOW } from '../../helpers/context.js'

function interaction(commandName: string, options: Record<string, string> = {}) {
  const replies: InteractionReply[] = []
  const value: InteractionLike = {
    commandName,
    user: { id: 'd-admin' },
    options: {
      getString: (name) => options[name] ?? null,
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: async (p) => {
      replies.push(p)
      return {}
    },
    followUp: async (p) => {
      replies.push(p)
      return {}
    },
    deferReply: async () => ({}),
    editReply: async (p) => {
      replies.push(p)
      return {}
    },
  }
  return { interaction: value, replies }
}

let context: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  context = makeTestContext(db)
})

describe('/messenger-link', () => {
  it('là lệnh admin', () => {
    expect(messengerLinkCommand.adminOnly).toBe(true)
    expect(messengerUnlinkCommand.adminOnly).toBe(true)
  })

  it('phát code dùng được, gắn với Discord id của người gọi', async () => {
    const { interaction: v, replies } = interaction('messenger-link')
    await messengerLinkCommand.execute(context, v)

    const content = replies[0]?.content ?? ''
    const code = /`([A-Z0-9]{8})`/.exec(content)?.[1]
    expect(code).toBeDefined()

    expect(context.messenger.consumeLinkCode(code!, TEST_NOW)).toEqual({
      discordUserId: 'd-admin',
    })
  })

  it('trả lời dạng ephemeral để code không lộ ra channel', async () => {
    const { interaction: v, replies } = interaction('messenger-link')
    await messengerLinkCommand.execute(context, v)
    expect(replies[0]?.flags).toBe(64)
  })

  it('code hết hạn sau đúng TTL', async () => {
    const { interaction: v, replies } = interaction('messenger-link')
    await messengerLinkCommand.execute(context, v)
    const code = /`([A-Z0-9]{8})`/.exec(replies[0]?.content ?? '')?.[1]

    const justAfter = new Date(Date.parse(TEST_NOW) + LINK_CODE_TTL_MS + 1_000).toISOString()
    expect(context.messenger.consumeLinkCode(code!, justAfter)).toBeNull()
  })

  it('hai lần gọi sinh hai code khác nhau', async () => {
    const first = interaction('messenger-link')
    await messengerLinkCommand.execute(context, first.interaction)
    const second = interaction('messenger-link')
    await messengerLinkCommand.execute(context, second.interaction)

    expect(first.replies[0]?.content).not.toBe(second.replies[0]?.content)
  })
})

describe('/messenger-unlink', () => {
  it('bỏ liên kết và bỏ luôn destination của PSID đó', async () => {
    context.messenger.link({
      psid: 'p1',
      discordUserId: 'd-admin',
      isAdmin: true,
      atIso: TEST_NOW,
    })
    context.destinations.add({
      targetId: null,
      provider: 'messenger',
      address: 'p1',
      createdAt: TEST_NOW,
    })

    const { interaction: v, replies } = interaction('messenger-unlink', { psid: 'p1' })
    await messengerUnlinkCommand.execute(context, v)

    expect(context.messenger.findIdentity('p1')).toBeNull()
    expect(context.destinations.listGlobal()).toEqual([])
    expect(replies[0]?.content).toMatch(/đã bỏ/i)
  })

  it('PSID không tồn tại thì báo rõ', async () => {
    const { interaction: v, replies } = interaction('messenger-unlink', { psid: 'không-có' })
    await messengerUnlinkCommand.execute(context, v)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('thiếu psid thì báo bắt buộc', async () => {
    const { interaction: v, replies } = interaction('messenger-unlink')
    await messengerUnlinkCommand.execute(context, v)
    expect(replies[0]?.content).toMatch(/bắt buộc/i)
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận fail**

Run: `bun test tests/bot/commands/messenger.test.ts`
Expected: FAIL — không resolve được `messenger.js`

- [ ] **Step 4: Viết `messenger.ts`**

```ts
// src/bot/commands/messenger.ts
import crypto from 'node:crypto'
import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command } from '../types.js'

/** Code sống 10 phút — đủ để copy sang Messenger, đủ ngắn để không tồn đọng. */
export const LINK_CODE_TTL_MS = 10 * 60 * 1_000

function newCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

export const messengerLinkCommand: Command = {
  name: 'messenger-link',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('messenger-link')
    .setDescription('Phát mã để liên kết Messenger với quyền của bạn'),

  async execute(context, interaction) {
    const now = context.clock()
    const code = newCode()

    context.messenger.createLinkCode({
      code,
      discordUserId: interaction.user.id,
      expiresAtIso: new Date(now.getTime() + LINK_CODE_TTL_MS).toISOString(),
    })

    await interaction.reply({
      content: [
        `Mã liên kết của bạn: \`${code}\``,
        'Nhắn đúng mã này cho Facebook Page của bot trong 10 phút tới.',
        'Mã dùng được một lần và cấp quyền theo chính tài khoản Discord của bạn.',
      ].join('\n'),
      flags: EPHEMERAL,
    })
  },
}

export const messengerUnlinkCommand: Command = {
  name: 'messenger-unlink',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('messenger-unlink')
    .setDescription('Bỏ liên kết một PSID Messenger')
    .addStringOption((o) =>
      o.setName('psid').setDescription('PSID cần bỏ liên kết').setRequired(true),
    ),

  async execute(context, interaction) {
    const psid = interaction.options.getString('psid')
    if (!psid) {
      await interaction.reply({ content: '`psid` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const removed = context.messenger.unlink(psid)
    if (!removed) {
      await interaction.reply({
        content: `Không tìm thấy liên kết nào cho PSID \`${psid}\`.`,
        flags: EPHEMERAL,
      })
      return
    }

    // Bỏ luôn destination global của PSID đó, nếu không nó vẫn nhận alert.
    context.destinations.remove(null, 'messenger', psid)

    await interaction.reply({ content: `Đã bỏ liên kết PSID \`${psid}\`.` })
  },
}
```

- [ ] **Step 5: Đăng ký vào registry**

Trong `src/bot/commands/index.ts` thêm:

```ts
import { messengerLinkCommand, messengerUnlinkCommand } from './messenger.js'
```

và hai dòng vào mảng của `allCommands()`:

```ts
    messengerLinkCommand,
    messengerUnlinkCommand,
```

- [ ] **Step 6: Chạy test**

Run: `bun test`
Expected: PASS. `tests/bot/commands/registry.test.ts` nếu assert số lượng thì cập nhật từ 12 lên 14.

- [ ] **Step 7: Typecheck rồi commit**

```bash
bun run typecheck
git add src/bot/types.ts src/bot/commands/messenger.ts src/bot/commands/index.ts tests/
git commit -m "feat: lệnh phát mã liên kết Messenger và bỏ liên kết"
```

---

### Task 25: Lắp Messenger vào `src/index.ts`

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: mọi thứ từ Task 11–24
- Produces: app chạy được ở cả hai chế độ bật/tắt Messenger

- [ ] **Step 1: Thêm import**

```ts
import { makeMessengerRepo } from './db/messenger.repo.js'
import { makeOutboxRepo } from './db/outbox.repo.js'
import { makeMessengerEventHandler } from './messenger/handle-event.js'
import { makeMessengerClient } from './notify/messenger-client.js'
import { makeMessengerFlusher } from './notify/messenger-flush.js'
import { makeMessengerNotifier } from './notify/messenger-notifier.js'
import type { Notifier } from './notify/notifier.js'
import { makeMessengerWebhook } from './web/messenger-webhook.js'
import { startWebServer, type WebServer } from './web/server.js'
```

- [ ] **Step 2: Dựng repo và dọn seen mid lúc khởi động**

Cạnh `const destinations = makeDestinationsRepo(db)` thêm:

```ts
  const messengerRepo = makeMessengerRepo(db)
  const outbox = makeOutboxRepo(db)
```

Ngay sau khối dọn `checks` cũ đã có, thêm:

```ts
  const midCutoffIso = new Date(clock().getTime() - 24 * 60 * 60 * 1_000).toISOString()
  const removedMids = messengerRepo.deleteMidsOlderThan(midCutoffIso)
  if (removedMids > 0) logger.info(`Đã dọn ${removedMids} mid Messenger cũ`)
```

- [ ] **Step 3: Dựng notifier Messenger có điều kiện**

Thay khối dựng `dispatcher` và `routing` ở Task 10:

```ts
  const client = createClient()
  const messengerClient = config.messenger
    ? makeMessengerClient({
        pageAccessToken: config.messenger.pageAccessToken,
        apiVersion: config.messenger.apiVersion,
        logger,
      })
    : null

  const notifiers: Notifier[] = [makeDiscordNotifier({ client, logger })]
  if (messengerClient !== null) {
    notifiers.push(
      makeMessengerNotifier({
        client: messengerClient,
        messenger: messengerRepo,
        outbox,
        clock,
        logger,
      }),
    )
  }

  const dispatcher = makeDispatcher({ notifiers, logger })
  const routing = makeRouting({
    destinations,
    config,
    // Tắt Messenger thì không kéo PSID nào vào, kể cả identity còn tồn trong DB.
    messengerAdminPsids: () => (config.messenger ? messengerRepo.adminPsids() : []),
  })
```

`runner` và `digestJob` giữ nguyên như Task 10.

- [ ] **Step 4: Dựng router Discord và router Messenger**

```ts
  const commands = allCommands()
  const ctx = {
    targets,
    checks,
    incidents,
    destinations,
    messenger: messengerRepo,
    runner,
    config,
    clock,
    logger,
  }

  const discordRouter = makeRouter({
    commands,
    ctx,
    isAdmin: (userId) => isAdmin(userId, config),
    logger,
  })
```

Đổi handler interaction sang `discordRouter`:

```ts
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return
    void discordRouter.handle(interaction as unknown as InteractionLike)
  })
```

- [ ] **Step 5: Dựng HTTP server có điều kiện**

Sau khối router, trước `client.once(Events.ClientReady, ...)`:

```ts
  let webServer: WebServer | null = null
  if (config.messenger !== null && messengerClient !== null) {
    const messengerRouter = makeRouter({
      commands,
      ctx,
      isAdmin: (psid) => messengerRepo.findIdentity(psid)?.isAdmin === true,
      logger,
    })

    const eventHandler = makeMessengerEventHandler({
      messenger: messengerRepo,
      destinations,
      flusher: makeMessengerFlusher({
        client: messengerClient,
        outbox,
        targets,
        clock,
        logger,
        maxAgeHours: config.messenger.outboxMaxAgeHours,
      }),
      client: messengerClient,
      router: messengerRouter,
      commands,
      adminUserIds: config.adminUserIds,
      clock,
      logger,
    })

    webServer = startWebServer({
      port: config.messenger.port,
      webhook: makeMessengerWebhook({
        path: config.messenger.webhookPath,
        verifyToken: config.messenger.verifyToken,
        appSecret: config.messenger.appSecret,
        logger,
        handleEvent: (payload) => eventHandler.handle(payload),
      }),
      logger,
    })
    logger.info(`Messenger đang bật, webhook tại ${config.messenger.webhookPath}`)
  } else {
    logger.info('Messenger đang tắt')
  }
```

- [ ] **Step 6: Thêm vào `shutdown`**

Trong hàm `shutdown`, sau `scheduler.stop()`:

```ts
    if (webServer !== null) await webServer.stop()
```

- [ ] **Step 7: Chạy toàn bộ xác minh với Messenger tắt**

```bash
bun run typecheck
bun test
bun run db:drift
bun run db:migrate
bun src/index.ts
```
Expected: app chạy y hệt trước, log ghi "Messenger đang tắt", **không mở port nào**.
Kiểm tra bằng `netstat -ano | findstr :8080` — không được có gì.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts
git commit -m "feat: lắp provider Messenger vào entrypoint, tắt được bằng config"
```

---

### Task 26: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Thêm mục dựng Facebook App**

Chèn sau mục "Dựng bot trên Discord":

````markdown
## Dựng Page và App trên Facebook (chỉ khi bật Messenger)

1. Tạo Facebook Page cho bot nếu chưa có.
2. Vào <https://developers.facebook.com/apps>, tạo app loại **Business**.
3. Thêm sản phẩm **Messenger**. Ở mục **Access Tokens**, chọn Page vừa tạo và sinh
   **Page Access Token** → đặt vào `MESSENGER_PAGE_ACCESS_TOKEN`.
4. Tab **Settings → Basic**, copy **App Secret** → đặt vào `MESSENGER_APP_SECRET`.
5. Tự chọn một chuỗi bí mật bất kỳ cho `MESSENGER_VERIFY_TOKEN` — Meta chỉ dùng nó để
   xác nhận bạn sở hữu endpoint.
6. Trỏ domain của bạn về `MESSENGER_PORT` qua reverse proxy có TLS. Meta **không nhận**
   `ip:port` trần và **không nhận** self-signed cert.
7. Ở mục **Webhooks**, đặt callback URL là `https://domain-của-bạn/webhook/messenger`,
   verify token là giá trị bước 5, rồi subscribe field `messages` và `messaging_postbacks`.
8. Chạy `/messenger-link` trên Discord, nhắn mã nhận được cho Page.
````

- [ ] **Step 2: Bổ sung bảng slash command**

Thêm vào bảng "Slash command":

```markdown
| `/dest-list [name]` | mọi người | Xem nơi nhận alert |
| `/dest-add provider address [name]` | admin | Thêm nơi nhận alert |
| `/dest-remove provider address [name]` | admin | Bỏ nơi nhận alert |
| `/messenger-link` | admin | Phát mã liên kết Messenger |
| `/messenger-unlink psid` | admin | Bỏ liên kết một PSID |
```

- [ ] **Step 3: Thêm mục lệnh qua Messenger**

````markdown
## Lệnh qua Messenger

Cú pháp: tên lệnh, rồi tham số theo đúng thứ tự như slash command, cộng dạng `key=value`
cho phần tuỳ chọn. Prefix `/` cho phép chứ không bắt buộc.

```
status                      add api https://x.dev interval=30
uptime api 7d               pause api 60
```

Quyền admin trên Messenger cấp qua `/messenger-link`, không qua biến môi trường. Chiếm
được Facebook của admin là chiếm được quyền ghi — đây là đánh đổi có ý thức để đổi lấy
tiện lợi. Option kiểu channel không truyền được qua Messenger; `/add` từ đây dùng
destination mặc định.
````

- [ ] **Step 4: Thêm ràng buộc 24h vào mục "Hành vi"**

````markdown
- **Messenger là kênh best-effort, không phải kênh đảm bảo.** Meta chỉ cho gửi tin trong
  **24 giờ** kể từ tin nhắn cuối cùng bạn gửi cho Page. Ba message tag từng dùng để lách
  (`ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`) đã bị Meta bỏ từ
  27/04/2026, và recurring notifications bị tắt ngoài AU/EU/JP/KR/UK từ 10/02/2026. Nên
  nếu bạn không nhắn cho Page trong 24 giờ, alert sẽ **không tới** — nó được đẩy vào bảng
  `outbox` và gửi bù khi bạn nhắn lại. Đây là giới hạn nền tảng, không phải bug.
- Khi gửi bù mà bỏ lỡ quá 3 thông báo, bot gửi một tin gộp kèm **trạng thái hiện tại**
  thay vì dội lại từng alert cũ — lịch sử alert quá hạn dễ gây hiểu sai là đang DOWN.
- Alert quá `MESSENGER_OUTBOX_MAX_AGE_HOURS` (mặc định 48) bị bỏ, không gửi bù.
- Messenger API chỉ gửi được hội thoại 1:1 với Page, **không gửi được vào group chat**.
````

- [ ] **Step 5: Thêm mục destination**

````markdown
## Nơi nhận alert (destination)

Alert không còn gắn vào một channel duy nhất. Mỗi target có thể có nhiều destination, mỗi
destination là một cặp `(provider, address)` — `discord` thì address là channel ID,
`messenger` thì là PSID.

Quy tắc phân giải: lấy destination riêng của target trước; **với từng provider không có
destination riêng** thì lấy destination toàn cục của provider đó. Nghĩa là đặt channel
Discord riêng cho một target **không làm im Messenger**. Nếu target không có destination
nào và cũng không có destination toàn cục nào, alert về `DEFAULT_ALERT_CHANNEL_ID`.

Digest đi theo quy tắc khác: luôn vào `DIGEST_CHANNEL_ID`, cộng thêm mọi PSID Messenger
có quyền admin.
````

- [ ] **Step 6: Cập nhật mục Deploy**

Thêm vào mục Deploy:

````markdown
Bật Messenger thì app mở thêm một HTTP server ở `MESSENGER_PORT`. TLS do reverse proxy
bên ngoài lo — app chỉ serve HTTP trần trên `0.0.0.0`. Có `GET /healthz` trả `ok` để panel
hoặc proxy probe. Tắt Messenger (`MESSENGER_ENABLED=false`, mặc định) thì **không mở port
nào**.
````

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: hướng dẫn Messenger, destination, và ràng buộc 24h"
```

---

## Xác minh toàn bộ

Chạy sau khi hoàn tất mọi task:

1. `bun install` sạch (xoá `node_modules/` trước)
2. `bun run typecheck` — không lỗi
3. `bun test` — toàn bộ file xanh
4. `bun run db:drift` — schema khớp `drizzle/`
5. `bun run db:migrate` trên **bản copy DB thật** — kiểm tay rằng mọi
   `alert_channel_id` cũ đã thành row `destinations`, không mất destination nào:
   ```bash
   cp data/monitor.db /tmp/verify.db
   DB_PATH=/tmp/verify.db bun run db:migrate
   DB_PATH=/tmp/verify.db bun run db:studio   # đối chiếu bảng destinations
   ```
6. Smoke test `MESSENGER_ENABLED=false` — app chạy y hệt trước, không mở port
7. Smoke test `MESSENGER_ENABLED=true`:
   - Meta verify được webhook (nút Verify and Save ở tab Webhooks trả xanh)
   - `/messenger-link` rồi nhắn mã cho Page → link thành công, nhận được danh sách lệnh
   - `status` qua Messenger trả đúng, **không có** ký tự `**` hay backtick lọt ra
   - `add`, `pause`, `check` qua Messenger chạy đúng
   - Một alert thật tới **cả** Discord lẫn Messenger
   - Digest tới `DIGEST_CHANNEL_ID` và tới PSID admin
8. `bun run deploy-commands` để đăng ký 5 lệnh mới

Bước 5 và 7 không thể bỏ. Không test nào phủ được Meta thật gọi vào webhook thật, và
signature verification là chỗ sai thì im lặng 401 mà không ai biết. Backfill migration
cũng chỉ verify được trên dữ liệu thật.

## Rủi ro đã biết

1. **Ràng buộc 24h là rủi ro vận hành, không phải bug.** Discord phải giữ vai trò kênh
   đảm bảo. Nếu cần một kênh phụ *đáng tin*, Telegram không có ràng buộc này.
2. **Bề mặt tấn công tăng.** App mở HTTP server public và nhận lệnh admin từ một danh tính
   Facebook. Giảm nhẹ bằng: HMAC bắt buộc, PSID chưa link không chạy được lệnh nào,
   `is_admin` chỉ cấp qua link code phát từ một Discord admin, và link code hết hạn 10 phút
   dùng một lần.
3. **Link code là bearer token trong 10 phút.** Ai nhắn mã cho Page trước thì người đó
   được quyền. Chấp nhận được vì mã ephemeral và dùng một lần, nhưng đừng dán mã vào chỗ
   công khai.
4. **`is_admin` hiện luôn bằng 1** vì `/messenger-link` là lệnh admin-only. Điều kiện
   `is_admin = 1` ở `digestDestinations` và ở router Messenger vẫn viết tường minh, để
   ngày nào thêm đường link cho subscriber chỉ đọc thì quyền không âm thầm rò.
5. **Meta đã siết policy hai lần trong 2026.** Provider được cô lập sau `Notifier`, nên nếu
   Messenger chết hẳn thì rút nó ra mà không đụng phần còn lại.
