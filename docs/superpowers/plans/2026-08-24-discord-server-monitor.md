# Discord Server Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một daemon Node.js chạy 24/7, định kỳ kiểm tra HTTP/HTTPS endpoint, gửi alert Discord khi trạng thái đổi, và cho phép quản lý danh sách endpoint bằng slash command.

**Architecture:** Một process duy nhất, chia 7 module với hướng phụ thuộc một chiều: `bot`/`monitor`/`digest`/`notify` → `db` → `config` → `shared`. Mọi logic quyết định là hàm thuần (`evaluate`, `transitionFor`, `buildDigest`, `messages`), I/O bị đẩy ra biên (`http-probe`, repo, `discord-notifier`). Dependency được **inject qua factory function** (`makeXxx(deps)`), không dùng singleton/global — đó là cách mọi thứ test được mà không cần Discord thật.

**Tech Stack:** Node.js 25 · TypeScript (ESM, `nodenext`) · discord.js v14 · better-sqlite3 13 · Drizzle ORM + drizzle-kit · zod · vitest

**Spec:** [docs/superpowers/specs/2026-08-24-discord-server-monitor-design.md](../specs/2026-08-24-discord-server-monitor-design.md)

## Global Constraints

Mọi task đều phải tuân các ràng buộc này, không cần nhắc lại trong từng task.

- **Node >= 25.0.0**, khai báo trong `package.json` `engines`. ESM (`"type": "module"`).
- **TypeScript strict.** Import nội bộ luôn có đuôi `.js` (quy tắc của `nodenext`), ví dụ `import { x } from '../shared/time.js'`.
- **`monitor/` và `digest/` KHÔNG được import `discord.js`.** Chúng chỉ biết interface `Notifier` và type `AlertMessage`. Vi phạm ràng buộc này là làm sập khả năng test của lõi nghiệp vụ.
- **Nguồn sự thật của schema là `src/db/schema.ts`.** Không viết `CREATE TABLE` bằng tay ở bất kỳ đâu.
- **Không bao giờ chạy `drizzle-kit push`.** Chỉ dùng `generate` + `migrate`.
- Thư mục `drizzle/` **được commit vào git** — nó là lịch sử schema.
- Migration là **forward-only**, không có `down`.
- **Mọi mốc thời gian lưu dạng ISO 8601 UTC** (`new Date().toISOString()`), tức luôn có `T` và `Z` và milliseconds. Quy tắc này làm cho so sánh chuỗi lexicographic trong SQL đúng — phá quy tắc là hỏng `findDue` và `statsSince`.
- **Không dùng `Date.now()` hay `new Date()` trực tiếp trong logic nghiệp vụ.** Luôn nhận `clock: Clock` (`() => Date`) qua deps để test bơm được thời gian giả.
- Timezone hiển thị và mốc digest: `Asia/Ho_Chi_Minh`.
- Mỗi task kết thúc bằng một commit. Message theo conventional commits, tiếng Việt phần mô tả.
- Chạy `npm test` phải xanh trước mỗi commit.

## File Structure

| File | Trách nhiệm |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Tooling, script, engines |
| `.env.example` | Khai báo đầy đủ biến môi trường, không có giá trị thật |
| `drizzle.config.ts` | Cấu hình drizzle-kit |
| `drizzle/` | Migration SQL sinh tự động + `meta/_journal.json` |
| `scripts/check-drift.mjs` | Chặn `schema.ts` lệch với `drizzle/` |
| `src/shared/types.ts` | Type dùng chung toàn hệ thống |
| `src/shared/time.ts` | Helper timezone VN, format khoảng thời gian |
| `src/shared/logger.ts` | Logger tối giản có mức |
| `src/shared/concurrency.ts` | `runWithLimit` — chạy song song có giới hạn |
| `src/config.ts` | Đọc + validate env bằng zod |
| `src/db/schema.ts` | Khai báo bảng bằng Drizzle — nguồn sự thật |
| `src/db/connection.ts` | Mở DB, bật PRAGMA, tạo Drizzle instance |
| `src/db/migrate.ts` | Áp migration + backup file DB |
| `src/db/targets.repo.ts` | Truy vấn bảng `targets` |
| `src/db/checks.repo.ts` | Truy vấn bảng `checks` + số liệu thô |
| `src/db/incidents.repo.ts` | Truy vấn bảng `incidents` |
| `src/db/meta.repo.ts` | Key/value |
| `src/monitor/probe.ts` | Interface `Probe` — điểm mở rộng TCP/ping |
| `src/monitor/http-probe.ts` | Gọi HTTP, đo latency, retry lỗi transport |
| `src/monitor/evaluate.ts` | `ProbeResult` → `Status` (thuần) |
| `src/monitor/state-machine.ts` | `(prev, next)` → `Transition \| null` (thuần) |
| `src/monitor/runner.ts` | Điều phối một lần check trọn vẹn |
| `src/monitor/scheduler.ts` | Tick loop, chọn target tới hạn |
| `src/notify/notifier.ts` | Interface `Notifier` |
| `src/notify/messages.ts` | Dựng `AlertMessage` (thuần, không discord.js) |
| `src/notify/embeds.ts` | `AlertMessage` → `EmbedBuilder` |
| `src/notify/discord-notifier.ts` | Gửi qua discord.js, retry 1 lần |
| `src/digest/digest.ts` | `buildDigest`, `sumDowntimeMs` (thuần) |
| `src/digest/schedule.ts` | `maybeSend` + dọn dữ liệu cũ |
| `src/bot/types.ts` | `InteractionLike`, `Command`, `CommandContext` |
| `src/bot/permissions.ts` | `isAdmin` |
| `src/bot/router.ts` | Registry + route interaction + chặn quyền |
| `src/bot/commands/*.ts` | Mỗi lệnh một file |
| `src/bot/client.ts` | Tạo discord.js Client |
| `src/bot/deploy-commands.ts` | Script đăng ký slash command vào guild |
| `src/index.ts` | Wiring — module duy nhất biết mọi thứ |
| `README.md` | Hướng dẫn dựng bot, chạy, deploy |

---

### Task 1: Scaffold dự án + `shared/time.ts`

Task này dựng toàn bộ tooling và giao nộp đơn vị test được đầu tiên: helper thời gian. Helper này là nền cho mốc digest, nên nó phải đúng trước mọi thứ khác.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`
- Create: `src/shared/types.ts`, `src/shared/time.ts`, `src/shared/logger.ts`
- Test: `tests/shared/time.test.ts`

**Interfaces:**
- Consumes: không có (task đầu)
- Produces: `Clock = () => Date` · `VN_TZ` · `vnDateString(d: Date): string` · `vnHour(d: Date): number` · `formatDuration(ms: number): string` · `Logger` · toàn bộ type trong `shared/types.ts`

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "noti-discord",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=25.0.0" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:drift": "node scripts/check-drift.mjs",
    "deploy-commands": "tsx src/bot/deploy-commands.ts"
  }
}
```

- [ ] **Step 2: Cài dependency**

```bash
npm install discord.js better-sqlite3 drizzle-orm zod dotenv
npm install -D typescript tsx vitest drizzle-kit @types/node @types/better-sqlite3
```

- [ ] **Step 3: Tạo `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true,
    "declaration": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Tạo `vitest.config.ts`**

`pool: 'forks'` là bắt buộc: `better-sqlite3` là native module, chạy trong worker thread của vitest dễ gây lỗi nạp binary.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5: Tạo `.env.example`**

```bash
# Discord
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
GUILD_ID=
DEFAULT_ALERT_CHANNEL_ID=
DIGEST_CHANNEL_ID=
# Danh sách Discord user ID được dùng lệnh ghi, phân tách bằng dấu phẩy
ADMIN_USER_IDS=

# Lưu trữ
DB_PATH=./data/monitor.db

# Hành vi
DIGEST_HOUR_LOCAL=9
DEFAULT_INTERVAL_SECONDS=60
DEFAULT_TIMEOUT_MS=10000
DEFAULT_LATENCY_THRESHOLD_MS=2000
CHECK_RETENTION_DAYS=30
MAX_CONCURRENT_CHECKS=5
TICK_INTERVAL_MS=10000
LOG_LEVEL=info
```

- [ ] **Step 6: Tạo `src/shared/types.ts`**

Đây là từ vựng dùng chung của cả hệ thống. Các task sau import từ đây, không định nghĩa lại.

```ts
export type Status = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'

export type Target = {
  id: number
  name: string
  url: string
  method: string
  expectedStatus: string
  latencyThresholdMs: number | null
  intervalSeconds: number
  timeoutMs: number
  alertChannelId: string | null
  pausedUntil: string | null
  currentStatus: Status
  lastCheckedAt: string | null
  createdAt: string
  createdBy: string
}

export type ProbeResult =
  | { ok: true; httpStatus: number; latencyMs: number }
  | { ok: false; httpStatus?: number; latencyMs?: number; error: string }

export type Transition = { kind: 'down' } | { kind: 'recovered' }

export type CheckOutcome = {
  target: Target
  result: ProbeResult
  status: Status
  transition: Transition | null
}

export type AlertField = { name: string; value: string; inline?: boolean }

export type AlertMessage = {
  kind: 'down' | 'recovered' | 'manual' | 'digest'
  title: string
  description: string
  color: number
  fields: AlertField[]
  timestampIso: string
}

export type Incident = {
  id: number
  targetId: number
  startedAt: string
  endedAt: string | null
  reason: string | null
}

export type CheckStats = {
  total: number
  up: number
  down: number
  avgLatencyMs: number | null
}

export type DigestLine = {
  name: string
  currentStatus: Status
  paused: boolean
  uptimePct: number | null
  avgLatencyMs: number | null
  incidentCount: number
  downtimeMs: number
}

export type DigestReport = {
  rangeLabel: string
  lines: DigestLine[]
}
```

- [ ] **Step 7: Tạo `src/shared/logger.ts`**

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type Logger = {
  debug(msg: string, extra?: unknown): void
  info(msg: string, extra?: unknown): void
  warn(msg: string, extra?: unknown): void
  error(msg: string, extra?: unknown): void
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export function makeLogger(level: LogLevel = 'info'): Logger {
  const min = ORDER[level]
  const emit = (lvl: LogLevel, msg: string, extra?: unknown) => {
    if (ORDER[lvl] < min) return
    const line = `[${new Date().toISOString()}] ${lvl.toUpperCase()} ${msg}`
    if (extra === undefined) console.log(line)
    else console.log(line, extra)
  }
  return {
    debug: (m, e) => emit('debug', m, e),
    info: (m, e) => emit('info', m, e),
    warn: (m, e) => emit('warn', m, e),
    error: (m, e) => emit('error', m, e),
  }
}

export const silentLogger: Logger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
}
```

`silentLogger` tồn tại để test không làm bẩn output — mọi test có deps nhận `logger` đều truyền nó.

- [ ] **Step 8: Viết test thất bại cho `time.ts`**

Tạo `tests/shared/time.test.ts`. Hai test đầu là quan trọng nhất: chúng bắt đúng lỗi biên ngày mà bug timezone luôn rơi vào.

```ts
import { describe, expect, it } from 'vitest'
import { formatDuration, vnDateString, vnHour } from '../../src/shared/time.js'

describe('vnDateString', () => {
  it('trả ngày theo giờ VN', () => {
    expect(vnDateString(new Date('2026-08-24T01:30:00.000Z'))).toBe('2026-08-24')
  })

  it('UTC còn hôm trước nhưng VN đã sang ngày mới', () => {
    expect(vnDateString(new Date('2026-08-23T17:30:00.000Z'))).toBe('2026-08-24')
  })

  it('UTC đã sang ngày mới nhưng VN còn hôm trước là không thể (VN = UTC+7)', () => {
    expect(vnDateString(new Date('2026-08-24T00:00:00.000Z'))).toBe('2026-08-24')
  })
})

describe('vnHour', () => {
  it('01:30Z là 8 giờ VN', () => {
    expect(vnHour(new Date('2026-08-24T01:30:00.000Z'))).toBe(8)
  })

  it('17:30Z là 0 giờ VN, không phải 24', () => {
    expect(vnHour(new Date('2026-08-23T17:30:00.000Z'))).toBe(0)
  })

  it('02:00Z là 9 giờ VN — đúng mốc gửi digest', () => {
    expect(vnHour(new Date('2026-08-24T02:00:00.000Z'))).toBe(9)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [999, '0s'],
    [5_000, '5s'],
    [65_000, '1m 5s'],
    [3_725_000, '1h 2m 5s'],
    [90_061_000, '1d 1h 1m 1s'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})
```

- [ ] **Step 9: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/shared/time.test.ts`
Expected: FAIL — không resolve được module `src/shared/time.js`.

- [ ] **Step 10: Cài đặt `src/shared/time.ts`**

Dùng `Intl.DateTimeFormat().formatToParts()` chứ không dùng `toLocaleDateString` với locale đoán được — `formatToParts` cho ta lấy đúng từng thành phần, không phụ thuộc thứ tự hiển thị của locale. `hourCycle: 'h23'` là để nửa đêm ra `0` chứ không phải `24`.

```ts
export const VN_TZ = 'Asia/Ho_Chi_Minh'

export type Clock = () => Date

const dateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})

const hourParts = new Intl.DateTimeFormat('en-US', {
  timeZone: VN_TZ, hour: '2-digit', hourCycle: 'h23',
})

export function vnDateString(d: Date): string {
  const p = new Map(dateParts.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.get('year')}-${p.get('month')}-${p.get('day')}`
}

export function vnHour(d: Date): number {
  const hour = hourParts.formatToParts(d).find((x) => x.type === 'hour')
  return Number(hour?.value ?? '0')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '0s'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (seconds || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}
```

- [ ] **Step 11: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/shared/time.test.ts`
Expected: PASS — 12 test.

- [ ] **Step 12: Chạy typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 13: Tạo `.gitignore` bổ sung và commit**

`.gitignore` đã tồn tại từ trước và đã chặn `node_modules/`, `dist/`, `.env`, `data/`, `*.db`. Kiểm tra lại rằng nó **không** chặn `drizzle/`:

```bash
git check-ignore -v drizzle 2>/dev/null && echo "LỖI: drizzle/ đang bị ignore" || echo "OK: drizzle/ sẽ được commit"
```

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src/shared tests/shared
git commit -m "feat(shared): scaffold dự án và helper thời gian theo giờ VN"
```

---

### Task 2: Module `config`

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: `LogLevel` từ `src/shared/logger.js`
- Produces: `AppConfig` (type) · `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/config.test.ts`. `loadConfig` nhận `env` làm tham số chứ không đọc `process.env` trực tiếp — đó là điều làm nó test được.

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const valid = {
  DISCORD_TOKEN: 'tok',
  DISCORD_CLIENT_ID: '111',
  GUILD_ID: '222',
  DEFAULT_ALERT_CHANNEL_ID: '333',
  DIGEST_CHANNEL_ID: '444',
  ADMIN_USER_IDS: '555,666',
}

describe('loadConfig', () => {
  it('parse env hợp lệ và gán default', () => {
    const c = loadConfig(valid)
    expect(c.discordToken).toBe('tok')
    expect(c.adminUserIds).toEqual(['555', '666'])
    expect(c.dbPath).toBe('./data/monitor.db')
    expect(c.digestHourLocal).toBe(9)
    expect(c.defaultIntervalSeconds).toBe(60)
    expect(c.defaultTimeoutMs).toBe(10_000)
    expect(c.defaultLatencyThresholdMs).toBe(2_000)
    expect(c.checkRetentionDays).toBe(30)
    expect(c.maxConcurrentChecks).toBe(5)
    expect(c.tickIntervalMs).toBe(10_000)
    expect(c.logLevel).toBe('info')
  })

  it('thiếu DISCORD_TOKEN thì báo lỗi nêu rõ tên biến', () => {
    const { DISCORD_TOKEN: _drop, ...rest } = valid
    expect(() => loadConfig(rest)).toThrow(/DISCORD_TOKEN/)
  })

  it('ADMIN_USER_IDS rỗng thì báo lỗi', () => {
    expect(() => loadConfig({ ...valid, ADMIN_USER_IDS: '' })).toThrow(/ADMIN_USER_IDS/)
  })

  it('cắt khoảng trắng và bỏ phần tử rỗng trong ADMIN_USER_IDS', () => {
    expect(loadConfig({ ...valid, ADMIN_USER_IDS: ' 555 , ,666 ' }).adminUserIds)
      .toEqual(['555', '666'])
  })

  it('ghi đè được default bằng env', () => {
    const c = loadConfig({ ...valid, DB_PATH: '/tmp/x.db', DIGEST_HOUR_LOCAL: '7', LOG_LEVEL: 'debug' })
    expect(c.dbPath).toBe('/tmp/x.db')
    expect(c.digestHourLocal).toBe(7)
    expect(c.logLevel).toBe('debug')
  })

  it('số sai định dạng thì báo lỗi nêu rõ tên biến', () => {
    expect(() => loadConfig({ ...valid, TICK_INTERVAL_MS: 'nhanh' })).toThrow(/TICK_INTERVAL_MS/)
  })

  it('DIGEST_HOUR_LOCAL ngoài 0-23 thì báo lỗi', () => {
    expect(() => loadConfig({ ...valid, DIGEST_HOUR_LOCAL: '25' })).toThrow(/DIGEST_HOUR_LOCAL/)
  })

  it('LOG_LEVEL không hợp lệ thì báo lỗi', () => {
    expect(() => loadConfig({ ...valid, LOG_LEVEL: 'ồn ào' })).toThrow(/LOG_LEVEL/)
  })

  it('config trả về là readonly ở mức runtime', () => {
    const c = loadConfig(valid)
    expect(Object.isFrozen(c)).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — không resolve được `src/config.js`.

- [ ] **Step 3: Cài đặt `src/config.ts`**

`z.coerce.number()` biến `'7'` thành `7`; `.superRefine` không cần vì mỗi field đã tự có message. Điều quan trọng: `formatIssues` phải đưa **tên biến env** vào message, vì đó là thứ người vận hành cần thấy.

```ts
import { z } from 'zod'
import type { LogLevel } from './shared/logger.js'

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  GUILD_ID: z.string().min(1),
  DEFAULT_ALERT_CHANNEL_ID: z.string().min(1),
  DIGEST_CHANNEL_ID: z.string().min(1),
  ADMIN_USER_IDS: z.string().min(1),

  DB_PATH: z.string().min(1).default('./data/monitor.db'),
  DIGEST_HOUR_LOCAL: z.coerce.number().int().min(0).max(23).default(9),
  DEFAULT_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(86_400).default(60),
  DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  DEFAULT_LATENCY_THRESHOLD_MS: z.coerce.number().int().positive().default(2_000),
  CHECK_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_CONCURRENT_CHECKS: z.coerce.number().int().min(1).max(50).default(5),
  TICK_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type AppConfig = Readonly<{
  discordToken: string
  discordClientId: string
  guildId: string
  defaultAlertChannelId: string
  digestChannelId: string
  adminUserIds: readonly string[]
  dbPath: string
  digestHourLocal: number
  defaultIntervalSeconds: number
  defaultTimeoutMs: number
  defaultLatencyThresholdMs: number
  checkRetentionDays: number
  maxConcurrentChecks: number
  tickIntervalMs: number
  logLevel: LogLevel
}>

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((i) => `  - ${i.path.join('.') || '(gốc)'}: ${i.message}`)
  return `Cấu hình không hợp lệ:\n${lines.join('\n')}`
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env)
  if (!parsed.success) throw new Error(formatIssues(parsed.error))

  const raw = parsed.data
  const adminUserIds = raw.ADMIN_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean)
  if (adminUserIds.length === 0) {
    throw new Error('Cấu hình không hợp lệ:\n  - ADMIN_USER_IDS: phải có ít nhất một user ID')
  }

  return Object.freeze({
    discordToken: raw.DISCORD_TOKEN,
    discordClientId: raw.DISCORD_CLIENT_ID,
    guildId: raw.GUILD_ID,
    defaultAlertChannelId: raw.DEFAULT_ALERT_CHANNEL_ID,
    digestChannelId: raw.DIGEST_CHANNEL_ID,
    adminUserIds: Object.freeze(adminUserIds),
    dbPath: raw.DB_PATH,
    digestHourLocal: raw.DIGEST_HOUR_LOCAL,
    defaultIntervalSeconds: raw.DEFAULT_INTERVAL_SECONDS,
    defaultTimeoutMs: raw.DEFAULT_TIMEOUT_MS,
    defaultLatencyThresholdMs: raw.DEFAULT_LATENCY_THRESHOLD_MS,
    checkRetentionDays: raw.CHECK_RETENTION_DAYS,
    maxConcurrentChecks: raw.MAX_CONCURRENT_CHECKS,
    tickIntervalMs: raw.TICK_INTERVAL_MS,
    logLevel: raw.LOG_LEVEL,
  })
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS — 9 test.

Nếu test "số sai định dạng" thất bại vì message không chứa `TICK_INTERVAL_MS`: kiểm tra `formatIssues` đang dùng `i.path.join('.')`. Với schema phẳng thì `path` chính là tên biến env.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): đọc và validate biến môi trường bằng zod"
```

---

### Task 3: Schema Drizzle, migration đầu tiên, kết nối DB

Task lớn nhất về mặt hạ tầng và là task mọi task sau đứng lên. Nó giao nộp: schema, migration sinh ra và commit được, hàm mở DB, hàm áp migration, backup, và chốt chống lệch schema.

**Files:**
- Create: `drizzle.config.ts`, `src/db/schema.ts`, `src/db/connection.ts`, `src/db/migrate.ts`, `scripts/check-drift.mjs`
- Create (sinh tự động): `drizzle/0000_*.sql`, `drizzle/meta/_journal.json`
- Test: `tests/db/migrate.test.ts`

**Interfaces:**
- Consumes: `AppConfig` từ `src/config.js`
- Produces:
  - `targets`, `checks`, `incidents`, `meta` (bảng Drizzle) từ `src/db/schema.js`
  - `Db` (type) · `OpenedDb = { raw: Database.Database; db: Db }` · `openDb(path: string): OpenedDb` · `openTestDb(): OpenedDb` từ `src/db/connection.js`
  - `MIGRATIONS_FOLDER: string` · `applyMigrations(db: Db, folder?: string): Promise<void>` · `backupDbFile(dbPath: string, now: Date, keep?: number): string | null` từ `src/db/migrate.js`

- [ ] **Step 1: Tạo `src/db/schema.ts`**

Cột trong DB đặt tên snake_case, thuộc tính TS camelCase — khai báo tên DB tường minh trong từng cột để không phụ thuộc quy ước tự suy ra.

```ts
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const targets = sqliteTable('targets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  url: text('url').notNull(),
  method: text('method').notNull().default('GET'),
  expectedStatus: text('expected_status').notNull().default('200-299'),
  latencyThresholdMs: integer('latency_threshold_ms'),
  intervalSeconds: integer('interval_seconds').notNull(),
  timeoutMs: integer('timeout_ms').notNull(),
  alertChannelId: text('alert_channel_id'),
  pausedUntil: text('paused_until'),
  currentStatus: text('current_status').notNull().default('UNKNOWN'),
  lastCheckedAt: text('last_checked_at'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
})

export const checks = sqliteTable(
  'checks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    targetId: integer('target_id')
      .notNull()
      .references(() => targets.id, { onDelete: 'cascade' }),
    checkedAt: text('checked_at').notNull(),
    status: text('status').notNull(),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    error: text('error'),
  },
  (t) => [index('idx_checks_target_time').on(t.targetId, t.checkedAt)],
)

export const incidents = sqliteTable(
  'incidents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    targetId: integer('target_id')
      .notNull()
      .references(() => targets.id, { onDelete: 'cascade' }),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    reason: text('reason'),
  },
  (t) => [index('idx_incidents_target_time').on(t.targetId, t.startedAt)],
)

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
```

- [ ] **Step 2: Tạo `drizzle.config.ts`**

```ts
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DB_PATH ?? './data/monitor.db' },
  strict: true,
  verbose: true,
})
```

- [ ] **Step 3: Sinh migration đầu tiên và ĐỌC file SQL sinh ra**

```bash
npm run db:generate
```

Sau đó bắt buộc đọc file vừa sinh — đây là chốt kiểm soát, không được bỏ qua:

```bash
cat drizzle/0000_*.sql
```

Xác nhận trong file có: 4 bảng `targets`/`checks`/`incidents`/`meta`; `UNIQUE` trên `targets.name`; `FOREIGN KEY ... ON DELETE cascade` trên `checks.target_id` và `incidents.target_id`; hai index `idx_checks_target_time` và `idx_incidents_target_time`; default `'GET'`, `'200-299'`, `'UNKNOWN'`.

- [ ] **Step 4: Tạo `src/db/connection.ts`**

`openTestDb()` tồn tại để mọi test dùng đúng một đường mở DB, và để không ai vô tình mở file thật trong test.

```ts
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export type Db = BetterSQLite3Database<typeof schema>

export type OpenedDb = { raw: Database.Database; db: Db }

export function openDb(path: string): OpenedDb {
  const raw = new Database(path)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  const db = drizzle(raw, { schema })
  return { raw, db }
}

export function openTestDb(): OpenedDb {
  const raw = new Database(':memory:')
  raw.pragma('foreign_keys = ON')
  const db = drizzle(raw, { schema })
  return { raw, db }
}
```

`journal_mode = WAL` không áp dụng cho DB `:memory:` (SQLite trả về `memory`), nên `openTestDb` không gọi nó.

- [ ] **Step 5: Viết test thất bại cho migration**

Tạo `tests/db/migrate.test.ts`.

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations, backupDbFile } from '../../src/db/migrate.js'

function tableNames(raw: import('better-sqlite3').Database): string[] {
  return raw
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((r) => (r as { name: string }).name)
}

describe('applyMigrations', () => {
  it('tạo đủ 4 bảng nghiệp vụ từ DB rỗng', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    const names = tableNames(raw)
    expect(names).toContain('targets')
    expect(names).toContain('checks')
    expect(names).toContain('incidents')
    expect(names).toContain('meta')
    raw.close()
  })

  it('tạo index đã khai báo', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    const idx = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .all()
      .map((r) => (r as { name: string }).name)
    expect(idx).toContain('idx_checks_target_time')
    expect(idx).toContain('idx_incidents_target_time')
    raw.close()
  })

  it('áp lần thứ hai không làm gì và không lỗi', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    const before = tableNames(raw)
    await applyMigrations(db)
    expect(tableNames(raw)).toEqual(before)
    raw.close()
  })

  it('ràng buộc UNIQUE trên targets.name có hiệu lực', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    const insert = raw.prepare(
      `INSERT INTO targets (name, url, interval_seconds, timeout_ms, created_at, created_by)
       VALUES (?, ?, 60, 10000, '2026-08-24T00:00:00.000Z', 'u1')`,
    )
    insert.run('web', 'https://a.test')
    expect(() => insert.run('web', 'https://b.test')).toThrow(/UNIQUE/i)
    raw.close()
  })

  it('ON DELETE CASCADE xoá checks khi xoá target', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    raw.prepare(
      `INSERT INTO targets (id, name, url, interval_seconds, timeout_ms, created_at, created_by)
       VALUES (1, 'web', 'https://a.test', 60, 10000, '2026-08-24T00:00:00.000Z', 'u1')`,
    ).run()
    raw.prepare(
      `INSERT INTO checks (target_id, checked_at, status) VALUES (1, '2026-08-24T00:01:00.000Z', 'UP')`,
    ).run()
    raw.prepare(`DELETE FROM targets WHERE id = 1`).run()
    const left = raw.prepare(`SELECT count(*) AS n FROM checks`).get() as { n: number }
    expect(left.n).toBe(0)
    raw.close()
  })
})

describe('backupDbFile', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function tmpDbFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noti-bak-'))
    dirs.push(dir)
    const file = path.join(dir, 'monitor.db')
    fs.writeFileSync(file, 'giả lập nội dung db')
    return file
  }

  it('bỏ qua DB in-memory', () => {
    expect(backupDbFile(':memory:', new Date('2026-08-24T00:00:00.000Z'))).toBeNull()
  })

  it('bỏ qua khi file chưa tồn tại', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noti-bak-'))
    dirs.push(dir)
    expect(backupDbFile(path.join(dir, 'chua-co.db'), new Date())).toBeNull()
  })

  it('tạo bản copy có nội dung giống bản gốc', () => {
    const file = tmpDbFile()
    const dest = backupDbFile(file, new Date('2026-08-24T01:02:03.000Z'))
    expect(dest).not.toBeNull()
    expect(fs.readFileSync(dest as string, 'utf8')).toBe('giả lập nội dung db')
  })

  it('chỉ giữ 3 bản backup gần nhất', () => {
    const file = tmpDbFile()
    for (const iso of [
      '2026-08-20T00:00:00.000Z',
      '2026-08-21T00:00:00.000Z',
      '2026-08-22T00:00:00.000Z',
      '2026-08-23T00:00:00.000Z',
      '2026-08-24T00:00:00.000Z',
    ]) {
      backupDbFile(file, new Date(iso))
    }
    const backups = fs
      .readdirSync(path.dirname(file))
      .filter((f) => f.startsWith('monitor.db.bak-'))
      .sort()
    expect(backups).toHaveLength(3)
    expect(backups[0]).toContain('2026-08-22')
    expect(backups[2]).toContain('2026-08-24')
  })
})
```

- [ ] **Step 6: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: FAIL — không resolve được `src/db/migrate.js`.

- [ ] **Step 7: Cài đặt `src/db/migrate.ts`**

`applyMigrations` là `async` và `await migrate(...)` dù migrator của better-sqlite3 chạy đồng bộ — `await` trên giá trị không phải Promise là vô hại, và cách viết này không vỡ nếu Drizzle đổi sang trả Promise.

```ts
import fs from 'node:fs'
import path from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { Db } from './connection.js'

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle')

export async function applyMigrations(db: Db, folder: string = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder })
}

export function backupDbFile(dbPath: string, now: Date, keep = 3): string | null {
  if (dbPath === ':memory:') return null
  if (!fs.existsSync(dbPath)) return null

  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dest = `${dbPath}.bak-${stamp}`
  fs.copyFileSync(dbPath, dest)
  pruneBackups(dbPath, keep)
  return dest
}

function pruneBackups(dbPath: string, keep: number): void {
  const dir = path.dirname(dbPath)
  const prefix = `${path.basename(dbPath)}.bak-`
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .sort()
    .reverse()
  for (const stale of backups.slice(keep)) {
    fs.rmSync(path.join(dir, stale), { force: true })
  }
}
```

Timestamp ISO được thay `:` và `.` thành `-` vì `:` không hợp lệ trong tên file trên Windows. Chuỗi kết quả vẫn sắp xếp đúng thứ tự thời gian theo lexicographic, nên `.sort().reverse()` cho ta "mới nhất trước".

- [ ] **Step 8: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: PASS — 9 test.

Nếu test CASCADE thất bại: `openTestDb` phải bật `pragma('foreign_keys = ON')`. SQLite tắt FK theo mặc định.

- [ ] **Step 9: Tạo `scripts/check-drift.mjs`**

Chốt chống lệch: nếu ai sửa `schema.ts` mà quên `db:generate`, lệnh này fail. Viết bằng Node thay vì shell để chạy được cả trên Windows và Linux.

```js
import { execFileSync } from 'node:child_process'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

const before = git(['status', '--porcelain', '--', 'drizzle'])

try {
  execFileSync('npx', ['drizzle-kit', 'generate'], { encoding: 'utf8', stdio: 'pipe' })
} catch (err) {
  console.error('drizzle-kit generate thất bại:')
  console.error(err.stdout ?? '', err.stderr ?? '')
  process.exit(1)
}

const after = git(['status', '--porcelain', '--', 'drizzle'])

if (after !== before) {
  console.error('src/db/schema.ts đã lệch với thư mục drizzle/.')
  console.error('Chạy `npm run db:generate`, đọc file SQL sinh ra, rồi commit nó.')
  console.error('Thay đổi mà lệnh này phát hiện:')
  console.error(after)
  process.exit(1)
}

console.log('OK: schema.ts khớp với drizzle/.')
```

- [ ] **Step 10: Chạy chốt chống lệch để xác nhận nó báo OK**

Run: `npm run db:drift`
Expected: in `OK: schema.ts khớp với drizzle/.` và exit 0.

- [ ] **Step 11: Chạy typecheck và toàn bộ test**

Run: `npm run typecheck && npm test`
Expected: không lỗi typecheck; toàn bộ test PASS.

- [ ] **Step 12: Commit**

```bash
git add drizzle.config.ts drizzle src/db scripts tests/db
git commit -m "feat(db): schema Drizzle, migration đầu tiên, mở DB và backup"
```

---

### Task 4: `targets.repo.ts`

**Files:**
- Create: `src/db/targets.repo.ts`
- Test: `tests/db/targets.repo.test.ts`

**Interfaces:**
- Consumes: `Db`, `openTestDb` từ `src/db/connection.js` · `applyMigrations` từ `src/db/migrate.js` · `targets` từ `src/db/schema.js` · `Status`, `Target` từ `src/shared/types.js`
- Produces:
  - `CreateTargetInput` (type): `{ name, url, method?, expectedStatus?, latencyThresholdMs?, intervalSeconds, timeoutMs, alertChannelId?, createdBy, createdAt }`
  - `TargetsRepo` (type) · `makeTargetsRepo(db: Db): TargetsRepo`
  - Method: `create(input): Target` · `findByName(name): Target | null` · `findById(id): Target | null` · `findAll(): Target[]` · `findDue(nowIso): Target[]` · `updateStatus(id, status, checkedAtIso): void` · `setPause(id, pausedUntilIso): void` · `remove(name): boolean`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/db/targets.repo.test.ts`. Test `findDue` là quan trọng nhất — nó chứng minh phép so sánh thời gian trong SQL đúng.

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeTargetsRepo, type CreateTargetInput, type TargetsRepo } from '../../src/db/targets.repo.js'

const AT = '2026-08-24T00:00:00.000Z'

function input(over: Partial<CreateTargetInput> = {}): CreateTargetInput {
  return {
    name: 'web',
    url: 'https://a.test',
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: AT,
    ...over,
  }
}

describe('TargetsRepo', () => {
  let repo: TargetsRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeTargetsRepo(db)
  })

  it('create trả về target đầy đủ với default đã áp', () => {
    const t = repo.create(input())
    expect(t.id).toBeGreaterThan(0)
    expect(t.name).toBe('web')
    expect(t.method).toBe('GET')
    expect(t.expectedStatus).toBe('200-299')
    expect(t.currentStatus).toBe('UNKNOWN')
    expect(t.latencyThresholdMs).toBeNull()
    expect(t.alertChannelId).toBeNull()
    expect(t.pausedUntil).toBeNull()
    expect(t.lastCheckedAt).toBeNull()
  })

  it('create nhận giá trị tuỳ chọn', () => {
    const t = repo.create(input({ latencyThresholdMs: 500, alertChannelId: '999', expectedStatus: '204' }))
    expect(t.latencyThresholdMs).toBe(500)
    expect(t.alertChannelId).toBe('999')
    expect(t.expectedStatus).toBe('204')
  })

  it('create trùng tên thì throw', () => {
    repo.create(input())
    expect(() => repo.create(input())).toThrow(/UNIQUE/i)
  })

  it('findByName trả null khi không có', () => {
    expect(repo.findByName('không-có')).toBeNull()
  })

  it('findByName tìm được target vừa tạo', () => {
    repo.create(input())
    expect(repo.findByName('web')?.url).toBe('https://a.test')
  })

  it('findById tìm được và trả null khi thiếu', () => {
    const t = repo.create(input())
    expect(repo.findById(t.id)?.name).toBe('web')
    expect(repo.findById(9_999)).toBeNull()
  })

  it('findAll sắp xếp theo tên', () => {
    repo.create(input({ name: 'zulu' }))
    repo.create(input({ name: 'alpha' }))
    expect(repo.findAll().map((t) => t.name)).toEqual(['alpha', 'zulu'])
  })

  it('findDue trả target chưa từng check', () => {
    repo.create(input())
    expect(repo.findDue('2026-08-24T00:00:00.000Z').map((t) => t.name)).toEqual(['web'])
  })

  it('findDue bỏ target vừa check chưa tới hạn', () => {
    const t = repo.create(input({ intervalSeconds: 60 }))
    repo.updateStatus(t.id, 'UP', '2026-08-24T00:00:00.000Z')
    expect(repo.findDue('2026-08-24T00:00:30.000Z')).toEqual([])
  })

  it('findDue trả target đã đủ interval', () => {
    const t = repo.create(input({ intervalSeconds: 60 }))
    repo.updateStatus(t.id, 'UP', '2026-08-24T00:00:00.000Z')
    expect(repo.findDue('2026-08-24T00:01:00.000Z').map((t2) => t2.name)).toEqual(['web'])
  })

  it('findDue bỏ target đang pause dù đã tới hạn', () => {
    const t = repo.create(input())
    repo.setPause(t.id, '2026-08-24T01:00:00.000Z')
    expect(repo.findDue('2026-08-24T00:30:00.000Z')).toEqual([])
  })

  it('findDue trả lại target sau khi pause hết hạn, không cần resume', () => {
    const t = repo.create(input())
    repo.setPause(t.id, '2026-08-24T01:00:00.000Z')
    expect(repo.findDue('2026-08-24T01:00:01.000Z').map((t2) => t2.name)).toEqual(['web'])
  })

  it('setPause với null thì bỏ pause', () => {
    const t = repo.create(input())
    repo.setPause(t.id, '2026-08-24T01:00:00.000Z')
    repo.setPause(t.id, null)
    expect(repo.findById(t.id)?.pausedUntil).toBeNull()
    expect(repo.findDue('2026-08-24T00:30:00.000Z')).toHaveLength(1)
  })

  it('updateStatus ghi cả status và lastCheckedAt', () => {
    const t = repo.create(input())
    repo.updateStatus(t.id, 'DEGRADED', '2026-08-24T00:05:00.000Z')
    const after = repo.findById(t.id)
    expect(after?.currentStatus).toBe('DEGRADED')
    expect(after?.lastCheckedAt).toBe('2026-08-24T00:05:00.000Z')
  })

  it('remove trả true khi xoá được, false khi không có', () => {
    repo.create(input())
    expect(repo.remove('web')).toBe(true)
    expect(repo.remove('web')).toBe(false)
    expect(repo.findAll()).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/db/targets.repo.test.ts`
Expected: FAIL — không resolve được `src/db/targets.repo.js`.

- [ ] **Step 3: Cài đặt `src/db/targets.repo.ts`**

Phép so sánh thời gian dùng `strftime('%s', ...)` để đổi ISO string thành epoch giây rồi mới cộng interval. Tuyệt đối **không** so sánh trực tiếp chuỗi ISO với kết quả `datetime(...)` của SQLite: `datetime()` trả `'2026-08-24 00:01:00'` (dấu cách, không có `Z`, không có ms) trong khi ta lưu `'2026-08-24T00:01:00.000Z'` — so sánh lexicographic hai định dạng đó cho kết quả sai.

```ts
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import type { Db } from './connection.js'
import { targets } from './schema.js'
import type { Status, Target } from '../shared/types.js'

export type CreateTargetInput = {
  name: string
  url: string
  method?: string
  expectedStatus?: string
  latencyThresholdMs?: number | null
  intervalSeconds: number
  timeoutMs: number
  alertChannelId?: string | null
  createdBy: string
  createdAt: string
}

type Row = typeof targets.$inferSelect

function toTarget(row: Row): Target {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    method: row.method,
    expectedStatus: row.expectedStatus,
    latencyThresholdMs: row.latencyThresholdMs,
    intervalSeconds: row.intervalSeconds,
    timeoutMs: row.timeoutMs,
    alertChannelId: row.alertChannelId,
    pausedUntil: row.pausedUntil,
    currentStatus: row.currentStatus as Status,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  }
}

export type TargetsRepo = {
  create(input: CreateTargetInput): Target
  findByName(name: string): Target | null
  findById(id: number): Target | null
  findAll(): Target[]
  findDue(nowIso: string): Target[]
  updateStatus(id: number, status: Status, checkedAtIso: string): void
  setPause(id: number, pausedUntilIso: string | null): void
  remove(name: string): boolean
}

export function makeTargetsRepo(db: Db): TargetsRepo {
  return {
    create(input) {
      const row = db
        .insert(targets)
        .values({
          name: input.name,
          url: input.url,
          method: input.method ?? 'GET',
          expectedStatus: input.expectedStatus ?? '200-299',
          latencyThresholdMs: input.latencyThresholdMs ?? null,
          intervalSeconds: input.intervalSeconds,
          timeoutMs: input.timeoutMs,
          alertChannelId: input.alertChannelId ?? null,
          createdAt: input.createdAt,
          createdBy: input.createdBy,
        })
        .returning()
        .get()
      return toTarget(row)
    },

    findByName(name) {
      const row = db.select().from(targets).where(eq(targets.name, name)).get()
      return row ? toTarget(row) : null
    },

    findById(id) {
      const row = db.select().from(targets).where(eq(targets.id, id)).get()
      return row ? toTarget(row) : null
    },

    findAll() {
      return db.select().from(targets).orderBy(asc(targets.name)).all().map(toTarget)
    },

    findDue(nowIso) {
      const dueByInterval = or(
        isNull(targets.lastCheckedAt),
        sql`strftime('%s', ${targets.lastCheckedAt}) + ${targets.intervalSeconds} <= strftime('%s', ${nowIso})`,
      )
      const notPaused = or(
        isNull(targets.pausedUntil),
        sql`strftime('%s', ${targets.pausedUntil}) <= strftime('%s', ${nowIso})`,
      )
      return db
        .select()
        .from(targets)
        .where(and(dueByInterval, notPaused))
        .orderBy(asc(targets.name))
        .all()
        .map(toTarget)
    },

    updateStatus(id, status, checkedAtIso) {
      db.update(targets)
        .set({ currentStatus: status, lastCheckedAt: checkedAtIso })
        .where(eq(targets.id, id))
        .run()
    },

    setPause(id, pausedUntilIso) {
      db.update(targets).set({ pausedUntil: pausedUntilIso }).where(eq(targets.id, id)).run()
    },

    remove(name) {
      const res = db.delete(targets).where(eq(targets.name, name)).run()
      return res.changes > 0
    },
  }
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/db/targets.repo.test.ts`
Expected: PASS — 16 test.

Nếu các test `findDue` thất bại: chạy tay `sqlite3` hoặc thêm log để in `strftime('%s','2026-08-24T00:00:00.000Z')`. Kết quả phải là một số epoch, không phải `null`. Nếu là `null` thì SQLite bản đang dùng không parse được hậu tố `Z`; khi đó đổi sang lưu thêm cột epoch integer và sửa spec — nhưng SQLite 3.53 (bản đi kèm better-sqlite3 13) parse được, nên khả năng này rất thấp.

- [ ] **Step 5: Commit**

```bash
git add src/db/targets.repo.ts tests/db/targets.repo.test.ts
git commit -m "feat(db): repo cho bảng targets với truy vấn findDue"
```

---

### Task 5: `checks.repo.ts` và `meta.repo.ts`

**Files:**
- Create: `src/db/checks.repo.ts`, `src/db/meta.repo.ts`
- Test: `tests/db/checks.repo.test.ts`, `tests/db/meta.repo.test.ts`

**Interfaces:**
- Consumes: `Db` từ `src/db/connection.js` · `checks`, `meta` từ `src/db/schema.js` · `CheckStats`, `Status` từ `src/shared/types.js`
- Produces:
  - `InsertCheckInput` (type): `{ targetId, checkedAt, status, httpStatus?, latencyMs?, error? }`
  - `CheckRow` (type): `{ id, targetId, checkedAt, status, httpStatus, latencyMs, error }`
  - `ChecksRepo` · `makeChecksRepo(db: Db): ChecksRepo` — `insert(input): void` · `listRecent(targetId, limit): CheckRow[]` · `statsSince(targetId, sinceIso): CheckStats` · `deleteOlderThan(cutoffIso): number`
  - `MetaRepo` · `makeMetaRepo(db: Db): MetaRepo` — `get(key): string | null` · `set(key, value): void`

- [ ] **Step 1: Viết test thất bại cho `checks.repo.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeChecksRepo, type ChecksRepo } from '../../src/db/checks.repo.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'

describe('ChecksRepo', () => {
  let repo: ChecksRepo
  let targetId: number

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeChecksRepo(db)
    targetId = makeTargetsRepo(db).create({
      name: 'web',
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: '2026-08-24T00:00:00.000Z',
    }).id
  })

  it('insert rồi listRecent trả bản mới nhất trước', () => {
    repo.insert({ targetId, checkedAt: '2026-08-24T00:01:00.000Z', status: 'UP', httpStatus: 200, latencyMs: 120 })
    repo.insert({ targetId, checkedAt: '2026-08-24T00:02:00.000Z', status: 'DOWN', error: 'timeout' })
    const rows = repo.listRecent(targetId, 10)
    expect(rows.map((r) => r.status)).toEqual(['DOWN', 'UP'])
    expect(rows[0]?.error).toBe('timeout')
    expect(rows[0]?.httpStatus).toBeNull()
    expect(rows[1]?.latencyMs).toBe(120)
  })

  it('listRecent tôn trọng limit', () => {
    for (let i = 1; i <= 5; i++) {
      repo.insert({ targetId, checkedAt: `2026-08-24T00:0${i}:00.000Z`, status: 'UP', latencyMs: 100 })
    }
    expect(repo.listRecent(targetId, 2)).toHaveLength(2)
  })

  it('statsSince không có dữ liệu thì trả 0 và avg null', () => {
    expect(repo.statsSince(targetId, '2026-08-24T00:00:00.000Z')).toEqual({
      total: 0, up: 0, down: 0, avgLatencyMs: null,
    })
  })

  it('statsSince tính DEGRADED là up', () => {
    repo.insert({ targetId, checkedAt: '2026-08-24T01:00:00.000Z', status: 'UP', latencyMs: 100 })
    repo.insert({ targetId, checkedAt: '2026-08-24T01:01:00.000Z', status: 'DEGRADED', latencyMs: 3_000 })
    repo.insert({ targetId, checkedAt: '2026-08-24T01:02:00.000Z', status: 'DOWN' })
    const s = repo.statsSince(targetId, '2026-08-24T00:00:00.000Z')
    expect(s.total).toBe(3)
    expect(s.up).toBe(2)
    expect(s.down).toBe(1)
    expect(s.avgLatencyMs).toBe(1_550)
  })

  it('statsSince loại bản ghi cũ hơn mốc since', () => {
    repo.insert({ targetId, checkedAt: '2026-08-23T00:00:00.000Z', status: 'DOWN' })
    repo.insert({ targetId, checkedAt: '2026-08-24T01:00:00.000Z', status: 'UP', latencyMs: 200 })
    const s = repo.statsSince(targetId, '2026-08-24T00:00:00.000Z')
    expect(s.total).toBe(1)
    expect(s.up).toBe(1)
  })

  it('deleteOlderThan xoá đúng số dòng và giữ dòng mới', () => {
    repo.insert({ targetId, checkedAt: '2026-07-01T00:00:00.000Z', status: 'UP', latencyMs: 100 })
    repo.insert({ targetId, checkedAt: '2026-07-02T00:00:00.000Z', status: 'UP', latencyMs: 100 })
    repo.insert({ targetId, checkedAt: '2026-08-24T00:00:00.000Z', status: 'UP', latencyMs: 100 })
    expect(repo.deleteOlderThan('2026-08-01T00:00:00.000Z')).toBe(2)
    expect(repo.listRecent(targetId, 10)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Viết test thất bại cho `meta.repo.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeMetaRepo, type MetaRepo } from '../../src/db/meta.repo.js'

describe('MetaRepo', () => {
  let repo: MetaRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeMetaRepo(db)
  })

  it('get trả null khi chưa có key', () => {
    expect(repo.get('last_digest_date')).toBeNull()
  })

  it('set rồi get trả đúng giá trị', () => {
    repo.set('last_digest_date', '2026-08-24')
    expect(repo.get('last_digest_date')).toBe('2026-08-24')
  })

  it('set lần hai ghi đè, không lỗi trùng khoá', () => {
    repo.set('last_digest_date', '2026-08-24')
    repo.set('last_digest_date', '2026-08-25')
    expect(repo.get('last_digest_date')).toBe('2026-08-25')
  })
})
```

- [ ] **Step 3: Chạy cả hai test để chắc chắn chúng thất bại**

Run: `npx vitest run tests/db/checks.repo.test.ts tests/db/meta.repo.test.ts`
Expected: FAIL — không resolve được hai module mới.

- [ ] **Step 4: Cài đặt `src/db/checks.repo.ts`**

`avgLatencyMs` dùng `avg()` của SQLite, vốn tự bỏ qua giá trị `NULL` — nên dòng DOWN không có latency sẽ không kéo trung bình xuống. Kết quả được làm tròn để không lộ số thập phân vô nghĩa ra Discord.

```ts
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { Db } from './connection.js'
import { checks } from './schema.js'
import type { CheckStats, Status } from '../shared/types.js'

export type InsertCheckInput = {
  targetId: number
  checkedAt: string
  status: Status
  httpStatus?: number | null
  latencyMs?: number | null
  error?: string | null
}

export type CheckRow = {
  id: number
  targetId: number
  checkedAt: string
  status: Status
  httpStatus: number | null
  latencyMs: number | null
  error: string | null
}

export type ChecksRepo = {
  insert(input: InsertCheckInput): void
  listRecent(targetId: number, limit: number): CheckRow[]
  statsSince(targetId: number, sinceIso: string): CheckStats
  deleteOlderThan(cutoffIso: string): number
}

export function makeChecksRepo(db: Db): ChecksRepo {
  return {
    insert(input) {
      db.insert(checks)
        .values({
          targetId: input.targetId,
          checkedAt: input.checkedAt,
          status: input.status,
          httpStatus: input.httpStatus ?? null,
          latencyMs: input.latencyMs ?? null,
          error: input.error ?? null,
        })
        .run()
    },

    listRecent(targetId, limit) {
      return db
        .select()
        .from(checks)
        .where(eq(checks.targetId, targetId))
        .orderBy(desc(checks.checkedAt), desc(checks.id))
        .limit(limit)
        .all()
        .map((r) => ({ ...r, status: r.status as Status }))
    },

    statsSince(targetId, sinceIso) {
      const row = db
        .select({
          total: sql<number>`count(*)`,
          up: sql<number>`sum(case when ${checks.status} <> 'DOWN' then 1 else 0 end)`,
          down: sql<number>`sum(case when ${checks.status} = 'DOWN' then 1 else 0 end)`,
          avgLatency: sql<number | null>`avg(${checks.latencyMs})`,
        })
        .from(checks)
        .where(and(eq(checks.targetId, targetId), gte(checks.checkedAt, sinceIso)))
        .get()

      return {
        total: row?.total ?? 0,
        up: row?.up ?? 0,
        down: row?.down ?? 0,
        avgLatencyMs: row?.avgLatency == null ? null : Math.round(row.avgLatency),
      }
    },

    deleteOlderThan(cutoffIso) {
      return db.delete(checks).where(lt(checks.checkedAt, cutoffIso)).run().changes
    },
  }
}
```

- [ ] **Step 5: Cài đặt `src/db/meta.repo.ts`**

`onConflictDoUpdate` là upsert — nó là lý do `set` gọi lần hai không lỗi trùng khoá.

```ts
import { eq } from 'drizzle-orm'
import type { Db } from './connection.js'
import { meta } from './schema.js'

export type MetaRepo = {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function makeMetaRepo(db: Db): MetaRepo {
  return {
    get(key) {
      const row = db.select().from(meta).where(eq(meta.key, key)).get()
      return row?.value ?? null
    },

    set(key, value) {
      db.insert(meta)
        .values({ key, value })
        .onConflictDoUpdate({ target: meta.key, set: { value } })
        .run()
    },
  }
}
```

- [ ] **Step 6: Chạy test để chắc chắn chúng xanh**

Run: `npx vitest run tests/db/checks.repo.test.ts tests/db/meta.repo.test.ts`
Expected: PASS — 6 test cho checks, 3 test cho meta.

- [ ] **Step 7: Commit**

```bash
git add src/db/checks.repo.ts src/db/meta.repo.ts tests/db/checks.repo.test.ts tests/db/meta.repo.test.ts
git commit -m "feat(db): repo cho bảng checks và meta"
```

---

### Task 6: `incidents.repo.ts`

Repo này chỉ trả **số liệu thô**: danh sách incident chồng lấn khoảng thời gian. Phép tính downtime là hàm thuần nằm ở Task 13, vì tính toán ở JS dễ đọc và dễ test hơn nhiều so với nhồi vào SQL, và số dòng incident luôn nhỏ.

**Files:**
- Create: `src/db/incidents.repo.ts`
- Test: `tests/db/incidents.repo.test.ts`

**Interfaces:**
- Consumes: `Db` từ `src/db/connection.js` · `incidents` từ `src/db/schema.js` · `Incident` từ `src/shared/types.js`
- Produces: `IncidentsRepo` · `makeIncidentsRepo(db: Db): IncidentsRepo` — `open(targetId, reason, atIso): Incident` · `close(targetId, atIso): Incident | null` · `findOpen(targetId): Incident | null` · `listRecent(targetId, limit): Incident[]` · `listOverlapping(targetId, sinceIso): Incident[]`

- [ ] **Step 1: Viết test thất bại**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeIncidentsRepo, type IncidentsRepo } from '../../src/db/incidents.repo.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'

describe('IncidentsRepo', () => {
  let repo: IncidentsRepo
  let targetId: number

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeIncidentsRepo(db)
    targetId = makeTargetsRepo(db).create({
      name: 'web',
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: '2026-08-24T00:00:00.000Z',
    }).id
  })

  it('open tạo incident chưa đóng', () => {
    const inc = repo.open(targetId, 'HTTP 500', '2026-08-24T01:00:00.000Z')
    expect(inc.startedAt).toBe('2026-08-24T01:00:00.000Z')
    expect(inc.endedAt).toBeNull()
    expect(inc.reason).toBe('HTTP 500')
  })

  it('findOpen trả incident đang mở, null khi không có', () => {
    expect(repo.findOpen(targetId)).toBeNull()
    repo.open(targetId, 'timeout', '2026-08-24T01:00:00.000Z')
    expect(repo.findOpen(targetId)?.reason).toBe('timeout')
  })

  it('close đóng incident đang mở và trả bản đã đóng', () => {
    repo.open(targetId, 'timeout', '2026-08-24T01:00:00.000Z')
    const closed = repo.close(targetId, '2026-08-24T01:30:00.000Z')
    expect(closed?.endedAt).toBe('2026-08-24T01:30:00.000Z')
    expect(repo.findOpen(targetId)).toBeNull()
  })

  it('close khi không có incident mở thì trả null', () => {
    expect(repo.close(targetId, '2026-08-24T01:30:00.000Z')).toBeNull()
  })

  it('open hai lần liên tiếp không tạo incident thứ hai', () => {
    repo.open(targetId, 'lần 1', '2026-08-24T01:00:00.000Z')
    const again = repo.open(targetId, 'lần 2', '2026-08-24T01:05:00.000Z')
    expect(again.startedAt).toBe('2026-08-24T01:00:00.000Z')
    expect(repo.listRecent(targetId, 10)).toHaveLength(1)
  })

  it('listRecent trả mới nhất trước', () => {
    repo.open(targetId, 'a', '2026-08-24T01:00:00.000Z')
    repo.close(targetId, '2026-08-24T01:10:00.000Z')
    repo.open(targetId, 'b', '2026-08-24T02:00:00.000Z')
    expect(repo.listRecent(targetId, 10).map((i) => i.reason)).toEqual(['b', 'a'])
  })

  it('listOverlapping lấy incident còn mở dù bắt đầu trước mốc since', () => {
    repo.open(targetId, 'dài', '2026-08-20T00:00:00.000Z')
    const found = repo.listOverlapping(targetId, '2026-08-24T00:00:00.000Z')
    expect(found).toHaveLength(1)
    expect(found[0]?.endedAt).toBeNull()
  })

  it('listOverlapping lấy incident kết thúc trong khoảng', () => {
    repo.open(targetId, 'trong khoảng', '2026-08-23T23:00:00.000Z')
    repo.close(targetId, '2026-08-24T00:30:00.000Z')
    expect(repo.listOverlapping(targetId, '2026-08-24T00:00:00.000Z')).toHaveLength(1)
  })

  it('listOverlapping bỏ incident đã kết thúc trước mốc since', () => {
    repo.open(targetId, 'cũ', '2026-08-20T00:00:00.000Z')
    repo.close(targetId, '2026-08-21T00:00:00.000Z')
    expect(repo.listOverlapping(targetId, '2026-08-24T00:00:00.000Z')).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/db/incidents.repo.test.ts`
Expected: FAIL — không resolve được `src/db/incidents.repo.js`.

- [ ] **Step 3: Cài đặt `src/db/incidents.repo.ts`**

`open` là idempotent: nếu đã có incident mở thì trả về chính nó. Điều này giữ cho dữ liệu đúng khi `runner` gọi `open` hai lần do một lỗi logic hoặc do restart giữa lúc đang down.

```ts
import { and, desc, eq, gte, isNull, or } from 'drizzle-orm'
import type { Db } from './connection.js'
import { incidents } from './schema.js'
import type { Incident } from '../shared/types.js'

type Row = typeof incidents.$inferSelect

function toIncident(row: Row): Incident {
  return {
    id: row.id,
    targetId: row.targetId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    reason: row.reason,
  }
}

export type IncidentsRepo = {
  open(targetId: number, reason: string | null, atIso: string): Incident
  close(targetId: number, atIso: string): Incident | null
  findOpen(targetId: number): Incident | null
  listRecent(targetId: number, limit: number): Incident[]
  listOverlapping(targetId: number, sinceIso: string): Incident[]
}

export function makeIncidentsRepo(db: Db): IncidentsRepo {
  const repo: IncidentsRepo = {
    open(targetId, reason, atIso) {
      const existing = repo.findOpen(targetId)
      if (existing) return existing
      const row = db
        .insert(incidents)
        .values({ targetId, startedAt: atIso, endedAt: null, reason })
        .returning()
        .get()
      return toIncident(row)
    },

    close(targetId, atIso) {
      const open = repo.findOpen(targetId)
      if (!open) return null
      const row = db
        .update(incidents)
        .set({ endedAt: atIso })
        .where(eq(incidents.id, open.id))
        .returning()
        .get()
      return toIncident(row)
    },

    findOpen(targetId) {
      const row = db
        .select()
        .from(incidents)
        .where(and(eq(incidents.targetId, targetId), isNull(incidents.endedAt)))
        .orderBy(desc(incidents.startedAt))
        .get()
      return row ? toIncident(row) : null
    },

    listRecent(targetId, limit) {
      return db
        .select()
        .from(incidents)
        .where(eq(incidents.targetId, targetId))
        .orderBy(desc(incidents.startedAt), desc(incidents.id))
        .limit(limit)
        .all()
        .map(toIncident)
    },

    listOverlapping(targetId, sinceIso) {
      return db
        .select()
        .from(incidents)
        .where(
          and(
            eq(incidents.targetId, targetId),
            or(isNull(incidents.endedAt), gte(incidents.endedAt, sinceIso)),
          ),
        )
        .orderBy(desc(incidents.startedAt))
        .all()
        .map(toIncident)
    },
  }
  return repo
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/db/incidents.repo.test.ts`
Expected: PASS — 9 test.

- [ ] **Step 5: Chạy toàn bộ test và commit**

Run: `npm test`
Expected: toàn bộ PASS.

```bash
git add src/db/incidents.repo.ts tests/db/incidents.repo.test.ts
git commit -m "feat(db): repo cho bảng incidents"
```

---

### Task 7: `monitor/probe.ts` và `monitor/evaluate.ts`

Hai file này là ranh giới của lõi nghiệp vụ. `probe.ts` chỉ chứa hợp đồng — nó là điểm mở rộng cho TCP/ping sau này. `evaluate.ts` là hàm thuần, không I/O, và là nơi **duy nhất** biết luật "thế nào là UP".

**Files:**
- Create: `src/monitor/probe.ts`, `src/monitor/evaluate.ts`
- Test: `tests/monitor/evaluate.test.ts`

**Interfaces:**
- Consumes: `ProbeResult`, `Status`, `Target` từ `src/shared/types.js`
- Produces:
  - `Probe` (type): `{ run(target: Target): Promise<ProbeResult> }` từ `src/monitor/probe.js`
  - `parseExpectedStatus(spec: string): { min: number; max: number }` · `evaluate(result: ProbeResult, target: Target, defaultLatencyThresholdMs: number): Status` từ `src/monitor/evaluate.js`

- [ ] **Step 1: Tạo `src/monitor/probe.ts`**

```ts
import type { ProbeResult, Target } from '../shared/types.js'

export type Probe = {
  run(target: Target): Promise<ProbeResult>
}
```

- [ ] **Step 2: Viết test thất bại cho `evaluate.ts`**

Tạo `tests/monitor/evaluate.test.ts`.

```ts
import { describe, expect, it } from 'vitest'
import { evaluate, parseExpectedStatus } from '../../src/monitor/evaluate.js'
import type { ProbeResult, Target } from '../../src/shared/types.js'

const DEFAULT_LATENCY = 2_000

function target(over: Partial<Target> = {}): Target {
  return {
    id: 1,
    name: 'web',
    url: 'https://a.test',
    method: 'GET',
    expectedStatus: '200-299',
    latencyThresholdMs: null,
    intervalSeconds: 60,
    timeoutMs: 10_000,
    alertChannelId: null,
    pausedUntil: null,
    currentStatus: 'UNKNOWN',
    lastCheckedAt: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    createdBy: 'u1',
    ...over,
  }
}

const ok = (httpStatus: number, latencyMs: number): ProbeResult => ({ ok: true, httpStatus, latencyMs })

describe('parseExpectedStatus', () => {
  it('parse dải hợp lệ', () => {
    expect(parseExpectedStatus('200-299')).toEqual({ min: 200, max: 299 })
  })

  it('parse mã đơn', () => {
    expect(parseExpectedStatus('204')).toEqual({ min: 204, max: 204 })
  })

  it('từ chối dải ngược', () => {
    expect(() => parseExpectedStatus('299-200')).toThrow(/expected_status/)
  })

  it.each(['200,204', '2xx', '20', '', ' 200 ', '200-', '1000'])('từ chối %o', (spec) => {
    expect(() => parseExpectedStatus(spec)).toThrow(/expected_status/)
  })
})

describe('evaluate', () => {
  it('lỗi transport là DOWN', () => {
    const result: ProbeResult = { ok: false, error: 'timeout sau 10000ms' }
    expect(evaluate(result, target(), DEFAULT_LATENCY)).toBe('DOWN')
  })

  it('status trong dải và nhanh là UP', () => {
    expect(evaluate(ok(200, 120), target(), DEFAULT_LATENCY)).toBe('UP')
  })

  it('status biên trên vẫn là UP', () => {
    expect(evaluate(ok(299, 10), target(), DEFAULT_LATENCY)).toBe('UP')
  })

  it('status ngoài dải là DOWN dù nhanh', () => {
    expect(evaluate(ok(500, 10), target(), DEFAULT_LATENCY)).toBe('DOWN')
  })

  it('status 301 ngoài dải 200-299 là DOWN', () => {
    expect(evaluate(ok(301, 10), target(), DEFAULT_LATENCY)).toBe('DOWN')
  })

  it('mã đơn khớp là UP, lệch là DOWN', () => {
    const t = target({ expectedStatus: '204' })
    expect(evaluate(ok(204, 10), t, DEFAULT_LATENCY)).toBe('UP')
    expect(evaluate(ok(200, 10), t, DEFAULT_LATENCY)).toBe('DOWN')
  })

  it('vượt ngưỡng latency mặc định là DEGRADED', () => {
    expect(evaluate(ok(200, 2_001), target(), DEFAULT_LATENCY)).toBe('DEGRADED')
  })

  it('đúng bằng ngưỡng vẫn là UP', () => {
    expect(evaluate(ok(200, 2_000), target(), DEFAULT_LATENCY)).toBe('UP')
  })

  it('ngưỡng riêng của target thắng ngưỡng mặc định', () => {
    const t = target({ latencyThresholdMs: 100 })
    expect(evaluate(ok(200, 150), t, DEFAULT_LATENCY)).toBe('DEGRADED')
  })

  it('chậm nhưng status sai thì DOWN thắng DEGRADED', () => {
    expect(evaluate(ok(503, 9_000), target(), DEFAULT_LATENCY)).toBe('DOWN')
  })
})
```

- [ ] **Step 3: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/monitor/evaluate.test.ts`
Expected: FAIL — không resolve được `src/monitor/evaluate.js`.

- [ ] **Step 4: Cài đặt `src/monitor/evaluate.ts`**

Regex neo hai đầu (`^...$`) là điều làm `' 200 '` và `'200,204'` bị từ chối — đúng như spec yêu cầu: chỉ một dải hoặc một mã.

```ts
import type { ProbeResult, Status, Target } from '../shared/types.js'

const RANGE = /^(\d{3})-(\d{3})$/
const SINGLE = /^(\d{3})$/

export function parseExpectedStatus(spec: string): { min: number; max: number } {
  const range = RANGE.exec(spec)
  if (range) {
    const min = Number(range[1])
    const max = Number(range[2])
    if (min > max) {
      throw new Error(`expected_status không hợp lệ: "${spec}" — dải phải tăng dần`)
    }
    return { min, max }
  }

  const single = SINGLE.exec(spec)
  if (single) {
    const code = Number(single[1])
    return { min: code, max: code }
  }

  throw new Error(
    `expected_status không hợp lệ: "${spec}" — chỉ nhận một dải "NNN-NNN" hoặc một mã "NNN"`,
  )
}

export function evaluate(
  result: ProbeResult,
  target: Target,
  defaultLatencyThresholdMs: number,
): Status {
  if (!result.ok) return 'DOWN'

  const { min, max } = parseExpectedStatus(target.expectedStatus)
  if (result.httpStatus < min || result.httpStatus > max) return 'DOWN'

  const threshold = target.latencyThresholdMs ?? defaultLatencyThresholdMs
  return result.latencyMs > threshold ? 'DEGRADED' : 'UP'
}
```

- [ ] **Step 5: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/monitor/evaluate.test.ts`
Expected: PASS — 19 test.

- [ ] **Step 6: Commit**

```bash
git add src/monitor/probe.ts src/monitor/evaluate.ts tests/monitor/evaluate.test.ts
git commit -m "feat(monitor): interface Probe và hàm evaluate xác định trạng thái"
```

---

### Task 8: `monitor/state-machine.ts`

File này là nơi **duy nhất** cài chính sách alert. Muốn đổi luật sau này chỉ sửa đúng một hàm.

**Files:**
- Create: `src/monitor/state-machine.ts`
- Test: `tests/monitor/state-machine.test.ts`

**Interfaces:**
- Consumes: `Status`, `Transition` từ `src/shared/types.js`
- Produces: `transitionFor(prev: Status, next: Status): Transition | null`

- [ ] **Step 1: Viết test thất bại**

Bảng này chính là đặc tả. Nó liệt kê toàn bộ 16 tổ hợp để không có trường hợp nào bị bỏ sót — và nó ghi cứng quyết định "DEGRADED không bắn alert".

```ts
import { describe, expect, it } from 'vitest'
import { transitionFor } from '../../src/monitor/state-machine.js'
import type { Status, Transition } from '../../src/shared/types.js'

const down: Transition = { kind: 'down' }
const recovered: Transition = { kind: 'recovered' }

describe('transitionFor', () => {
  it.each<[Status, Status, Transition | null]>([
    ['UNKNOWN', 'UP', null],
    ['UNKNOWN', 'DEGRADED', null],
    ['UNKNOWN', 'DOWN', down],
    ['UNKNOWN', 'UNKNOWN', null],

    ['UP', 'UP', null],
    ['UP', 'DEGRADED', null],
    ['UP', 'DOWN', down],
    ['UP', 'UNKNOWN', null],

    ['DEGRADED', 'UP', null],
    ['DEGRADED', 'DEGRADED', null],
    ['DEGRADED', 'DOWN', down],
    ['DEGRADED', 'UNKNOWN', null],

    ['DOWN', 'UP', recovered],
    ['DOWN', 'DEGRADED', recovered],
    ['DOWN', 'DOWN', null],
    ['DOWN', 'UNKNOWN', recovered],
  ])('%s -> %s cho %o', (prev, next, expected) => {
    expect(transitionFor(prev, next)).toEqual(expected)
  })

  it('vào và ra DEGRADED không bao giờ sinh alert', () => {
    expect(transitionFor('UP', 'DEGRADED')).toBeNull()
    expect(transitionFor('DEGRADED', 'UP')).toBeNull()
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/monitor/state-machine.test.ts`
Expected: FAIL — không resolve được `src/monitor/state-machine.js`.

- [ ] **Step 3: Cài đặt `src/monitor/state-machine.ts`**

Luật gói lại thành một câu: alert khi và chỉ khi **tính "đang down" thay đổi**. Viết theo cách này thì cả 16 tổ hợp trong bảng test tự đúng, không cần liệt kê từng nhánh.

```ts
import type { Status, Transition } from '../shared/types.js'

export function transitionFor(prev: Status, next: Status): Transition | null {
  const wasDown = prev === 'DOWN'
  const isDown = next === 'DOWN'

  if (!wasDown && isDown) return { kind: 'down' }
  if (wasDown && !isDown) return { kind: 'recovered' }
  return null
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/monitor/state-machine.test.ts`
Expected: PASS — 17 test.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/state-machine.ts tests/monitor/state-machine.test.ts
git commit -m "feat(monitor): state machine quyết định khi nào bắn alert"
```

---

### Task 9: `monitor/http-probe.ts`

**Files:**
- Create: `src/monitor/http-probe.ts`
- Test: `tests/monitor/http-probe.test.ts`

**Interfaces:**
- Consumes: `Probe` từ `src/monitor/probe.js` · `ProbeResult`, `Target` từ `src/shared/types.js`
- Produces: `HttpProbeOptions` (type) · `makeHttpProbe(opts?: HttpProbeOptions): Probe`
  - `HttpProbeOptions = { attempts?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void>; fetchImpl?: typeof fetch; now?: () => number }`

Quyết định thiết kế cần nắm: probe **chỉ retry lỗi transport** (timeout, DNS, TLS, connection refused), **không retry status code lạ**. Lý do: probe không biết status nào là mong đợi — đó là việc của `evaluate`. Giữ ranh giới này làm cả hai file đơn giản.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/monitor/http-probe.test.ts`. Test dựng server `node:http` thật để bắt được hành vi thật của `fetch` và `AbortSignal.timeout`, thứ mà mock không bao giờ bắt được.

```ts
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeHttpProbe } from '../../src/monitor/http-probe.js'
import type { Target } from '../../src/shared/types.js'

let server: http.Server
let base: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    if (req.url === '/500') {
      res.writeHead(500)
      res.end('lỗi máy chủ')
      return
    }
    if (req.url === '/204') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.url === '/slow') {
      setTimeout(() => {
        res.writeHead(200)
        res.end('cuối cùng cũng xong')
      }, 500)
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function target(over: Partial<Target> = {}): Target {
  return {
    id: 1,
    name: 'web',
    url: `${base}/ok`,
    method: 'GET',
    expectedStatus: '200-299',
    latencyThresholdMs: null,
    intervalSeconds: 60,
    timeoutMs: 2_000,
    alertChannelId: null,
    pausedUntil: null,
    currentStatus: 'UNKNOWN',
    lastCheckedAt: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    createdBy: 'u1',
    ...over,
  }
}

const noSleep = async () => {}

describe('makeHttpProbe với server thật', () => {
  it('trả ok và status 200', async () => {
    const probe = makeHttpProbe({ sleep: noSleep })
    const res = await probe.run(target())
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.httpStatus).toBe(200)
      expect(res.latencyMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('status 500 vẫn là ok:true — probe không phán xét status', async () => {
    const probe = makeHttpProbe({ sleep: noSleep })
    const res = await probe.run(target({ url: `${base}/500` }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.httpStatus).toBe(500)
  })

  it('xử lý được response không có body (204)', async () => {
    const probe = makeHttpProbe({ sleep: noSleep })
    const res = await probe.run(target({ url: `${base}/204` }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.httpStatus).toBe(204)
  })

  it('quá timeout thì trả lỗi có chữ timeout', async () => {
    const probe = makeHttpProbe({ attempts: 1, sleep: noSleep })
    const res = await probe.run(target({ url: `${base}/slow`, timeoutMs: 100 }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/timeout/i)
  })

  it('cổng không ai nghe thì trả lỗi kết nối', async () => {
    const probe = makeHttpProbe({ attempts: 1, sleep: noSleep })
    const res = await probe.run(target({ url: 'http://127.0.0.1:1/ok', timeoutMs: 1_000 }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0)
  })
})

describe('makeHttpProbe với fetch giả', () => {
  it('retry lỗi transport rồi thành công ở lần hai', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls === 1) throw new TypeError('fetch failed')
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({ attempts: 2, fetchImpl, sleep: noSleep })
    const res = await probe.run(target())
    expect(calls).toBe(2)
    expect(res.ok).toBe(true)
  })

  it('KHÔNG retry khi nhận được response, dù status 500', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response('lỗi', { status: 500 })
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({ attempts: 2, fetchImpl, sleep: noSleep })
    await probe.run(target())
    expect(calls).toBe(1)
  })

  it('hết số lần thử thì trả lỗi của lần cuối', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      throw new TypeError(`thất bại lần ${calls}`)
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({ attempts: 2, fetchImpl, sleep: noSleep })
    const res = await probe.run(target())
    expect(calls).toBe(2)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('thất bại lần 2')
  })

  it('chờ đúng retryDelayMs giữa hai lần thử', async () => {
    const waits: number[] = []
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls === 1) throw new TypeError('fetch failed')
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({
      attempts: 2,
      retryDelayMs: 2_000,
      fetchImpl,
      sleep: async (ms) => { waits.push(ms) },
    })
    await probe.run(target())
    expect(waits).toEqual([2_000])
  })

  it('đo latency bằng clock được inject', async () => {
    const stamps = [1_000, 1_250]
    let i = 0
    const fetchImpl = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch

    const probe = makeHttpProbe({
      attempts: 1,
      fetchImpl,
      sleep: noSleep,
      now: () => stamps[i++] ?? 0,
    })
    const res = await probe.run(target())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.latencyMs).toBe(250)
  })

  it('truyền đúng method của target', async () => {
    const methods: string[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      methods.push(String(init.method))
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({ attempts: 1, fetchImpl, sleep: noSleep })
    await probe.run(target({ method: 'HEAD' }))
    expect(methods).toEqual(['HEAD'])
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/monitor/http-probe.test.ts`
Expected: FAIL — không resolve được `src/monitor/http-probe.js`.

- [ ] **Step 3: Cài đặt `src/monitor/http-probe.ts`**

Hai chi tiết dễ bỏ sót và cả hai đều gây bug thật:

1. **Phải đọc hết body** (`res.arrayBuffer()`) dù không dùng. Bỏ body chưa đọc làm keep-alive socket bị treo và rò rỉ dần theo thời gian với một daemon chạy 24/7.
2. **`AbortSignal.timeout` sinh `DOMException` tên `TimeoutError`**, không phải `AbortError`. Phân biệt hai tên này mới cho được message "timeout sau Nms" đúng nghĩa.

```ts
import type { Probe } from './probe.js'
import type { ProbeResult, Target } from '../shared/types.js'

export type HttpProbeOptions = {
  attempts?: number
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: typeof fetch
  now?: () => number
}

function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return `timeout sau ${timeoutMs}ms`
    if (err.name === 'AbortError') return 'bị huỷ trước khi hoàn tất'
    const cause = (err as { cause?: unknown }).cause
    if (cause instanceof Error && cause.message) return `${err.message}: ${cause.message}`
    return err.message
  }
  return String(err)
}

export function makeHttpProbe(opts: HttpProbeOptions = {}): Probe {
  const attempts = opts.attempts ?? 2
  const retryDelayMs = opts.retryDelayMs ?? 2_000
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const doFetch = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => performance.now())

  async function attempt(target: Target): Promise<ProbeResult> {
    const started = now()
    try {
      const res = await doFetch(target.url, {
        method: target.method,
        signal: AbortSignal.timeout(target.timeoutMs),
        redirect: 'follow',
      })
      const latencyMs = Math.round(now() - started)
      // Đọc hết body để giải phóng socket, kể cả khi không cần nội dung.
      await res.arrayBuffer().catch(() => undefined)
      return { ok: true, httpStatus: res.status, latencyMs }
    } catch (err) {
      const latencyMs = Math.round(now() - started)
      return { ok: false, latencyMs, error: describeError(err, target.timeoutMs) }
    }
  }

  return {
    async run(target: Target): Promise<ProbeResult> {
      let last: ProbeResult = { ok: false, error: 'chưa thực hiện lần thử nào' }
      for (let i = 0; i < Math.max(1, attempts); i++) {
        if (i > 0) await sleep(retryDelayMs)
        last = await attempt(target)
        if (last.ok) return last
      }
      return last
    },
  }
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/monitor/http-probe.test.ts`
Expected: PASS — 11 test.

Nếu test timeout thất bại vì message không chứa "timeout": in ra `err.name` thật trong `describeError` và bổ sung tên đó. Node đổi tên lỗi giữa các bản là chuyện có xảy ra.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/http-probe.ts tests/monitor/http-probe.test.ts
git commit -m "feat(monitor): http probe đo latency, timeout và retry lỗi transport"
```

---

### Task 10: `notify/notifier.ts` và `notify/messages.ts`

`messages.ts` dựng `AlertMessage` — dữ liệu thuần, **không import discord.js**. Đây chính là cơ chế giữ cho `monitor` và `digest` không dính vào Discord: chúng chỉ tạo dữ liệu, việc biến thành embed là của Task 15.

**Files:**
- Create: `src/notify/notifier.ts`, `src/notify/messages.ts`
- Test: `tests/notify/messages.test.ts`

**Interfaces:**
- Consumes: `AlertMessage`, `CheckOutcome`, `DigestReport`, `ProbeResult`, `Target` từ `src/shared/types.js` · `formatDuration` từ `src/shared/time.js`
- Produces:
  - `Notifier` (type): `{ send(msg: AlertMessage, channelId: string): Promise<void> }` từ `src/notify/notifier.js`
  - `COLOR_DOWN`, `COLOR_UP`, `COLOR_INFO`, `COLOR_WARN` (number) từ `src/notify/messages.js`
  - `reasonOf(result: ProbeResult): string` · `downMessage(target, result, atIso): AlertMessage` · `recoveredMessage(target, downtimeMs, atIso): AlertMessage` · `manualCheckMessage(outcome, atIso): AlertMessage` · `digestMessage(report, atIso): AlertMessage`

- [ ] **Step 1: Tạo `src/notify/notifier.ts`**

```ts
import type { AlertMessage } from '../shared/types.js'

export type Notifier = {
  send(msg: AlertMessage, channelId: string): Promise<void>
}
```

- [ ] **Step 2: Viết test thất bại cho `messages.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  COLOR_DOWN,
  COLOR_INFO,
  COLOR_UP,
  digestMessage,
  downMessage,
  manualCheckMessage,
  reasonOf,
  recoveredMessage,
} from '../../src/notify/messages.js'
import type { DigestReport, ProbeResult, Target } from '../../src/shared/types.js'

const AT = '2026-08-24T03:04:05.000Z'

function target(over: Partial<Target> = {}): Target {
  return {
    id: 1,
    name: 'web-prod',
    url: 'https://a.test/health',
    method: 'GET',
    expectedStatus: '200-299',
    latencyThresholdMs: null,
    intervalSeconds: 60,
    timeoutMs: 10_000,
    alertChannelId: null,
    pausedUntil: null,
    currentStatus: 'UP',
    lastCheckedAt: null,
    createdAt: AT,
    createdBy: 'u1',
    ...over,
  }
}

describe('reasonOf', () => {
  it('mô tả lỗi transport', () => {
    expect(reasonOf({ ok: false, error: 'timeout sau 10000ms' })).toBe('timeout sau 10000ms')
  })

  it('mô tả status code không mong đợi', () => {
    expect(reasonOf({ ok: true, httpStatus: 503, latencyMs: 40 })).toBe('HTTP 503')
  })
})

describe('downMessage', () => {
  const msg = downMessage(target(), { ok: false, error: 'timeout sau 10000ms' }, AT)

  it('dùng màu đỏ và nêu tên target trong tiêu đề', () => {
    expect(msg.kind).toBe('down')
    expect(msg.color).toBe(COLOR_DOWN)
    expect(msg.title).toContain('web-prod')
  })

  it('đưa url và lý do vào fields', () => {
    const values = msg.fields.map((f) => f.value).join('\n')
    expect(values).toContain('https://a.test/health')
    expect(values).toContain('timeout sau 10000ms')
  })

  it('giữ nguyên mốc thời gian được truyền vào', () => {
    expect(msg.timestampIso).toBe(AT)
  })
})

describe('recoveredMessage', () => {
  const msg = recoveredMessage(target(), 3_725_000, AT)

  it('dùng màu xanh', () => {
    expect(msg.kind).toBe('recovered')
    expect(msg.color).toBe(COLOR_UP)
  })

  it('hiển thị downtime ở dạng người đọc được', () => {
    expect(msg.fields.map((f) => f.value).join('\n')).toContain('1h 2m 5s')
  })
})

describe('manualCheckMessage', () => {
  it('báo UP kèm latency', () => {
    const msg = manualCheckMessage(
      {
        target: target(),
        result: { ok: true, httpStatus: 200, latencyMs: 137 },
        status: 'UP',
        transition: null,
      },
      AT,
    )
    expect(msg.kind).toBe('manual')
    const text = `${msg.description} ${msg.fields.map((f) => f.value).join(' ')}`
    expect(text).toContain('UP')
    expect(text).toContain('137')
  })

  it('báo DOWN kèm lý do', () => {
    const msg = manualCheckMessage(
      {
        target: target(),
        result: { ok: false, error: 'ECONNREFUSED' },
        status: 'DOWN',
        transition: null,
      },
      AT,
    )
    expect(msg.color).toBe(COLOR_DOWN)
    expect(msg.fields.map((f) => f.value).join(' ')).toContain('ECONNREFUSED')
  })
})

describe('digestMessage', () => {
  const report: DigestReport = {
    rangeLabel: '24 giờ qua',
    lines: [
      {
        name: 'web-prod', currentStatus: 'UP', paused: false,
        uptimePct: 99.9, avgLatencyMs: 120, incidentCount: 1, downtimeMs: 65_000,
      },
      {
        name: 'api', currentStatus: 'DOWN', paused: false,
        uptimePct: 50, avgLatencyMs: null, incidentCount: 2, downtimeMs: 3_600_000,
      },
      {
        name: 'staging', currentStatus: 'UNKNOWN', paused: true,
        uptimePct: null, avgLatencyMs: null, incidentCount: 0, downtimeMs: 0,
      },
    ],
  }
  const msg = digestMessage(report, AT)

  it('dùng màu info và nêu khoảng thời gian', () => {
    expect(msg.kind).toBe('digest')
    expect(msg.color).toBe(COLOR_INFO)
    expect(msg.title).toContain('24 giờ qua')
  })

  it('liệt kê đủ mọi target trong description', () => {
    expect(msg.description).toContain('web-prod')
    expect(msg.description).toContain('api')
    expect(msg.description).toContain('staging')
  })

  it('hiển thị uptime và đánh dấu target đang pause', () => {
    expect(msg.description).toContain('99.9%')
    expect(msg.description).toContain('paused')
  })

  it('target chưa có dữ liệu thì không in NaN', () => {
    expect(msg.description).not.toContain('NaN')
  })
})
```

- [ ] **Step 3: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/notify/messages.test.ts`
Expected: FAIL — không resolve được `src/notify/messages.js`.

- [ ] **Step 4: Cài đặt `src/notify/messages.ts`**

Bảng digest được dựng bằng code block để Discord hiển thị đúng cột. `padEnd` trên chuỗi có dấu tiếng Việt vẫn ổn vì tên target bị giới hạn regex `^[a-z0-9-]+$` ở Task 17.

```ts
import { formatDuration } from '../shared/time.js'
import type {
  AlertMessage,
  CheckOutcome,
  DigestReport,
  ProbeResult,
  Target,
} from '../shared/types.js'

export const COLOR_DOWN = 0xed4245
export const COLOR_UP = 0x57f287
export const COLOR_INFO = 0x5865f2
export const COLOR_WARN = 0xfee75c

export function reasonOf(result: ProbeResult): string {
  return result.ok ? `HTTP ${result.httpStatus}` : result.error
}

function latencyText(result: ProbeResult): string {
  return result.latencyMs == null ? 'không đo được' : `${result.latencyMs} ms`
}

export function downMessage(target: Target, result: ProbeResult, atIso: string): AlertMessage {
  return {
    kind: 'down',
    title: `🔴 ${target.name} đang DOWN`,
    description: 'Không đạt điều kiện kiểm tra sức khoẻ.',
    color: COLOR_DOWN,
    fields: [
      { name: 'URL', value: target.url },
      { name: 'Lý do', value: reasonOf(result) },
      { name: 'Latency', value: latencyText(result), inline: true },
      { name: 'Ngưỡng status', value: target.expectedStatus, inline: true },
    ],
    timestampIso: atIso,
  }
}

export function recoveredMessage(target: Target, downtimeMs: number, atIso: string): AlertMessage {
  return {
    kind: 'recovered',
    title: `🟢 ${target.name} đã hồi phục`,
    description: 'Kiểm tra sức khoẻ đã trở lại bình thường.',
    color: COLOR_UP,
    fields: [
      { name: 'URL', value: target.url },
      { name: 'Thời gian gián đoạn', value: formatDuration(downtimeMs), inline: true },
    ],
    timestampIso: atIso,
  }
}

export function manualCheckMessage(outcome: CheckOutcome, atIso: string): AlertMessage {
  const isDown = outcome.status === 'DOWN'
  return {
    kind: 'manual',
    title: `${isDown ? '🔴' : '🟢'} Kết quả kiểm tra ${outcome.target.name}`,
    description: `Trạng thái: **${outcome.status}**`,
    color: isDown ? COLOR_DOWN : outcome.status === 'DEGRADED' ? COLOR_WARN : COLOR_UP,
    fields: [
      { name: 'URL', value: outcome.target.url },
      { name: 'Latency', value: latencyText(outcome.result), inline: true },
      { name: 'Kết quả', value: reasonOf(outcome.result), inline: true },
    ],
    timestampIso: atIso,
  }
}

const STATUS_ICON: Record<string, string> = {
  UP: '🟢', DEGRADED: '🟡', DOWN: '🔴', UNKNOWN: '⚪',
}

export function digestMessage(report: DigestReport, atIso: string): AlertMessage {
  const rows = report.lines.map((l) => {
    const uptime = l.uptimePct == null ? 'chưa có dữ liệu' : `${l.uptimePct}%`
    const latency = l.avgLatencyMs == null ? '-' : `${l.avgLatencyMs}ms`
    const tag = l.paused ? ' (paused)' : ''
    return `${STATUS_ICON[l.currentStatus] ?? '⚪'} ${l.name.padEnd(16)}${uptime.padStart(14)}  ${latency.padStart(8)}  ${String(l.incidentCount).padStart(3)} sự cố  ${formatDuration(l.downtimeMs)}${tag}`
  })

  const body = rows.length > 0 ? rows.join('\n') : 'Chưa có target nào được theo dõi.'

  return {
    kind: 'digest',
    title: `📊 Báo cáo tình trạng — ${report.rangeLabel}`,
    description: `\`\`\`\n${body}\n\`\`\``,
    color: COLOR_INFO,
    fields: [{ name: 'Số target', value: String(report.lines.length), inline: true }],
    timestampIso: atIso,
  }
}
```

- [ ] **Step 5: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/notify/messages.test.ts`
Expected: PASS — 13 test.

- [ ] **Step 6: Xác nhận ràng buộc không import discord.js**

```bash
grep -rn "discord.js" src/monitor src/digest src/notify/messages.ts src/notify/notifier.ts && echo "LỖI: có import discord.js ở nơi bị cấm" || echo "OK: lõi nghiệp vụ sạch discord.js"
```

Expected: in `OK: lõi nghiệp vụ sạch discord.js`.

- [ ] **Step 7: Commit**

```bash
git add src/notify/notifier.ts src/notify/messages.ts tests/notify/messages.test.ts
git commit -m "feat(notify): interface Notifier và bộ dựng AlertMessage thuần"
```

---

### Task 11: `monitor/runner.ts`

Trái tim của hệ thống. Task này là chỗ mọi mảnh trước đó ghép lại, và test của nó là test quan trọng nhất trong toàn bộ dự án: chuỗi `UP → DOWN → DOWN → UP` phải bắn **đúng 2** alert, không phải 3.

**Files:**
- Create: `src/monitor/runner.ts`
- Test: `tests/monitor/runner.test.ts`

**Interfaces:**
- Consumes: `Probe` từ `src/monitor/probe.js` · `evaluate` từ `src/monitor/evaluate.js` · `transitionFor` từ `src/monitor/state-machine.js` · `TargetsRepo` · `ChecksRepo` · `IncidentsRepo` · `Notifier` · `downMessage`, `recoveredMessage`, `reasonOf` từ `src/notify/messages.js` · `AppConfig` · `Clock` · `Logger`
- Produces:
  - `RunnerDeps` (type) · `Runner` (type) · `makeRunner(deps: RunnerDeps): Runner`
  - `Runner` = `{ runCheck(target: Target): Promise<CheckOutcome>; checkByName(name: string): Promise<CheckOutcome | null> }`

- [ ] **Step 1: Viết test thất bại**

Test dùng DB in-memory thật với repo thật, chỉ giả `probe` và `notifier`. Đây là mức tích hợp đúng: nó kiểm cả logic điều phối lẫn việc ghi DB, mà vẫn không cần mạng và không cần Discord.

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeChecksRepo } from '../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../src/db/incidents.repo.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'
import { makeRunner, type Runner } from '../../src/monitor/runner.js'
import type { Probe } from '../../src/monitor/probe.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage, ProbeResult, Target } from '../../src/shared/types.js'

type Sent = { msg: AlertMessage; channelId: string }

function fakeProbe(results: ProbeResult[]): Probe {
  let i = 0
  return { run: async () => results[Math.min(i++, results.length - 1)] as ProbeResult }
}

function setup(results: ProbeResult[], opts: { failNotify?: boolean } = {}) {
  const { db } = openTestDb()
  const sent: Sent[] = []
  const targets = makeTargetsRepo(db)
  const checks = makeChecksRepo(db)
  const incidents = makeIncidentsRepo(db)

  let clockMs = Date.parse('2026-08-24T00:00:00.000Z')
  const advance = (ms: number) => { clockMs += ms }

  const runner = makeRunner({
    probe: fakeProbe(results),
    targets,
    checks,
    incidents,
    notifier: {
      send: async (msg, channelId) => {
        if (opts.failNotify) throw new Error('Discord sập')
        sent.push({ msg, channelId })
      },
    },
    config: { defaultLatencyThresholdMs: 2_000, defaultAlertChannelId: 'default-chan' },
    clock: () => new Date(clockMs),
    logger: silentLogger,
  })

  return { db, targets, checks, incidents, runner, sent, advance }
}

async function seedTarget(targets: ReturnType<typeof makeTargetsRepo>, over: Record<string, unknown> = {}): Promise<Target> {
  return targets.create({
    name: 'web',
    url: 'https://a.test',
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: '2026-08-24T00:00:00.000Z',
    ...over,
  })
}

const UP_RESULT: ProbeResult = { ok: true, httpStatus: 200, latencyMs: 100 }
const DOWN_RESULT: ProbeResult = { ok: false, error: 'timeout sau 10000ms' }

describe('runner.runCheck', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(async () => {
    ctx = setup([UP_RESULT])
    await applyMigrations(ctx.db)
  })

  it('ghi một dòng checks mỗi lần chạy', async () => {
    const t = await seedTarget(ctx.targets)
    await ctx.runner.runCheck(t)
    const rows = ctx.checks.listRecent(t.id, 10)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('UP')
    expect(rows[0]?.httpStatus).toBe(200)
    expect(rows[0]?.latencyMs).toBe(100)
  })

  it('cập nhật currentStatus và lastCheckedAt', async () => {
    const t = await seedTarget(ctx.targets)
    await ctx.runner.runCheck(t)
    const after = ctx.targets.findById(t.id)
    expect(after?.currentStatus).toBe('UP')
    expect(after?.lastCheckedAt).toBe('2026-08-24T00:00:00.000Z')
  })

  it('UNKNOWN -> UP không bắn alert', async () => {
    const t = await seedTarget(ctx.targets)
    await ctx.runner.runCheck(t)
    expect(ctx.sent).toHaveLength(0)
  })
})

describe('runner với chuỗi trạng thái', () => {
  it('UP -> DOWN -> DOWN -> UP bắn đúng 2 alert', async () => {
    const ctx = setup([UP_RESULT, DOWN_RESULT, DOWN_RESULT, UP_RESULT])
    await applyMigrations(ctx.db)
    const t = await seedTarget(ctx.targets)

    let current = t
    for (let i = 0; i < 4; i++) {
      const outcome = await ctx.runner.runCheck(current)
      current = ctx.targets.findById(t.id) as Target
      expect(outcome.target.id).toBe(t.id)
      ctx.advance(60_000)
    }

    expect(ctx.sent.map((s) => s.msg.kind)).toEqual(['down', 'recovered'])
    expect(ctx.checks.listRecent(t.id, 10)).toHaveLength(4)
  })

  it('mở incident khi down và đóng khi hồi phục, kèm downtime đúng', async () => {
    const ctx = setup([DOWN_RESULT, UP_RESULT])
    await applyMigrations(ctx.db)
    const t = await seedTarget(ctx.targets)

    await ctx.runner.runCheck(t)
    expect(ctx.incidents.findOpen(t.id)).not.toBeNull()

    ctx.advance(3_725_000)
    await ctx.runner.runCheck(ctx.targets.findById(t.id) as Target)

    expect(ctx.incidents.findOpen(t.id)).toBeNull()
    const recovered = ctx.sent.find((s) => s.msg.kind === 'recovered')
    expect(recovered?.msg.fields.map((f) => f.value).join(' ')).toContain('1h 2m 5s')
  })

  it('down liên tục nhiều lần chỉ mở một incident', async () => {
    const ctx = setup([DOWN_RESULT, DOWN_RESULT, DOWN_RESULT])
    await applyMigrations(ctx.db)
    const t = await seedTarget(ctx.targets)

    for (let i = 0; i < 3; i++) {
      await ctx.runner.runCheck(ctx.targets.findById(t.id) as Target)
      ctx.advance(60_000)
    }

    expect(ctx.incidents.listRecent(t.id, 10)).toHaveLength(1)
    expect(ctx.sent).toHaveLength(1)
  })

  it('vào DEGRADED không bắn alert nhưng vẫn ghi DB', async () => {
    const ctx = setup([{ ok: true, httpStatus: 200, latencyMs: 5_000 }])
    await applyMigrations(ctx.db)
    const t = await seedTarget(ctx.targets)

    await ctx.runner.runCheck(t)
    expect(ctx.sent).toHaveLength(0)
    expect(ctx.checks.listRecent(t.id, 1)[0]?.status).toBe('DEGRADED')
    expect(ctx.targets.findById(t.id)?.currentStatus).toBe('DEGRADED')
  })
})

describe('runner định tuyến channel', () => {
  it('dùng alertChannelId của target khi có', async () => {
    const ctx = setup([DOWN_RESULT])
    await applyMigrations(ctx.db)
    const t = await seedTarget(ctx.targets, { alertChannelId: 'chan-rieng' })
    await ctx.runner.runCheck(t)
    expect(ctx.sent[0]?.channelId).toBe('chan-rieng')
  })

  it('dùng channel mặc định khi target không khai báo', async () => {
    const ctx = setup([DOWN_RESULT])
    await applyMigrations(ctx.db)
    const t = await seedTarget(ctx.targets)
    await ctx.runner.runCheck(t)
    expect(ctx.sent[0]?.channelId).toBe('default-chan')
  })
})

describe('runner khi Discord lỗi', () => {
  it('vẫn ghi DB và vẫn cập nhật trạng thái, không throw', async () => {
    const ctx = setup([DOWN_RESULT], { failNotify: true })
    await applyMigrations(ctx.db)
    const t = await seedTarget(ctx.targets)

    await expect(ctx.runner.runCheck(t)).resolves.toBeDefined()
    expect(ctx.checks.listRecent(t.id, 1)).toHaveLength(1)
    expect(ctx.targets.findById(t.id)?.currentStatus).toBe('DOWN')
    expect(ctx.incidents.findOpen(t.id)).not.toBeNull()
  })
})

describe('runner.checkByName', () => {
  it('trả null khi không có target', async () => {
    const ctx = setup([UP_RESULT])
    await applyMigrations(ctx.db)
    expect(await ctx.runner.checkByName('không-có')).toBeNull()
  })

  it('chạy check khi tìm thấy target', async () => {
    const ctx = setup([UP_RESULT])
    await applyMigrations(ctx.db)
    await seedTarget(ctx.targets)
    const outcome = await ctx.runner.checkByName('web')
    expect(outcome?.status).toBe('UP')
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/monitor/runner.test.ts`
Expected: FAIL — không resolve được `src/monitor/runner.js`.

- [ ] **Step 3: Cài đặt `src/monitor/runner.ts`**

Thứ tự trong `runCheck` là có chủ đích và không được đổi: **ghi DB trước, notify sau**. Discord lỗi thì ta mất một cái tin nhắn, chứ không mất dữ liệu. `notifySafe` bọc lỗi lại để một lần gửi thất bại không kéo sập cả tick.

```ts
import { evaluate } from './evaluate.js'
import type { Probe } from './probe.js'
import { transitionFor } from './state-machine.js'
import type { ChecksRepo } from '../db/checks.repo.js'
import type { IncidentsRepo } from '../db/incidents.repo.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import { downMessage, reasonOf, recoveredMessage } from '../notify/messages.js'
import type { Notifier } from '../notify/notifier.js'
import type { AppConfig } from '../config.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import type { AlertMessage, CheckOutcome, Target } from '../shared/types.js'

export type RunnerDeps = {
  probe: Probe
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  notifier: Notifier
  config: Pick<AppConfig, 'defaultLatencyThresholdMs' | 'defaultAlertChannelId'>
  clock: Clock
  logger: Logger
}

export type Runner = {
  runCheck(target: Target): Promise<CheckOutcome>
  checkByName(name: string): Promise<CheckOutcome | null>
}

export function makeRunner(deps: RunnerDeps): Runner {
  const channelOf = (target: Target): string =>
    target.alertChannelId ?? deps.config.defaultAlertChannelId

  async function notifySafe(msg: AlertMessage, channelId: string): Promise<void> {
    try {
      await deps.notifier.send(msg, channelId)
    } catch (err) {
      deps.logger.error(`Không gửi được alert vào channel ${channelId}`, err)
    }
  }

  async function runCheck(target: Target): Promise<CheckOutcome> {
    const result = await deps.probe.run(target)
    const status = evaluate(result, target, deps.config.defaultLatencyThresholdMs)
    const at = deps.clock().toISOString()

    deps.checks.insert({
      targetId: target.id,
      checkedAt: at,
      status,
      httpStatus: result.ok ? result.httpStatus : (result.httpStatus ?? null),
      latencyMs: result.latencyMs ?? null,
      error: result.ok ? null : result.error,
    })

    const transition = transitionFor(target.currentStatus, status)

    if (transition?.kind === 'down') {
      deps.incidents.open(target.id, reasonOf(result), at)
      await notifySafe(downMessage(target, result, at), channelOf(target))
    } else if (transition?.kind === 'recovered') {
      const open = deps.incidents.findOpen(target.id)
      deps.incidents.close(target.id, at)
      const downtimeMs = open ? Date.parse(at) - Date.parse(open.startedAt) : 0
      await notifySafe(recoveredMessage(target, downtimeMs, at), channelOf(target))
    }

    deps.targets.updateStatus(target.id, status, at)

    return { target, result, status, transition }
  }

  return {
    runCheck,

    async checkByName(name) {
      const target = deps.targets.findByName(name)
      if (!target) return null
      return runCheck(target)
    },
  }
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/monitor/runner.test.ts`
Expected: PASS — 12 test.

Nếu test "UP -> DOWN -> DOWN -> UP" ra 3 alert: `runCheck` đang đọc `currentStatus` từ biến `target` cũ thay vì bản đã cập nhật. Test cố tình nạp lại target sau mỗi lần chạy để mô phỏng đúng cách scheduler làm việc.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/runner.ts tests/monitor/runner.test.ts
git commit -m "feat(monitor): runner điều phối probe, đánh giá, ghi DB và bắn alert"
```

---

### Task 12: `shared/concurrency.ts` và `monitor/scheduler.ts`

**Files:**
- Create: `src/shared/concurrency.ts`, `src/monitor/scheduler.ts`
- Test: `tests/shared/concurrency.test.ts`, `tests/monitor/scheduler.test.ts`

**Interfaces:**
- Consumes: `Runner` từ `src/monitor/runner.js` · `TargetsRepo` · `AppConfig` · `Clock` · `Logger` · `Target`
- Produces:
  - `runWithLimit<T>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<void>): Promise<void>` từ `src/shared/concurrency.js`
  - `SchedulerDeps` (type) · `Scheduler` (type) · `makeScheduler(deps: SchedulerDeps): Scheduler`
  - `Scheduler` = `{ tick(): Promise<void>; start(): void; stop(): void }`

- [ ] **Step 1: Viết test thất bại cho `concurrency.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { runWithLimit } from '../../src/shared/concurrency.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('runWithLimit', () => {
  it('chạy hết mọi phần tử', async () => {
    const done: number[] = []
    await runWithLimit([1, 2, 3, 4, 5], 2, async (n) => { done.push(n) })
    expect(done.sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('truyền đúng index', async () => {
    const seen: Array<[string, number]> = []
    await runWithLimit(['a', 'b', 'c'], 3, async (item, i) => { seen.push([item, i]) })
    expect(seen.sort()).toEqual([['a', 0], ['b', 1], ['c', 2]])
  })

  it('không bao giờ vượt quá limit tại một thời điểm', async () => {
    let running = 0
    let peak = 0
    const gates = [deferred(), deferred(), deferred(), deferred()]

    const all = runWithLimit([0, 1, 2, 3], 2, async (i) => {
      running++
      peak = Math.max(peak, running)
      await gates[i]?.promise
      running--
    })

    await Promise.resolve()
    expect(peak).toBeLessThanOrEqual(2)
    for (const g of gates) g.resolve()
    await all
    expect(peak).toBe(2)
  })

  it('danh sách rỗng thì trả về ngay', async () => {
    await expect(runWithLimit([], 5, async () => { throw new Error('không được gọi') })).resolves.toBeUndefined()
  })

  it('limit lớn hơn số phần tử vẫn chạy đúng', async () => {
    const done: number[] = []
    await runWithLimit([1, 2], 10, async (n) => { done.push(n) })
    expect(done.sort()).toEqual([1, 2])
  })

  it('không bắt lỗi — task throw thì promise reject', async () => {
    await expect(
      runWithLimit([1], 1, async () => { throw new Error('nổ') }),
    ).rejects.toThrow('nổ')
  })
})
```

- [ ] **Step 2: Cài đặt `src/shared/concurrency.ts`**

Không bắt lỗi là **có chủ đích**: nơi biết cách xử lý lỗi là caller. `scheduler` sẽ tự bọc từng task, nhờ đó một target lỗi không chặn các target còn lại.

```ts
export async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return

  let cursor = 0
  const workerCount = Math.min(Math.max(1, limit), items.length)

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      await task(items[index] as T, index)
    }
  })

  await Promise.all(workers)
}
```

- [ ] **Step 3: Chạy test concurrency để chắc chắn nó xanh**

Run: `npx vitest run tests/shared/concurrency.test.ts`
Expected: PASS — 6 test.

- [ ] **Step 4: Viết test thất bại cho `scheduler.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { makeScheduler } from '../../src/monitor/scheduler.js'
import type { TargetsRepo } from '../../src/db/targets.repo.js'
import type { Runner } from '../../src/monitor/runner.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { CheckOutcome, Target } from '../../src/shared/types.js'

function target(name: string, id: number): Target {
  return {
    id, name, url: `https://${name}.test`, method: 'GET', expectedStatus: '200-299',
    latencyThresholdMs: null, intervalSeconds: 60, timeoutMs: 10_000,
    alertChannelId: null, pausedUntil: null, currentStatus: 'UP',
    lastCheckedAt: null, createdAt: '2026-08-24T00:00:00.000Z', createdBy: 'u1',
  }
}

function setup(due: Target[], runCheck?: Runner['runCheck']) {
  const calls: string[] = []
  const targets = {
    findDue: vi.fn(() => due),
  } as unknown as TargetsRepo

  const runner = {
    runCheck: runCheck ?? (async (t: Target) => {
      calls.push(t.name)
      return { target: t, result: { ok: true, httpStatus: 200, latencyMs: 1 }, status: 'UP', transition: null } as CheckOutcome
    }),
    checkByName: async () => null,
  } as Runner

  const scheduler = makeScheduler({
    targets,
    runner,
    config: { maxConcurrentChecks: 2, tickIntervalMs: 10_000 },
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    logger: silentLogger,
  })

  return { scheduler, calls, targets, runner }
}

describe('scheduler.tick', () => {
  it('gọi runCheck cho từng target tới hạn', async () => {
    const ctx = setup([target('a', 1), target('b', 2)])
    await ctx.scheduler.tick()
    expect(ctx.calls.sort()).toEqual(['a', 'b'])
  })

  it('truyền mốc thời gian từ clock vào findDue', async () => {
    const ctx = setup([])
    await ctx.scheduler.tick()
    expect(ctx.targets.findDue).toHaveBeenCalledWith('2026-08-24T00:00:00.000Z')
  })

  it('không có target tới hạn thì không gọi runCheck', async () => {
    const ctx = setup([])
    await ctx.scheduler.tick()
    expect(ctx.calls).toEqual([])
  })

  it('một target lỗi không chặn các target khác', async () => {
    const done: string[] = []
    const ctx = setup([target('a', 1), target('b', 2), target('c', 3)], async (t) => {
      if (t.name === 'b') throw new Error('probe nổ')
      done.push(t.name)
      return { target: t, result: { ok: true, httpStatus: 200, latencyMs: 1 }, status: 'UP', transition: null } as CheckOutcome
    })

    await expect(ctx.scheduler.tick()).resolves.toBeUndefined()
    expect(done.sort()).toEqual(['a', 'c'])
  })
})

describe('scheduler.start và stop', () => {
  it('start chạy tick theo chu kỳ, stop thì dừng', async () => {
    vi.useFakeTimers()
    try {
      const ctx = setup([target('a', 1)])
      ctx.scheduler.start()

      await vi.advanceTimersByTimeAsync(10_000)
      await vi.advanceTimersByTimeAsync(10_000)
      const afterTwoTicks = ctx.calls.length
      expect(afterTwoTicks).toBeGreaterThanOrEqual(2)

      ctx.scheduler.stop()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(ctx.calls.length).toBe(afterTwoTicks)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop khi chưa start không lỗi', () => {
    const ctx = setup([])
    expect(() => ctx.scheduler.stop()).not.toThrow()
  })
})
```

- [ ] **Step 5: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/monitor/scheduler.test.ts`
Expected: FAIL — không resolve được `src/monitor/scheduler.js`.

- [ ] **Step 6: Cài đặt `src/monitor/scheduler.ts`**

Cờ `running` chặn hai tick chồng lên nhau: nếu một tick chạy lâu hơn `tickIntervalMs` thì tick kế tiếp bị bỏ qua thay vì nhân đôi tải.

```ts
import type { Runner } from './runner.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import type { AppConfig } from '../config.js'
import { runWithLimit } from '../shared/concurrency.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'

export type SchedulerDeps = {
  targets: TargetsRepo
  runner: Runner
  config: Pick<AppConfig, 'maxConcurrentChecks' | 'tickIntervalMs'>
  clock: Clock
  logger: Logger
  onTickDone?: () => Promise<void>
}

export type Scheduler = {
  tick(): Promise<void>
  start(): void
  stop(): void
}

export function makeScheduler(deps: SchedulerDeps): Scheduler {
  let timer: NodeJS.Timeout | null = null
  let running = false

  async function tick(): Promise<void> {
    const nowIso = deps.clock().toISOString()
    const due = deps.targets.findDue(nowIso)

    if (due.length > 0) {
      deps.logger.debug(`Tick: ${due.length} target tới hạn`)
    }

    await runWithLimit(due, deps.config.maxConcurrentChecks, async (target) => {
      try {
        await deps.runner.runCheck(target)
      } catch (err) {
        deps.logger.error(`Check target "${target.name}" thất bại`, err)
      }
    })

    if (deps.onTickDone) {
      try {
        await deps.onTickDone()
      } catch (err) {
        deps.logger.error('Công việc sau tick thất bại', err)
      }
    }
  }

  return {
    tick,

    start() {
      if (timer) return
      timer = setInterval(() => {
        if (running) {
          deps.logger.warn('Tick trước còn đang chạy, bỏ qua tick này')
          return
        }
        running = true
        void tick()
          .catch((err) => deps.logger.error('Tick thất bại', err))
          .finally(() => { running = false })
      }, deps.config.tickIntervalMs)
    },

    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
  }
}
```

- [ ] **Step 7: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/monitor/scheduler.test.ts tests/shared/concurrency.test.ts`
Expected: PASS — 6 test scheduler, 6 test concurrency.

- [ ] **Step 8: Commit**

```bash
git add src/shared/concurrency.ts src/monitor/scheduler.ts tests/shared/concurrency.test.ts tests/monitor/scheduler.test.ts
git commit -m "feat(monitor): scheduler tick loop với giới hạn song song"
```

---

### Task 13: `digest/digest.ts` — phép tính thuần

Toàn bộ số học báo cáo nằm ở đây, dạng hàm thuần. `/uptime` (một target) và digest hằng ngày (mọi target) đều gọi vào đây, nên không có chuyện hai chỗ tính uptime ra hai kết quả khác nhau.

**Files:**
- Create: `src/digest/digest.ts`
- Test: `tests/digest/digest.test.ts`

**Interfaces:**
- Consumes: `CheckStats`, `DigestLine`, `DigestReport`, `Incident`, `Status` từ `src/shared/types.js`
- Produces:
  - `DigestInput` (type): `{ name, currentStatus, paused, stats, incidents }`
  - `sumDowntimeMs(incidents: readonly Incident[], sinceIso: string, nowIso: string): number`
  - `uptimePctOf(stats: CheckStats): number | null`
  - `buildDigest(inputs: readonly DigestInput[], rangeLabel: string, sinceIso: string, nowIso: string): DigestReport`

- [ ] **Step 1: Viết test thất bại**

```ts
import { describe, expect, it } from 'vitest'
import { buildDigest, sumDowntimeMs, uptimePctOf, type DigestInput } from '../../src/digest/digest.js'
import type { Incident } from '../../src/shared/types.js'

const SINCE = '2026-08-24T00:00:00.000Z'
const NOW = '2026-08-25T00:00:00.000Z'

function incident(startedAt: string, endedAt: string | null, id = 1): Incident {
  return { id, targetId: 1, startedAt, endedAt, reason: 'timeout' }
}

describe('sumDowntimeMs', () => {
  it('không có incident thì bằng 0', () => {
    expect(sumDowntimeMs([], SINCE, NOW)).toBe(0)
  })

  it('incident nằm trọn trong khoảng', () => {
    expect(sumDowntimeMs([incident('2026-08-24T01:00:00.000Z', '2026-08-24T01:30:00.000Z')], SINCE, NOW))
      .toBe(30 * 60_000)
  })

  it('cắt phần bắt đầu trước mốc since', () => {
    expect(sumDowntimeMs([incident('2026-08-23T23:00:00.000Z', '2026-08-24T00:30:00.000Z')], SINCE, NOW))
      .toBe(30 * 60_000)
  })

  it('incident còn mở thì tính tới now', () => {
    expect(sumDowntimeMs([incident('2026-08-24T23:00:00.000Z', null)], SINCE, NOW)).toBe(60 * 60_000)
  })

  it('cắt phần kết thúc sau mốc now', () => {
    expect(sumDowntimeMs([incident('2026-08-24T23:00:00.000Z', '2026-08-26T00:00:00.000Z')], SINCE, NOW))
      .toBe(60 * 60_000)
  })

  it('bỏ incident kết thúc trước mốc since', () => {
    expect(sumDowntimeMs([incident('2026-08-20T00:00:00.000Z', '2026-08-21T00:00:00.000Z')], SINCE, NOW)).toBe(0)
  })

  it('cộng nhiều incident', () => {
    const list = [
      incident('2026-08-24T01:00:00.000Z', '2026-08-24T01:10:00.000Z', 1),
      incident('2026-08-24T05:00:00.000Z', '2026-08-24T05:20:00.000Z', 2),
    ]
    expect(sumDowntimeMs(list, SINCE, NOW)).toBe(30 * 60_000)
  })
})

describe('uptimePctOf', () => {
  it('không có check thì trả null, không phải 0', () => {
    expect(uptimePctOf({ total: 0, up: 0, down: 0, avgLatencyMs: null })).toBeNull()
  })

  it('toàn bộ UP là 100', () => {
    expect(uptimePctOf({ total: 10, up: 10, down: 0, avgLatencyMs: 100 })).toBe(100)
  })

  it('toàn bộ DOWN là 0', () => {
    expect(uptimePctOf({ total: 10, up: 0, down: 10, avgLatencyMs: null })).toBe(0)
  })

  it('làm tròn tới một chữ số thập phân', () => {
    expect(uptimePctOf({ total: 1_000, up: 999, down: 1, avgLatencyMs: 100 })).toBe(99.9)
    expect(uptimePctOf({ total: 3, up: 2, down: 1, avgLatencyMs: 100 })).toBe(66.7)
  })
})

describe('buildDigest', () => {
  function input(over: Partial<DigestInput> = {}): DigestInput {
    return {
      name: 'web',
      currentStatus: 'UP',
      paused: false,
      stats: { total: 100, up: 99, down: 1, avgLatencyMs: 120 },
      incidents: [incident('2026-08-24T01:00:00.000Z', '2026-08-24T01:01:00.000Z')],
      ...over,
    }
  }

  it('giữ nguyên nhãn khoảng thời gian', () => {
    expect(buildDigest([input()], '24 giờ qua', SINCE, NOW).rangeLabel).toBe('24 giờ qua')
  })

  it('dựng đủ số liệu cho một target', () => {
    const line = buildDigest([input()], '24 giờ qua', SINCE, NOW).lines[0]
    expect(line?.name).toBe('web')
    expect(line?.uptimePct).toBe(99)
    expect(line?.avgLatencyMs).toBe(120)
    expect(line?.incidentCount).toBe(1)
    expect(line?.downtimeMs).toBe(60_000)
  })

  it('danh sách rỗng cho report rỗng', () => {
    expect(buildDigest([], '24 giờ qua', SINCE, NOW).lines).toEqual([])
  })

  it('xếp DOWN lên trước, rồi DEGRADED, rồi theo tên', () => {
    const inputs = [
      input({ name: 'zulu', currentStatus: 'UP' }),
      input({ name: 'api', currentStatus: 'DOWN' }),
      input({ name: 'cache', currentStatus: 'DEGRADED' }),
      input({ name: 'alpha', currentStatus: 'UP' }),
    ]
    expect(buildDigest(inputs, '24 giờ qua', SINCE, NOW).lines.map((l) => l.name))
      .toEqual(['api', 'cache', 'alpha', 'zulu'])
  })

  it('giữ cờ paused', () => {
    const line = buildDigest([input({ paused: true })], '24 giờ qua', SINCE, NOW).lines[0]
    expect(line?.paused).toBe(true)
  })

  it('target chưa có check thì uptimePct là null', () => {
    const line = buildDigest(
      [input({ stats: { total: 0, up: 0, down: 0, avgLatencyMs: null }, incidents: [] })],
      '24 giờ qua', SINCE, NOW,
    ).lines[0]
    expect(line?.uptimePct).toBeNull()
    expect(line?.downtimeMs).toBe(0)
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/digest/digest.test.ts`
Expected: FAIL — không resolve được `src/digest/digest.js`.

- [ ] **Step 3: Cài đặt `src/digest/digest.ts`**

`Math.max(0, ...)` trong `sumDowntimeMs` là thứ khiến incident nằm ngoài khoảng cho ra 0 thay vì số âm — bỏ nó là uptime sẽ vượt 100%.

```ts
import type { CheckStats, DigestLine, DigestReport, Incident, Status } from '../shared/types.js'

export type DigestInput = {
  name: string
  currentStatus: Status
  paused: boolean
  stats: CheckStats
  incidents: readonly Incident[]
}

export function sumDowntimeMs(
  incidents: readonly Incident[],
  sinceIso: string,
  nowIso: string,
): number {
  const since = Date.parse(sinceIso)
  const now = Date.parse(nowIso)

  let total = 0
  for (const inc of incidents) {
    const start = Math.max(Date.parse(inc.startedAt), since)
    const end = Math.min(inc.endedAt ? Date.parse(inc.endedAt) : now, now)
    total += Math.max(0, end - start)
  }
  return total
}

export function uptimePctOf(stats: CheckStats): number | null {
  if (stats.total === 0) return null
  return Math.round((stats.up / stats.total) * 1_000) / 10
}

const STATUS_RANK: Record<Status, number> = { DOWN: 0, DEGRADED: 1, UNKNOWN: 2, UP: 3 }

export function buildDigest(
  inputs: readonly DigestInput[],
  rangeLabel: string,
  sinceIso: string,
  nowIso: string,
): DigestReport {
  const lines: DigestLine[] = inputs.map((i) => ({
    name: i.name,
    currentStatus: i.currentStatus,
    paused: i.paused,
    uptimePct: uptimePctOf(i.stats),
    avgLatencyMs: i.stats.avgLatencyMs,
    incidentCount: i.incidents.length,
    downtimeMs: sumDowntimeMs(i.incidents, sinceIso, nowIso),
  }))

  lines.sort((a, b) => {
    const rank = STATUS_RANK[a.currentStatus] - STATUS_RANK[b.currentStatus]
    return rank !== 0 ? rank : a.name.localeCompare(b.name)
  })

  return { rangeLabel, lines }
}
```

Chú ý thứ tự xếp: `UNKNOWN` (rank 2) nằm trước `UP` (rank 3) vì một target chưa có dữ liệu đáng để mắt tới hơn một target đang khoẻ. Test "xếp DOWN lên trước" khoá hành vi này lại.

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/digest/digest.test.ts`
Expected: PASS — 18 test.

- [ ] **Step 5: Commit**

```bash
git add src/digest/digest.ts tests/digest/digest.test.ts
git commit -m "feat(digest): phép tính uptime, downtime và dựng báo cáo"
```

---

### Task 14: `digest/schedule.ts` — gửi digest và dọn dữ liệu cũ

**Files:**
- Create: `src/digest/schedule.ts`
- Test: `tests/digest/schedule.test.ts`

**Interfaces:**
- Consumes: `buildDigest`, `DigestInput` từ `src/digest/digest.js` · `digestMessage` từ `src/notify/messages.js` · `Notifier` · `TargetsRepo` · `ChecksRepo` · `IncidentsRepo` · `MetaRepo` · `vnDateString`, `vnHour` từ `src/shared/time.js`
- Produces:
  - `LAST_DIGEST_KEY = 'last_digest_date'`
  - `DigestJobDeps` (type) · `DigestJobResult = { sent: boolean; reason?: string }` · `DigestJob = { maybeSend(): Promise<DigestJobResult> }` · `makeDigestJob(deps): DigestJob`

- [ ] **Step 1: Viết test thất bại**

Test quan trọng nhất là "restart lúc 14h vẫn gửi bù" — đó là lý do ta so ngày lưu trong `meta` chứ không dùng thư viện cron.

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeChecksRepo } from '../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../src/db/incidents.repo.js'
import { makeMetaRepo } from '../../src/db/meta.repo.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'
import { LAST_DIGEST_KEY, makeDigestJob } from '../../src/digest/schedule.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

type Sent = { msg: AlertMessage; channelId: string }

async function setup(nowIso: string, opts: { failNotify?: boolean } = {}) {
  const { db } = openTestDb()
  await applyMigrations(db)

  const targets = makeTargetsRepo(db)
  const checks = makeChecksRepo(db)
  const incidents = makeIncidentsRepo(db)
  const meta = makeMetaRepo(db)
  const sent: Sent[] = []

  const job = makeDigestJob({
    targets, checks, incidents, meta,
    notifier: {
      send: async (msg, channelId) => {
        if (opts.failNotify) throw new Error('Discord sập')
        sent.push({ msg, channelId })
      },
    },
    config: { digestHourLocal: 9, digestChannelId: 'digest-chan', checkRetentionDays: 30 },
    clock: () => new Date(nowIso),
    logger: silentLogger,
  })

  return { targets, checks, incidents, meta, job, sent }
}

function seed(targets: ReturnType<typeof makeTargetsRepo>, name: string) {
  return targets.create({
    name, url: `https://${name}.test`, intervalSeconds: 60, timeoutMs: 10_000,
    createdBy: 'u1', createdAt: '2026-08-24T00:00:00.000Z',
  })
}

// 02:00Z = 09:00 giờ VN — đúng mốc gửi
const AT_9AM_VN = '2026-08-24T02:00:00.000Z'
// 01:00Z = 08:00 giờ VN — chưa tới mốc
const AT_8AM_VN = '2026-08-24T01:00:00.000Z'
// 07:00Z = 14:00 giờ VN — đã quá mốc
const AT_2PM_VN = '2026-08-24T07:00:00.000Z'

describe('digestJob.maybeSend', () => {
  it('chưa tới giờ thì không gửi', async () => {
    const ctx = await setup(AT_8AM_VN)
    const res = await ctx.job.maybeSend()
    expect(res.sent).toBe(false)
    expect(res.reason).toMatch(/chưa tới giờ/)
    expect(ctx.sent).toHaveLength(0)
  })

  it('đúng giờ và chưa gửi hôm nay thì gửi', async () => {
    const ctx = await setup(AT_9AM_VN)
    seed(ctx.targets, 'web')
    const res = await ctx.job.maybeSend()
    expect(res.sent).toBe(true)
    expect(ctx.sent).toHaveLength(1)
    expect(ctx.sent[0]?.channelId).toBe('digest-chan')
    expect(ctx.sent[0]?.msg.kind).toBe('digest')
  })

  it('ghi ngày đã gửi vào meta theo lịch VN', async () => {
    const ctx = await setup(AT_9AM_VN)
    await ctx.job.maybeSend()
    expect(ctx.meta.get(LAST_DIGEST_KEY)).toBe('2026-08-24')
  })

  it('gọi lần hai trong cùng ngày thì không gửi lại', async () => {
    const ctx = await setup(AT_9AM_VN)
    await ctx.job.maybeSend()
    const second = await ctx.job.maybeSend()
    expect(second.sent).toBe(false)
    expect(second.reason).toMatch(/đã gửi/)
    expect(ctx.sent).toHaveLength(1)
  })

  it('restart lúc 14h mà sáng chưa gửi thì vẫn gửi bù', async () => {
    const ctx = await setup(AT_2PM_VN)
    const res = await ctx.job.maybeSend()
    expect(res.sent).toBe(true)
  })

  it('meta ghi ngày hôm qua thì hôm nay vẫn gửi', async () => {
    const ctx = await setup(AT_9AM_VN)
    ctx.meta.set(LAST_DIGEST_KEY, '2026-08-23')
    expect((await ctx.job.maybeSend()).sent).toBe(true)
  })

  it('gửi thất bại thì KHÔNG ghi meta, để lần tick sau thử lại', async () => {
    const ctx = await setup(AT_9AM_VN, { failNotify: true })
    await expect(ctx.job.maybeSend()).rejects.toThrow('Discord sập')
    expect(ctx.meta.get(LAST_DIGEST_KEY)).toBeNull()
  })

  it('không có target nào thì vẫn gửi báo cáo rỗng', async () => {
    const ctx = await setup(AT_9AM_VN)
    expect((await ctx.job.maybeSend()).sent).toBe(true)
    expect(ctx.sent[0]?.msg.description).toContain('Chưa có target')
  })

  it('đánh dấu target đang pause', async () => {
    const ctx = await setup(AT_9AM_VN)
    const t = seed(ctx.targets, 'staging')
    ctx.targets.setPause(t.id, '2026-08-25T00:00:00.000Z')
    await ctx.job.maybeSend()
    expect(ctx.sent[0]?.msg.description).toContain('paused')
  })

  it('target hết hạn pause thì không còn nhãn paused', async () => {
    const ctx = await setup(AT_9AM_VN)
    const t = seed(ctx.targets, 'staging')
    ctx.targets.setPause(t.id, '2026-08-24T01:00:00.000Z')
    await ctx.job.maybeSend()
    expect(ctx.sent[0]?.msg.description).not.toContain('paused')
  })

  it('dọn check cũ hơn CHECK_RETENTION_DAYS và giữ check mới', async () => {
    const ctx = await setup(AT_9AM_VN)
    const t = seed(ctx.targets, 'web')
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-06-01T00:00:00.000Z', status: 'UP', latencyMs: 100 })
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-08-24T01:00:00.000Z', status: 'UP', latencyMs: 100 })

    await ctx.job.maybeSend()

    const left = ctx.checks.listRecent(t.id, 10)
    expect(left).toHaveLength(1)
    expect(left[0]?.checkedAt).toBe('2026-08-24T01:00:00.000Z')
  })

  it('báo cáo tính uptime từ dữ liệu 24 giờ gần nhất', async () => {
    const ctx = await setup(AT_9AM_VN)
    const t = seed(ctx.targets, 'web')
    // Trong khoảng 24h
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-08-23T20:00:00.000Z', status: 'UP', latencyMs: 100 })
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-08-24T01:00:00.000Z', status: 'DOWN' })
    // Ngoài khoảng 24h — không được tính
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-08-20T00:00:00.000Z', status: 'DOWN' })

    await ctx.job.maybeSend()
    expect(ctx.sent[0]?.msg.description).toContain('50%')
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/digest/schedule.test.ts`
Expected: FAIL — không resolve được `src/digest/schedule.js`.

- [ ] **Step 3: Cài đặt `src/digest/schedule.ts`**

Thứ tự cuối hàm quan trọng: **gửi thành công rồi mới ghi `meta`**. Nếu ghi trước, một lần Discord lỗi sẽ làm mất báo cáo của cả ngày hôm đó.

```ts
import { buildDigest, type DigestInput } from './digest.js'
import type { ChecksRepo } from '../db/checks.repo.js'
import type { IncidentsRepo } from '../db/incidents.repo.js'
import type { MetaRepo } from '../db/meta.repo.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import { digestMessage } from '../notify/messages.js'
import type { Notifier } from '../notify/notifier.js'
import type { AppConfig } from '../config.js'
import type { Logger } from '../shared/logger.js'
import { vnDateString, vnHour, type Clock } from '../shared/time.js'
import type { Target } from '../shared/types.js'

export const LAST_DIGEST_KEY = 'last_digest_date'

const DAY_MS = 24 * 60 * 60 * 1_000

export type DigestJobDeps = {
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  meta: MetaRepo
  notifier: Notifier
  config: Pick<AppConfig, 'digestHourLocal' | 'digestChannelId' | 'checkRetentionDays'>
  clock: Clock
  logger: Logger
}

export type DigestJobResult = { sent: boolean; reason?: string }

export type DigestJob = { maybeSend(): Promise<DigestJobResult> }

function isPaused(target: Target, now: Date): boolean {
  return target.pausedUntil !== null && Date.parse(target.pausedUntil) > now.getTime()
}

export function makeDigestJob(deps: DigestJobDeps): DigestJob {
  return {
    async maybeSend(): Promise<DigestJobResult> {
      const now = deps.clock()

      if (vnHour(now) < deps.config.digestHourLocal) {
        return { sent: false, reason: 'chưa tới giờ gửi digest' }
      }

      const today = vnDateString(now)
      if (deps.meta.get(LAST_DIGEST_KEY) === today) {
        return { sent: false, reason: 'đã gửi digest hôm nay' }
      }

      const nowIso = now.toISOString()
      const sinceIso = new Date(now.getTime() - DAY_MS).toISOString()

      const inputs: DigestInput[] = deps.targets.findAll().map((t) => ({
        name: t.name,
        currentStatus: t.currentStatus,
        paused: isPaused(t, now),
        stats: deps.checks.statsSince(t.id, sinceIso),
        incidents: deps.incidents.listOverlapping(t.id, sinceIso),
      }))

      const report = buildDigest(inputs, '24 giờ qua', sinceIso, nowIso)
      await deps.notifier.send(digestMessage(report, nowIso), deps.config.digestChannelId)

      deps.meta.set(LAST_DIGEST_KEY, today)

      const cutoffIso = new Date(
        now.getTime() - deps.config.checkRetentionDays * DAY_MS,
      ).toISOString()
      const removed = deps.checks.deleteOlderThan(cutoffIso)
      if (removed > 0) {
        deps.logger.info(`Đã dọn ${removed} dòng checks cũ hơn ${cutoffIso}`)
      }

      return { sent: true }
    },
  }
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/digest/schedule.test.ts`
Expected: PASS — 12 test.

- [ ] **Step 5: Commit**

```bash
git add src/digest/schedule.ts tests/digest/schedule.test.ts
git commit -m "feat(digest): gửi báo cáo 09:00 giờ VN và dọn dữ liệu cũ"
```

---

### Task 15: `notify/embeds.ts` và `notify/discord-notifier.ts`

Đây là nơi duy nhất trong đường alert biết tới discord.js.

**Files:**
- Create: `src/notify/embeds.ts`, `src/notify/discord-notifier.ts`
- Test: `tests/notify/embeds.test.ts`, `tests/notify/discord-notifier.test.ts`

**Interfaces:**
- Consumes: `AlertMessage` từ `src/shared/types.js` · `Notifier` từ `src/notify/notifier.js` · `Logger`
- Produces:
  - `toEmbed(msg: AlertMessage): EmbedBuilder` từ `src/notify/embeds.js`
  - `ChannelFetcher` (type) · `DiscordNotifierDeps` (type) · `makeDiscordNotifier(deps): Notifier` từ `src/notify/discord-notifier.js`

- [ ] **Step 1: Viết test thất bại cho `embeds.ts`**

Giới hạn của Discord là thật và sẽ làm request bị từ chối nếu vượt: title 256 ký tự, description 4096, field value 1024. Digest với hàng chục target rất dễ vượt 4096, nên phải cắt.

```ts
import { describe, expect, it } from 'vitest'
import { toEmbed } from '../../src/notify/embeds.js'
import type { AlertMessage } from '../../src/shared/types.js'

function msg(over: Partial<AlertMessage> = {}): AlertMessage {
  return {
    kind: 'down',
    title: '🔴 web đang DOWN',
    description: 'Không đạt điều kiện kiểm tra sức khoẻ.',
    color: 0xed4245,
    fields: [
      { name: 'URL', value: 'https://a.test' },
      { name: 'Lý do', value: 'timeout sau 10000ms', inline: true },
    ],
    timestampIso: '2026-08-24T03:04:05.000Z',
    ...over,
  }
}

describe('toEmbed', () => {
  it('chuyển đủ title, description, color', () => {
    const json = toEmbed(msg()).toJSON()
    expect(json.title).toBe('🔴 web đang DOWN')
    expect(json.description).toContain('kiểm tra sức khoẻ')
    expect(json.color).toBe(0xed4245)
  })

  it('chuyển fields kèm cờ inline', () => {
    const json = toEmbed(msg()).toJSON()
    expect(json.fields).toHaveLength(2)
    expect(json.fields?.[0]).toMatchObject({ name: 'URL', value: 'https://a.test' })
    expect(json.fields?.[1]?.inline).toBe(true)
  })

  it('đặt timestamp từ timestampIso', () => {
    const json = toEmbed(msg()).toJSON()
    expect(json.timestamp).toBe(new Date('2026-08-24T03:04:05.000Z').toISOString())
  })

  it('không có field thì vẫn dựng được embed', () => {
    const json = toEmbed(msg({ fields: [] })).toJSON()
    expect(json.fields ?? []).toHaveLength(0)
  })

  it('cắt title vượt 256 ký tự', () => {
    const json = toEmbed(msg({ title: 'x'.repeat(400) })).toJSON()
    expect((json.title as string).length).toBeLessThanOrEqual(256)
  })

  it('cắt description vượt 4096 ký tự', () => {
    const json = toEmbed(msg({ description: 'y'.repeat(5_000) })).toJSON()
    expect((json.description as string).length).toBeLessThanOrEqual(4_096)
  })

  it('cắt field value vượt 1024 ký tự', () => {
    const json = toEmbed(msg({ fields: [{ name: 'Dài', value: 'z'.repeat(2_000) }] })).toJSON()
    expect((json.fields?.[0]?.value as string).length).toBeLessThanOrEqual(1_024)
  })

  it('giới hạn số field ở 25 — mức tối đa Discord nhận', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}`, value: 'v' }))
    const json = toEmbed(msg({ fields: many })).toJSON()
    expect(json.fields?.length).toBeLessThanOrEqual(25)
  })
})
```

- [ ] **Step 2: Cài đặt `src/notify/embeds.ts`**

```ts
import { EmbedBuilder } from 'discord.js'
import type { AlertMessage } from '../shared/types.js'

const MAX_TITLE = 256
const MAX_DESCRIPTION = 4_096
const MAX_FIELD_VALUE = 1_024
const MAX_FIELDS = 25

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function toEmbed(msg: AlertMessage): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(truncate(msg.title, MAX_TITLE))
    .setDescription(truncate(msg.description, MAX_DESCRIPTION))
    .setColor(msg.color)
    .setTimestamp(new Date(msg.timestampIso))

  const fields = msg.fields.slice(0, MAX_FIELDS).map((f) => ({
    name: truncate(f.name, MAX_TITLE),
    value: truncate(f.value, MAX_FIELD_VALUE),
    inline: f.inline ?? false,
  }))

  if (fields.length > 0) embed.addFields(fields)

  return embed
}
```

- [ ] **Step 3: Chạy test embeds để chắc chắn nó xanh**

Run: `npx vitest run tests/notify/embeds.test.ts`
Expected: PASS — 8 test.

- [ ] **Step 4: Viết test thất bại cho `discord-notifier.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { makeDiscordNotifier, type ChannelFetcher } from '../../src/notify/discord-notifier.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

const MSG: AlertMessage = {
  kind: 'down',
  title: '🔴 web đang DOWN',
  description: 'mô tả',
  color: 0xed4245,
  fields: [{ name: 'URL', value: 'https://a.test' }],
  timestampIso: '2026-08-24T03:04:05.000Z',
}

function fakeClient(channel: unknown, opts: { throwOnFetch?: boolean } = {}): ChannelFetcher {
  return {
    channels: {
      fetch: async (id: string) => {
        if (opts.throwOnFetch) throw new Error(`không lấy được channel ${id}`)
        return channel
      },
    },
  }
}

describe('makeDiscordNotifier', () => {
  it('gửi embed vào đúng channel', async () => {
    const send = vi.fn(async () => ({}))
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => true, send }),
      logger: silentLogger,
      sleep: async () => {},
    })

    await notifier.send(MSG, 'chan-1')

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[0] as { embeds: Array<{ toJSON(): { title: string } }> }
    expect(payload.embeds[0]?.toJSON().title).toBe('🔴 web đang DOWN')
  })

  it('channel không tồn tại thì throw', async () => {
    const notifier = makeDiscordNotifier({
      client: fakeClient(null),
      logger: silentLogger,
      sleep: async () => {},
    })
    await expect(notifier.send(MSG, 'chan-1')).rejects.toThrow(/chan-1/)
  })

  it('channel không gửi được tin thì throw', async () => {
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => false }),
      logger: silentLogger,
      sleep: async () => {},
    })
    await expect(notifier.send(MSG, 'chan-1')).rejects.toThrow(/không gửi được tin/)
  })

  it('lỗi lần đầu thì thử lại đúng một lần rồi thành công', async () => {
    let calls = 0
    const send = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('503 từ Discord')
      return {}
    })
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => true, send }),
      logger: silentLogger,
      sleep: async () => {},
    })

    await notifier.send(MSG, 'chan-1')
    expect(calls).toBe(2)
  })

  it('thất bại cả hai lần thì throw lỗi lần cuối', async () => {
    let calls = 0
    const send = vi.fn(async () => {
      calls++
      throw new Error(`lỗi lần ${calls}`)
    })
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => true, send }),
      logger: silentLogger,
      sleep: async () => {},
    })

    await expect(notifier.send(MSG, 'chan-1')).rejects.toThrow('lỗi lần 2')
    expect(calls).toBe(2)
  })

  it('chờ đúng retryDelayMs trước khi thử lại', async () => {
    const waits: number[] = []
    let calls = 0
    const send = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('tạm thời')
      return {}
    })
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => true, send }),
      logger: silentLogger,
      retryDelayMs: 1_500,
      sleep: async (ms) => { waits.push(ms) },
    })

    await notifier.send(MSG, 'chan-1')
    expect(waits).toEqual([1_500])
  })

  it('lỗi khi fetch channel thì throw', async () => {
    const notifier = makeDiscordNotifier({
      client: fakeClient(null, { throwOnFetch: true }),
      logger: silentLogger,
      sleep: async () => {},
    })
    await expect(notifier.send(MSG, 'chan-1')).rejects.toThrow()
  })
})
```

- [ ] **Step 5: Chạy test để chắc chắn nó thất bại**

Run: `npx vitest run tests/notify/discord-notifier.test.ts`
Expected: FAIL — không resolve được `src/notify/discord-notifier.js`.

- [ ] **Step 6: Cài đặt `src/notify/discord-notifier.ts`**

`ChannelFetcher` là interface hẹp mô tả đúng phần ta cần của discord.js `Client`. Nhờ nó, test truyền được client giả mà không phải dựng cả object `Client`, và `Client` thật vẫn khớp về mặt cấu trúc.

```ts
import { toEmbed } from './embeds.js'
import type { Notifier } from './notifier.js'
import type { Logger } from '../shared/logger.js'
import type { AlertMessage } from '../shared/types.js'

type SendableChannel = {
  isTextBased(): boolean
  send(payload: unknown): Promise<unknown>
}

export type ChannelFetcher = {
  channels: { fetch(id: string): Promise<unknown> }
}

export type DiscordNotifierDeps = {
  client: ChannelFetcher
  logger: Logger
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

function asSendable(channel: unknown, channelId: string): SendableChannel {
  if (channel == null) {
    throw new Error(`Không tìm thấy channel ${channelId}`)
  }
  const c = channel as Partial<SendableChannel>
  if (typeof c.isTextBased !== 'function' || !c.isTextBased() || typeof c.send !== 'function') {
    throw new Error(`Channel ${channelId} không gửi được tin nhắn`)
  }
  return c as SendableChannel
}

export function makeDiscordNotifier(deps: DiscordNotifierDeps): Notifier {
  const retryDelayMs = deps.retryDelayMs ?? 1_000
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  return {
    async send(msg: AlertMessage, channelId: string): Promise<void> {
      const channel = asSendable(await deps.client.channels.fetch(channelId), channelId)
      const payload = { embeds: [toEmbed(msg)] }

      try {
        await channel.send(payload)
      } catch (err) {
        deps.logger.warn(`Gửi vào channel ${channelId} thất bại, thử lại một lần`, err)
        await sleep(retryDelayMs)
        await channel.send(payload)
      }
    },
  }
}
```

- [ ] **Step 7: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/notify/discord-notifier.test.ts`
Expected: PASS — 7 test.

- [ ] **Step 8: Commit**

```bash
git add src/notify/embeds.ts src/notify/discord-notifier.ts tests/notify/embeds.test.ts tests/notify/discord-notifier.test.ts
git commit -m "feat(notify): dựng embed và notifier gửi qua discord.js"
```

---

### Task 16: `bot/types.ts`, `bot/permissions.ts`, `bot/router.ts`

Task này dựng khung cho mọi command. Quyết định thiết kế then chốt: **command được viết dựa trên `InteractionLike`, không dựa vào type của discord.js.** Nhờ vậy test command chỉ cần một object thường, không cần dựng interaction thật, và không cần import discord.js.

**Files:**
- Create: `src/bot/types.ts`, `src/bot/permissions.ts`, `src/bot/router.ts`
- Test: `tests/bot/permissions.test.ts`, `tests/bot/router.test.ts`

**Interfaces:**
- Consumes: `AppConfig` · `Logger` · `Clock` · `TargetsRepo` · `ChecksRepo` · `IncidentsRepo` · `Runner`
- Produces (từ `src/bot/types.js`):
  - `EPHEMERAL = 64` (bằng `MessageFlags.Ephemeral` của discord.js)
  - `CHANNEL_TYPE_GUILD_TEXT = 0` (bằng `ChannelType.GuildText`)
  - `InteractionReply = { content?: string; embeds?: unknown[]; flags?: number }`
  - `InteractionLike` (type, xem code bên dưới)
  - `CommandContext = { targets, checks, incidents, runner, config, clock, logger }`
  - `Command = { name: string; data: { name: string; toJSON(): unknown }; adminOnly: boolean; execute(ctx, interaction): Promise<void> }`
- Produces: `isAdmin(userId: string, config: Pick<AppConfig,'adminUserIds'>): boolean` từ `src/bot/permissions.js`
- Produces: `makeRouter(deps: RouterDeps): { handle(interaction: InteractionLike): Promise<void> }` từ `src/bot/router.js`

- [ ] **Step 1: Tạo `src/bot/types.ts`**

`EPHEMERAL` và `CHANNEL_TYPE_GUILD_TEXT` được ghi thẳng số thay vì import enum của discord.js — đó là điều giữ cho toàn bộ file command không phụ thuộc discord.js. Comment ghi rõ nguồn gốc để người sau không tưởng là số ma thuật.

```ts
import type { ChecksRepo } from '../db/checks.repo.js'
import type { IncidentsRepo } from '../db/incidents.repo.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import type { Runner } from '../monitor/runner.js'
import type { AppConfig } from '../config.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'

/** Bằng MessageFlags.Ephemeral của discord.js (1 << 6). */
export const EPHEMERAL = 64

/** Bằng ChannelType.GuildText của discord.js. */
export const CHANNEL_TYPE_GUILD_TEXT = 0

export type InteractionReply = {
  content?: string
  embeds?: unknown[]
  flags?: number
}

export type ChannelOption = { id: string; type: number }

export type InteractionLike = {
  commandName: string
  user: { id: string }
  options: {
    getString(name: string): string | null
    getInteger(name: string): number | null
    getChannel(name: string): ChannelOption | null
  }
  reply(payload: InteractionReply): Promise<unknown>
  deferReply(payload?: InteractionReply): Promise<unknown>
  editReply(payload: InteractionReply): Promise<unknown>
}

export type CommandContext = {
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  runner: Runner
  config: AppConfig
  clock: Clock
  logger: Logger
}

export type Command = {
  name: string
  data: { name: string; toJSON(): unknown }
  adminOnly: boolean
  execute(ctx: CommandContext, interaction: InteractionLike): Promise<void>
}
```

- [ ] **Step 2: Viết test thất bại cho `permissions.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { isAdmin } from '../../src/bot/permissions.js'

const config = { adminUserIds: ['111', '222'] as readonly string[] }

describe('isAdmin', () => {
  it('user trong danh sách là admin', () => {
    expect(isAdmin('111', config)).toBe(true)
    expect(isAdmin('222', config)).toBe(true)
  })

  it('user ngoài danh sách không phải admin', () => {
    expect(isAdmin('333', config)).toBe(false)
  })

  it('so sánh chính xác, không so khớp một phần', () => {
    expect(isAdmin('11', config)).toBe(false)
    expect(isAdmin('1111', config)).toBe(false)
  })

  it('danh sách rỗng thì không ai là admin', () => {
    expect(isAdmin('111', { adminUserIds: [] })).toBe(false)
  })
})
```

- [ ] **Step 3: Cài đặt `src/bot/permissions.ts`**

```ts
import type { AppConfig } from '../config.js'

export function isAdmin(userId: string, config: Pick<AppConfig, 'adminUserIds'>): boolean {
  return config.adminUserIds.includes(userId)
}
```

- [ ] **Step 4: Viết test thất bại cho `router.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { makeRouter } from '../../src/bot/router.js'
import { EPHEMERAL, type Command, type CommandContext, type InteractionLike, type InteractionReply } from '../../src/bot/types.js'
import { silentLogger } from '../../src/shared/logger.js'

function fakeInteraction(commandName: string, userId: string) {
  const replies: InteractionReply[] = []
  const interaction: InteractionLike = {
    commandName,
    user: { id: userId },
    options: {
      getString: () => null,
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: async (p) => { replies.push(p); return {} },
    deferReply: async () => ({}),
    editReply: async (p) => { replies.push(p); return {} },
  }
  return { interaction, replies }
}

function command(name: string, adminOnly: boolean, execute = vi.fn(async () => {})): Command {
  return { name, adminOnly, data: { name, toJSON: () => ({}) }, execute }
}

function setup(commands: Command[]) {
  const ctx = {} as CommandContext
  const router = makeRouter({
    commands,
    ctx,
    config: { adminUserIds: ['admin-1'] },
    logger: silentLogger,
  })
  return { router }
}

describe('router.handle', () => {
  it('route tới command đúng tên', async () => {
    const exec = vi.fn(async () => {})
    const { router } = setup([command('status', false, exec), command('list', false)])
    const { interaction } = fakeInteraction('status', 'user-1')

    await router.handle(interaction)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('lệnh không tồn tại thì trả lời ephemeral, không throw', async () => {
    const { router } = setup([command('status', false)])
    const { interaction, replies } = fakeInteraction('không-có', 'user-1')

    await expect(router.handle(interaction)).resolves.toBeUndefined()
    expect(replies[0]?.content).toMatch(/không nhận ra/i)
    expect(replies[0]?.flags).toBe(EPHEMERAL)
  })

  it('chặn user thường dùng lệnh adminOnly', async () => {
    const exec = vi.fn(async () => {})
    const { router } = setup([command('add', true, exec)])
    const { interaction, replies } = fakeInteraction('add', 'user-thuong')

    await router.handle(interaction)
    expect(exec).not.toHaveBeenCalled()
    expect(replies[0]?.content).toMatch(/không có quyền/i)
    expect(replies[0]?.flags).toBe(EPHEMERAL)
  })

  it('cho admin dùng lệnh adminOnly', async () => {
    const exec = vi.fn(async () => {})
    const { router } = setup([command('add', true, exec)])
    const { interaction } = fakeInteraction('add', 'admin-1')

    await router.handle(interaction)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('cho mọi người dùng lệnh không adminOnly', async () => {
    const exec = vi.fn(async () => {})
    const { router } = setup([command('list', false, exec)])
    const { interaction } = fakeInteraction('list', 'user-thuong')

    await router.handle(interaction)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('command throw thì trả lời lỗi và KHÔNG throw ra ngoài', async () => {
    const exec = vi.fn(async () => { throw new Error('lệnh nổ') })
    const { router } = setup([command('status', false, exec)])
    const { interaction, replies } = fakeInteraction('status', 'user-1')

    await expect(router.handle(interaction)).resolves.toBeUndefined()
    expect(replies.at(-1)?.content).toMatch(/có lỗi/i)
  })

  it('command throw sau khi đã reply thì không làm sập router', async () => {
    const exec = vi.fn(async (_ctx: CommandContext, it: InteractionLike) => {
      await it.reply({ content: 'xong một phần' })
      throw new Error('nổ sau khi reply')
    })
    const { router } = setup([command('status', false, exec)])
    const { interaction } = fakeInteraction('status', 'user-1')

    await expect(router.handle(interaction)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 5: Chạy hai test để chắc chắn chúng thất bại**

Run: `npx vitest run tests/bot/permissions.test.ts tests/bot/router.test.ts`
Expected: FAIL — không resolve được `src/bot/permissions.js` và `src/bot/router.js`.

- [ ] **Step 6: Cài đặt `src/bot/router.ts`**

`replySafe` bọc cả lần trả lời lỗi: nếu interaction đã được reply rồi thì lần reply thứ hai của discord.js sẽ throw, và ta không muốn lỗi đó nuốt mất log của lỗi gốc.

```ts
import { isAdmin } from './permissions.js'
import { EPHEMERAL, type Command, type CommandContext, type InteractionLike } from './types.js'
import type { AppConfig } from '../config.js'
import type { Logger } from '../shared/logger.js'

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
  const byName = new Map(deps.commands.map((c) => [c.name, c]))

  async function replySafe(interaction: InteractionLike, content: string): Promise<void> {
    try {
      await interaction.reply({ content, flags: EPHEMERAL })
    } catch (err) {
      deps.logger.warn('Không trả lời được interaction', err)
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
      } catch (err) {
        deps.logger.error(`Lệnh /${command.name} thất bại`, err)
        await replySafe(interaction, 'Đã có lỗi khi chạy lệnh này. Xem log của bot để biết chi tiết.')
      }
    },
  }
}
```

- [ ] **Step 7: Chạy test để chắc chắn chúng xanh**

Run: `npx vitest run tests/bot/permissions.test.ts tests/bot/router.test.ts`
Expected: PASS — 4 test permissions, 7 test router.

- [ ] **Step 8: Commit**

```bash
git add src/bot/types.ts src/bot/permissions.ts src/bot/router.ts tests/bot/permissions.test.ts tests/bot/router.test.ts
git commit -m "feat(bot): khung command, phân quyền và router interaction"
```

---

### Task 17: `bot/validate.ts` và lệnh `/add`, `/remove`, `/list`

**Files:**
- Create: `src/bot/validate.ts`, `src/bot/commands/add.ts`, `src/bot/commands/remove.ts`, `src/bot/commands/list.ts`
- Test: `tests/bot/validate.test.ts`, `tests/bot/commands/add.test.ts`, `tests/bot/commands/remove-list.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandContext`, `InteractionLike`, `EPHEMERAL`, `CHANNEL_TYPE_GUILD_TEXT` từ `src/bot/types.js` · `parseExpectedStatus` từ `src/monitor/evaluate.js` · `formatDuration` từ `src/shared/time.js`
- Produces:
  - `ValidationError` (class) · `validateName(v)` · `validateUrl(v)` · `validateRange(label, v, min, max)` · `validateChannel(ch)` từ `src/bot/validate.js`
  - `addCommand: Command` · `removeCommand: Command` · `listCommand: Command`

- [ ] **Step 1: Viết test thất bại cho `validate.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { ValidationError, validateChannel, validateName, validateRange, validateUrl } from '../../src/bot/validate.js'

describe('validateName', () => {
  it.each(['web', 'web-prod', 'api2', 'a'])('nhận %o', (n) => {
    expect(validateName(n)).toBe(n)
  })

  it.each(['Web', 'web_prod', 'web prod', '', 'a'.repeat(33), 'wéb'])('từ chối %o', (n) => {
    expect(() => validateName(n)).toThrow(ValidationError)
  })

  it('message nêu rõ quy tắc', () => {
    expect(() => validateName('Web')).toThrow(/chữ thường/)
  })
})

describe('validateUrl', () => {
  it.each(['http://a.test', 'https://a.test/health?x=1'])('nhận %o', (u) => {
    expect(validateUrl(u)).toBe(u)
  })

  it.each(['ftp://a.test', 'a.test', '', 'javascript:alert(1)'])('từ chối %o', (u) => {
    expect(() => validateUrl(u)).toThrow(ValidationError)
  })

  it('message nêu rõ chỉ nhận http và https', () => {
    expect(() => validateUrl('ftp://a.test')).toThrow(/https?/)
  })
})

describe('validateRange', () => {
  it('trả giá trị khi nằm trong biên', () => {
    expect(validateRange('interval', 60, 10, 86_400)).toBe(60)
  })

  it('nhận đúng giá trị biên', () => {
    expect(validateRange('interval', 10, 10, 86_400)).toBe(10)
    expect(validateRange('interval', 86_400, 10, 86_400)).toBe(86_400)
  })

  it('từ chối dưới biên dưới và trên biên trên, message có tên tham số', () => {
    expect(() => validateRange('interval', 9, 10, 86_400)).toThrow(/interval/)
    expect(() => validateRange('interval', 86_401, 10, 86_400)).toThrow(/interval/)
  })
})

describe('validateChannel', () => {
  it('nhận text channel của guild', () => {
    expect(validateChannel({ id: 'c1', type: 0 })).toBe('c1')
  })

  it('từ chối loại channel khác', () => {
    expect(() => validateChannel({ id: 'c1', type: 2 })).toThrow(ValidationError)
  })
})
```

- [ ] **Step 2: Cài đặt `src/bot/validate.ts`**

`new URL(...)` là cách duy nhất đáng tin để kiểm URL — regex tự viết luôn sai ở đâu đó. Chặn scheme ngoài `http`/`https` là để không ai nhét được `javascript:` hay `file:` vào danh sách theo dõi.

```ts
import { CHANNEL_TYPE_GUILD_TEXT, type ChannelOption } from './types.js'

export class ValidationError extends Error {}

const NAME_RE = /^[a-z0-9-]{1,32}$/

export function validateName(value: string): string {
  if (!NAME_RE.test(value)) {
    throw new ValidationError(
      'Tên chỉ được dùng chữ thường, số và dấu gạch ngang, dài 1-32 ký tự.',
    )
  }
  return value
}

export function validateUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ValidationError('URL không đọc được. Ví dụ hợp lệ: https://example.com/health')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('URL chỉ nhận scheme http hoặc https.')
  }
  return value
}

export function validateRange(label: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${label} phải là số nguyên trong khoảng ${min}-${max}.`)
  }
  return value
}

export function validateChannel(channel: ChannelOption): string {
  if (channel.type !== CHANNEL_TYPE_GUILD_TEXT) {
    throw new ValidationError('Channel nhận alert phải là text channel của server.')
  }
  return channel.id
}
```

- [ ] **Step 3: Chạy test validate để chắc chắn nó xanh**

Run: `npx vitest run tests/bot/validate.test.ts`
Expected: PASS — 20 test.

- [ ] **Step 4: Viết test thất bại cho `/add`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { addCommand } from '../../../src/bot/commands/add.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeChecksRepo } from '../../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../../src/db/incidents.repo.js'
import { makeTargetsRepo } from '../../../src/db/targets.repo.js'
import { silentLogger } from '../../../src/shared/logger.js'
import type { Runner } from '../../../src/monitor/runner.js'

type Opts = { name?: string; url?: string; interval?: number; timeout?: number; latency?: number; channel?: { id: string; type: number } }

function interaction(opts: Opts, userId = 'admin-1') {
  const replies: InteractionReply[] = []
  const it: InteractionLike = {
    commandName: 'add',
    user: { id: userId },
    options: {
      getString: (n) => (n === 'name' ? opts.name ?? null : n === 'url' ? opts.url ?? null : null),
      getInteger: (n) =>
        n === 'interval' ? opts.interval ?? null
        : n === 'timeout' ? opts.timeout ?? null
        : n === 'latency' ? opts.latency ?? null
        : null,
      getChannel: () => opts.channel ?? null,
    },
    reply: async (p) => { replies.push(p); return {} },
    deferReply: async () => ({}),
    editReply: async (p) => { replies.push(p); return {} },
  }
  return { it, replies }
}

let ctx: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  ctx = {
    targets: makeTargetsRepo(db),
    checks: makeChecksRepo(db),
    incidents: makeIncidentsRepo(db),
    runner: {} as Runner,
    config: {
      defaultIntervalSeconds: 60,
      defaultTimeoutMs: 10_000,
      defaultLatencyThresholdMs: 2_000,
    } as CommandContext['config'],
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    logger: silentLogger,
  }
})

describe('/add', () => {
  it('khai báo là lệnh admin', () => {
    expect(addCommand.adminOnly).toBe(true)
    expect(addCommand.name).toBe('add')
  })

  it('tạo target với default từ config', async () => {
    const { it: i, replies } = interaction({ name: 'web', url: 'https://a.test' })
    await addCommand.execute(ctx, i)

    const t = ctx.targets.findByName('web')
    expect(t?.url).toBe('https://a.test')
    expect(t?.intervalSeconds).toBe(60)
    expect(t?.timeoutMs).toBe(10_000)
    expect(t?.latencyThresholdMs).toBeNull()
    expect(t?.createdBy).toBe('admin-1')
    expect(t?.createdAt).toBe('2026-08-24T00:00:00.000Z')
    expect(replies[0]?.content).toContain('web')
  })

  it('nhận tham số tuỳ chọn', async () => {
    const { it: i } = interaction({
      name: 'api', url: 'https://b.test', interval: 120, timeout: 5_000, latency: 800,
      channel: { id: 'chan-9', type: 0 },
    })
    await addCommand.execute(ctx, i)

    const t = ctx.targets.findByName('api')
    expect(t?.intervalSeconds).toBe(120)
    expect(t?.timeoutMs).toBe(5_000)
    expect(t?.latencyThresholdMs).toBe(800)
    expect(t?.alertChannelId).toBe('chan-9')
  })

  it('thiếu name hoặc url thì trả lời lỗi, không tạo gì', async () => {
    const { it: i, replies } = interaction({ url: 'https://a.test' })
    await addCommand.execute(ctx, i)
    expect(ctx.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/bắt buộc/i)
  })

  it('tên sai định dạng thì trả lời lỗi và không tạo', async () => {
    const { it: i, replies } = interaction({ name: 'Web Prod', url: 'https://a.test' })
    await addCommand.execute(ctx, i)
    expect(ctx.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/chữ thường/)
  })

  it('url sai scheme thì trả lời lỗi và không tạo', async () => {
    const { it: i, replies } = interaction({ name: 'web', url: 'ftp://a.test' })
    await addCommand.execute(ctx, i)
    expect(ctx.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/http/)
  })

  it('interval ngoài biên thì trả lời lỗi', async () => {
    const { it: i, replies } = interaction({ name: 'web', url: 'https://a.test', interval: 5 })
    await addCommand.execute(ctx, i)
    expect(ctx.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/interval/)
  })

  it('channel không phải text channel thì trả lời lỗi', async () => {
    const { it: i, replies } = interaction({
      name: 'web', url: 'https://a.test', channel: { id: 'voice-1', type: 2 },
    })
    await addCommand.execute(ctx, i)
    expect(ctx.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/text channel/)
  })

  it('trùng tên thì trả lời thân thiện, không throw', async () => {
    const first = interaction({ name: 'web', url: 'https://a.test' })
    await addCommand.execute(ctx, first.it)

    const second = interaction({ name: 'web', url: 'https://b.test' })
    await expect(addCommand.execute(ctx, second.it)).resolves.toBeUndefined()
    expect(second.replies[0]?.content).toMatch(/đã tồn tại/i)
    expect(ctx.targets.findByName('web')?.url).toBe('https://a.test')
  })

  it('data toJSON được để đăng ký lên Discord', () => {
    const json = addCommand.data.toJSON() as { name: string }
    expect(json.name).toBe('add')
  })
})
```

- [ ] **Step 5: Cài đặt `src/bot/commands/add.ts`**

Kiểm tra trùng tên **trước** khi insert để trả lời thân thiện, thay vì để lỗi `UNIQUE` của SQLite bay ra ngoài.

```ts
import { SlashCommandBuilder } from 'discord.js'
import { ValidationError, validateChannel, validateName, validateRange, validateUrl } from '../validate.js'
import { EPHEMERAL, type Command } from '../types.js'

export const addCommand: Command = {
  name: 'add',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('Thêm một endpoint vào danh sách theo dõi')
    .addStringOption((o) => o.setName('name').setDescription('Tên ngắn, chữ thường và gạch ngang').setRequired(true))
    .addStringOption((o) => o.setName('url').setDescription('URL http/https cần kiểm tra').setRequired(true))
    .addIntegerOption((o) => o.setName('interval').setDescription('Chu kỳ check, tính bằng giây'))
    .addIntegerOption((o) => o.setName('timeout').setDescription('Timeout mỗi lần check, tính bằng ms'))
    .addIntegerOption((o) => o.setName('latency').setDescription('Ngưỡng latency coi là DEGRADED, tính bằng ms'))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel nhận alert riêng cho endpoint này')),

  async execute(ctx, interaction) {
    const rawName = interaction.options.getString('name')
    const rawUrl = interaction.options.getString('url')

    if (!rawName || !rawUrl) {
      await interaction.reply({ content: '`name` và `url` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    try {
      const name = validateName(rawName)
      const url = validateUrl(rawUrl)

      const intervalSeconds = validateRange(
        'interval',
        interaction.options.getInteger('interval') ?? ctx.config.defaultIntervalSeconds,
        10, 86_400,
      )
      const timeoutMs = validateRange(
        'timeout',
        interaction.options.getInteger('timeout') ?? ctx.config.defaultTimeoutMs,
        1_000, 60_000,
      )

      const rawLatency = interaction.options.getInteger('latency')
      const latencyThresholdMs = rawLatency === null
        ? null
        : validateRange('latency', rawLatency, 1, 600_000)

      const channel = interaction.options.getChannel('channel')
      const alertChannelId = channel === null ? null : validateChannel(channel)

      if (ctx.targets.findByName(name)) {
        await interaction.reply({ content: `Target \`${name}\` đã tồn tại.`, flags: EPHEMERAL })
        return
      }

      ctx.targets.create({
        name, url, intervalSeconds, timeoutMs, latencyThresholdMs, alertChannelId,
        createdBy: interaction.user.id,
        createdAt: ctx.clock().toISOString(),
      })

      await interaction.reply({
        content: `Đã thêm \`${name}\` → ${url} (mỗi ${intervalSeconds}s, timeout ${timeoutMs}ms).`,
      })
    } catch (err) {
      if (err instanceof ValidationError) {
        await interaction.reply({ content: err.message, flags: EPHEMERAL })
        return
      }
      throw err
    }
  },
}
```

- [ ] **Step 6: Chạy test `/add` để chắc chắn nó xanh**

Run: `npx vitest run tests/bot/commands/add.test.ts`
Expected: PASS — 10 test.

- [ ] **Step 7: Viết test thất bại cho `/remove` và `/list`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { listCommand } from '../../../src/bot/commands/list.js'
import { removeCommand } from '../../../src/bot/commands/remove.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeChecksRepo } from '../../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../../src/db/incidents.repo.js'
import { makeTargetsRepo } from '../../../src/db/targets.repo.js'
import { silentLogger } from '../../../src/shared/logger.js'
import type { Runner } from '../../../src/monitor/runner.js'

function interaction(commandName: string, name?: string) {
  const replies: InteractionReply[] = []
  const it: InteractionLike = {
    commandName,
    user: { id: 'admin-1' },
    options: {
      getString: (n) => (n === 'name' ? name ?? null : null),
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: async (p) => { replies.push(p); return {} },
    deferReply: async () => ({}),
    editReply: async (p) => { replies.push(p); return {} },
  }
  return { it, replies }
}

let ctx: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  ctx = {
    targets: makeTargetsRepo(db),
    checks: makeChecksRepo(db),
    incidents: makeIncidentsRepo(db),
    runner: {} as Runner,
    config: {} as CommandContext['config'],
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    logger: silentLogger,
  }
})

function seed(name: string) {
  return ctx.targets.create({
    name, url: `https://${name}.test`, intervalSeconds: 60, timeoutMs: 10_000,
    createdBy: 'u1', createdAt: '2026-08-24T00:00:00.000Z',
  })
}

describe('/remove', () => {
  it('là lệnh admin', () => {
    expect(removeCommand.adminOnly).toBe(true)
  })

  it('xoá được target đang có', async () => {
    seed('web')
    const { it: i, replies } = interaction('remove', 'web')
    await removeCommand.execute(ctx, i)
    expect(ctx.targets.findByName('web')).toBeNull()
    expect(replies[0]?.content).toContain('web')
  })

  it('target không tồn tại thì trả lời thân thiện', async () => {
    const { it: i, replies } = interaction('remove', 'không-có')
    await removeCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('thiếu name thì trả lời lỗi', async () => {
    const { it: i, replies } = interaction('remove')
    await removeCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/bắt buộc/i)
  })
})

describe('/list', () => {
  it('không phải lệnh admin', () => {
    expect(listCommand.adminOnly).toBe(false)
  })

  it('danh sách rỗng thì nói rõ', async () => {
    const { it: i, replies } = interaction('list')
    await listCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/chưa có target/i)
  })

  it('liệt kê target kèm url và chu kỳ', async () => {
    seed('web')
    seed('api')
    const { it: i, replies } = interaction('list')
    await listCommand.execute(ctx, i)
    const text = replies[0]?.content ?? ''
    expect(text).toContain('web')
    expect(text).toContain('api')
    expect(text).toContain('https://web.test')
    expect(text).toContain('60s')
  })

  it('đánh dấu target đang pause', async () => {
    const t = seed('staging')
    ctx.targets.setPause(t.id, '2026-08-25T00:00:00.000Z')
    const { it: i, replies } = interaction('list')
    await listCommand.execute(ctx, i)
    expect(replies[0]?.content).toContain('paused')
  })
})
```

- [ ] **Step 8: Cài đặt `src/bot/commands/remove.ts`**

```ts
import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command } from '../types.js'

export const removeCommand: Command = {
  name: 'remove',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Bỏ một endpoint khỏi danh sách theo dõi')
    .addStringOption((o) => o.setName('name').setDescription('Tên target cần xoá').setRequired(true)),

  async execute(ctx, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const removed = ctx.targets.remove(name)
    await interaction.reply({
      content: removed
        ? `Đã xoá \`${name}\` cùng toàn bộ lịch sử check và sự cố của nó.`
        : `Không tìm thấy target \`${name}\`.`,
      flags: removed ? undefined : EPHEMERAL,
    })
  },
}
```

- [ ] **Step 9: Cài đặt `src/bot/commands/list.ts`**

```ts
import { SlashCommandBuilder } from 'discord.js'
import type { Command } from '../types.js'
import type { Target } from '../../shared/types.js'

const STATUS_ICON: Record<string, string> = {
  UP: '🟢', DEGRADED: '🟡', DOWN: '🔴', UNKNOWN: '⚪',
}

function isPaused(t: Target, now: Date): boolean {
  return t.pausedUntil !== null && Date.parse(t.pausedUntil) > now.getTime()
}

export const listCommand: Command = {
  name: 'list',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('Liệt kê mọi endpoint đang theo dõi'),

  async execute(ctx, interaction) {
    const now = ctx.clock()
    const all = ctx.targets.findAll()

    if (all.length === 0) {
      await interaction.reply({ content: 'Chưa có target nào. Dùng `/add` để thêm.' })
      return
    }

    const rows = all.map((t) => {
      const icon = STATUS_ICON[t.currentStatus] ?? '⚪'
      const tag = isPaused(t, now) ? ' (paused)' : ''
      return `${icon} ${t.name} — ${t.url} — mỗi ${t.intervalSeconds}s${tag}`
    })

    await interaction.reply({ content: `**${all.length} target đang theo dõi**\n${rows.join('\n')}` })
  },
}
```

- [ ] **Step 10: Chạy test và commit**

Run: `npx vitest run tests/bot/commands/remove-list.test.ts`
Expected: PASS — 8 test.

```bash
git add src/bot/validate.ts src/bot/commands tests/bot/validate.test.ts tests/bot/commands
git commit -m "feat(bot): lệnh /add, /remove, /list kèm validate đầu vào"
```

---

### Task 18: lệnh `/status` và `/check`

`/check` phải `deferReply` trước: một lần probe có thể mất tới `timeout` cộng thêm một lần retry, dễ vượt hạn 3 giây của Discord.

**Files:**
- Create: `src/bot/commands/status.ts`, `src/bot/commands/check.ts`
- Test: `tests/bot/commands/status-check.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandContext`, `InteractionLike`, `EPHEMERAL` từ `src/bot/types.js` · `manualCheckMessage` từ `src/notify/messages.js` · `toEmbed` từ `src/notify/embeds.js` · `Runner`
- Produces: `statusCommand: Command` · `checkCommand: Command`

- [ ] **Step 1: Viết test thất bại**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkCommand } from '../../../src/bot/commands/check.js'
import { statusCommand } from '../../../src/bot/commands/status.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeChecksRepo } from '../../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../../src/db/incidents.repo.js'
import { makeTargetsRepo } from '../../../src/db/targets.repo.js'
import { silentLogger } from '../../../src/shared/logger.js'
import type { CheckOutcome, Target } from '../../../src/shared/types.js'

function interaction(commandName: string, name?: string) {
  const replies: InteractionReply[] = []
  const deferred: unknown[] = []
  const it: InteractionLike = {
    commandName,
    user: { id: 'u1' },
    options: {
      getString: (n) => (n === 'name' ? name ?? null : null),
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: async (p) => { replies.push(p); return {} },
    deferReply: async (p) => { deferred.push(p ?? {}); return {} },
    editReply: async (p) => { replies.push(p); return {} },
  }
  return { it, replies, deferred }
}

let ctx: CommandContext
let checkByName: ReturnType<typeof vi.fn>

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  checkByName = vi.fn(async () => null)
  ctx = {
    targets: makeTargetsRepo(db),
    checks: makeChecksRepo(db),
    incidents: makeIncidentsRepo(db),
    runner: { runCheck: async () => { throw new Error('không dùng') }, checkByName } as unknown as CommandContext['runner'],
    config: {} as CommandContext['config'],
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    logger: silentLogger,
  }
})

function seed(name: string): Target {
  return ctx.targets.create({
    name, url: `https://${name}.test`, intervalSeconds: 60, timeoutMs: 10_000,
    createdBy: 'u1', createdAt: '2026-08-24T00:00:00.000Z',
  })
}

describe('/status', () => {
  it('không phải lệnh admin', () => {
    expect(statusCommand.adminOnly).toBe(false)
  })

  it('không có target nào thì nói rõ', async () => {
    const { it: i, replies } = interaction('status')
    await statusCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/chưa có target/i)
  })

  it('không truyền name thì liệt kê mọi target kèm lần check gần nhất', async () => {
    const t = seed('web')
    ctx.targets.updateStatus(t.id, 'UP', '2026-08-24T00:00:00.000Z')
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-08-24T00:00:00.000Z', status: 'UP', httpStatus: 200, latencyMs: 137 })

    const { it: i, replies } = interaction('status')
    await statusCommand.execute(ctx, i)
    const text = replies[0]?.content ?? ''
    expect(text).toContain('web')
    expect(text).toContain('UP')
    expect(text).toContain('137')
  })

  it('truyền name thì chỉ báo target đó', async () => {
    seed('web')
    seed('api')
    const { it: i, replies } = interaction('status', 'web')
    await statusCommand.execute(ctx, i)
    const text = replies[0]?.content ?? ''
    expect(text).toContain('web')
    expect(text).not.toContain('api')
  })

  it('name không tồn tại thì trả lời thân thiện', async () => {
    const { it: i, replies } = interaction('status', 'không-có')
    await statusCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('target chưa từng check thì không in undefined', async () => {
    seed('web')
    const { it: i, replies } = interaction('status', 'web')
    await statusCommand.execute(ctx, i)
    const text = replies[0]?.content ?? ''
    expect(text).not.toContain('undefined')
    expect(text).toMatch(/chưa check/i)
  })
})

describe('/check', () => {
  it('không phải lệnh admin', () => {
    expect(checkCommand.adminOnly).toBe(false)
  })

  it('defer trước khi chạy probe', async () => {
    seed('web')
    checkByName.mockResolvedValue({
      target: ctx.targets.findByName('web') as Target,
      result: { ok: true, httpStatus: 200, latencyMs: 88 },
      status: 'UP',
      transition: null,
    } satisfies CheckOutcome)

    const { it: i, deferred } = interaction('check', 'web')
    await checkCommand.execute(ctx, i)
    expect(deferred).toHaveLength(1)
  })

  it('trả kết quả bằng embed qua editReply', async () => {
    seed('web')
    checkByName.mockResolvedValue({
      target: ctx.targets.findByName('web') as Target,
      result: { ok: true, httpStatus: 200, latencyMs: 88 },
      status: 'UP',
      transition: null,
    } satisfies CheckOutcome)

    const { it: i, replies } = interaction('check', 'web')
    await checkCommand.execute(ctx, i)

    const embeds = replies[0]?.embeds as Array<{ toJSON(): { title: string } }>
    expect(embeds).toHaveLength(1)
    expect(embeds[0]?.toJSON().title).toContain('web')
  })

  it('thiếu name thì trả lời lỗi, không defer', async () => {
    const { it: i, replies, deferred } = interaction('check')
    await checkCommand.execute(ctx, i)
    expect(deferred).toHaveLength(0)
    expect(replies[0]?.content).toMatch(/bắt buộc/i)
  })

  it('target không tồn tại thì editReply thông báo', async () => {
    checkByName.mockResolvedValue(null)
    const { it: i, replies } = interaction('check', 'không-có')
    await checkCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })
})
```

- [ ] **Step 2: Cài đặt `src/bot/commands/status.ts`**

```ts
import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command, type CommandContext } from '../types.js'
import type { Target } from '../../shared/types.js'

const STATUS_ICON: Record<string, string> = {
  UP: '🟢', DEGRADED: '🟡', DOWN: '🔴', UNKNOWN: '⚪',
}

function lineFor(ctx: CommandContext, t: Target): string {
  const icon = STATUS_ICON[t.currentStatus] ?? '⚪'
  const last = ctx.checks.listRecent(t.id, 1)[0]

  if (!last) {
    return `${icon} **${t.name}** — ${t.currentStatus} — chưa check lần nào`
  }

  const latency = last.latencyMs == null ? 'không đo được' : `${last.latencyMs} ms`
  const detail = last.error ?? `HTTP ${last.httpStatus ?? '?'}`
  return `${icon} **${t.name}** — ${t.currentStatus} — ${latency} — ${detail} — lúc ${last.checkedAt}`
}

export const statusCommand: Command = {
  name: 'status',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Xem trạng thái hiện tại của endpoint')
    .addStringOption((o) => o.setName('name').setDescription('Chỉ xem một target')),

  async execute(ctx, interaction) {
    const name = interaction.options.getString('name')

    if (name) {
      const t = ctx.targets.findByName(name)
      if (!t) {
        await interaction.reply({ content: `Không tìm thấy target \`${name}\`.`, flags: EPHEMERAL })
        return
      }
      await interaction.reply({ content: lineFor(ctx, t) })
      return
    }

    const all = ctx.targets.findAll()
    if (all.length === 0) {
      await interaction.reply({ content: 'Chưa có target nào. Dùng `/add` để thêm.' })
      return
    }

    await interaction.reply({ content: all.map((t) => lineFor(ctx, t)).join('\n') })
  },
}
```

- [ ] **Step 3: Cài đặt `src/bot/commands/check.ts`**

```ts
import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command } from '../types.js'
import { toEmbed } from '../../notify/embeds.js'
import { manualCheckMessage } from '../../notify/messages.js'

export const checkCommand: Command = {
  name: 'check',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('check')
    .setDescription('Chạy kiểm tra ngay, không chờ tới chu kỳ')
    .addStringOption((o) => o.setName('name').setDescription('Tên target').setRequired(true)),

  async execute(ctx, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    // Một lần probe có thể mất tới timeout cộng một lần retry, vượt hạn 3s của Discord.
    await interaction.deferReply()

    const outcome = await ctx.runner.checkByName(name)
    if (!outcome) {
      await interaction.editReply({ content: `Không tìm thấy target \`${name}\`.` })
      return
    }

    const msg = manualCheckMessage(outcome, ctx.clock().toISOString())
    await interaction.editReply({ embeds: [toEmbed(msg)] })
  },
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/bot/commands/status-check.test.ts`
Expected: PASS — 11 test.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/status.ts src/bot/commands/check.ts tests/bot/commands/status-check.test.ts
git commit -m "feat(bot): lệnh /status và /check chạy kiểm tra tức thì"
```

---

### Task 19: lệnh `/pause`, `/resume`, `/history`, `/uptime`

`/uptime` gọi lại `buildDigest` — không viết logic tính uptime lần thứ hai.

**Files:**
- Create: `src/bot/commands/pause.ts`, `src/bot/commands/history.ts`, `src/bot/commands/uptime.ts`
- Test: `tests/bot/commands/pause-history-uptime.test.ts`

**Interfaces:**
- Consumes: `Command`, `EPHEMERAL` từ `src/bot/types.js` · `buildDigest`, `DigestInput` từ `src/digest/digest.js` · `formatDuration` từ `src/shared/time.js`
- Produces: `pauseCommand: Command` · `resumeCommand: Command` · `historyCommand: Command` · `uptimeCommand: Command`

- [ ] **Step 1: Viết test thất bại**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { historyCommand } from '../../../src/bot/commands/history.js'
import { pauseCommand, resumeCommand } from '../../../src/bot/commands/pause.js'
import { uptimeCommand } from '../../../src/bot/commands/uptime.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeChecksRepo } from '../../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../../src/db/incidents.repo.js'
import { makeTargetsRepo } from '../../../src/db/targets.repo.js'
import { silentLogger } from '../../../src/shared/logger.js'
import type { Runner } from '../../../src/monitor/runner.js'
import type { Target } from '../../../src/shared/types.js'

const NOW = '2026-08-24T12:00:00.000Z'

function interaction(commandName: string, opts: { name?: string; minutes?: number; range?: string } = {}) {
  const replies: InteractionReply[] = []
  const it: InteractionLike = {
    commandName,
    user: { id: 'admin-1' },
    options: {
      getString: (n) => (n === 'name' ? opts.name ?? null : n === 'range' ? opts.range ?? null : null),
      getInteger: (n) => (n === 'minutes' ? opts.minutes ?? null : null),
      getChannel: () => null,
    },
    reply: async (p) => { replies.push(p); return {} },
    deferReply: async () => ({}),
    editReply: async (p) => { replies.push(p); return {} },
  }
  return { it, replies }
}

let ctx: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  ctx = {
    targets: makeTargetsRepo(db),
    checks: makeChecksRepo(db),
    incidents: makeIncidentsRepo(db),
    runner: {} as Runner,
    config: {} as CommandContext['config'],
    clock: () => new Date(NOW),
    logger: silentLogger,
  }
})

function seed(name: string): Target {
  return ctx.targets.create({
    name, url: `https://${name}.test`, intervalSeconds: 60, timeoutMs: 10_000,
    createdBy: 'u1', createdAt: '2026-08-24T00:00:00.000Z',
  })
}

describe('/pause', () => {
  it('là lệnh admin', () => {
    expect(pauseCommand.adminOnly).toBe(true)
    expect(resumeCommand.adminOnly).toBe(true)
  })

  it('pause với số phút thì đặt pausedUntil đúng mốc', async () => {
    const t = seed('web')
    const { it: i, replies } = interaction('pause', { name: 'web', minutes: 30 })
    await pauseCommand.execute(ctx, i)
    expect(ctx.targets.findById(t.id)?.pausedUntil).toBe('2026-08-24T12:30:00.000Z')
    expect(replies[0]?.content).toContain('30')
  })

  it('pause không truyền phút thì pause vô hạn', async () => {
    const t = seed('web')
    const { it: i, replies } = interaction('pause', { name: 'web' })
    await pauseCommand.execute(ctx, i)
    const until = ctx.targets.findById(t.id)?.pausedUntil ?? ''
    expect(Date.parse(until)).toBeGreaterThan(Date.parse('9000-01-01T00:00:00.000Z'))
    expect(replies[0]?.content).toMatch(/vô hạn|cho tới khi/i)
  })

  it('pause target không tồn tại thì trả lời thân thiện', async () => {
    const { it: i, replies } = interaction('pause', { name: 'không-có' })
    await pauseCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('minutes ngoài biên thì trả lời lỗi', async () => {
    seed('web')
    const { it: i, replies } = interaction('pause', { name: 'web', minutes: 0 })
    await pauseCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/minutes/)
    expect(ctx.targets.findByName('web')?.pausedUntil).toBeNull()
  })
})

describe('/resume', () => {
  it('bỏ pause', async () => {
    const t = seed('web')
    ctx.targets.setPause(t.id, '2026-08-25T00:00:00.000Z')
    const { it: i, replies } = interaction('resume', { name: 'web' })
    await resumeCommand.execute(ctx, i)
    expect(ctx.targets.findById(t.id)?.pausedUntil).toBeNull()
    expect(replies[0]?.content).toContain('web')
  })

  it('target không tồn tại thì trả lời thân thiện', async () => {
    const { it: i, replies } = interaction('resume', { name: 'không-có' })
    await resumeCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })
})

describe('/history', () => {
  it('không phải lệnh admin', () => {
    expect(historyCommand.adminOnly).toBe(false)
  })

  it('chưa có sự cố thì nói rõ', async () => {
    seed('web')
    const { it: i, replies } = interaction('history', { name: 'web' })
    await historyCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/chưa có sự cố/i)
  })

  it('liệt kê sự cố đã đóng kèm thời lượng', async () => {
    const t = seed('web')
    ctx.incidents.open(t.id, 'HTTP 500', '2026-08-24T01:00:00.000Z')
    ctx.incidents.close(t.id, '2026-08-24T02:02:05.000Z')

    const { it: i, replies } = interaction('history', { name: 'web' })
    await historyCommand.execute(ctx, i)
    const text = replies[0]?.content ?? ''
    expect(text).toContain('HTTP 500')
    expect(text).toContain('1h 2m 5s')
  })

  it('đánh dấu sự cố còn đang mở', async () => {
    const t = seed('web')
    ctx.incidents.open(t.id, 'timeout', '2026-08-24T11:00:00.000Z')
    const { it: i, replies } = interaction('history', { name: 'web' })
    await historyCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/đang diễn ra/i)
  })

  it('target không tồn tại thì trả lời thân thiện', async () => {
    const { it: i, replies } = interaction('history', { name: 'không-có' })
    await historyCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })
})

describe('/uptime', () => {
  it('không phải lệnh admin', () => {
    expect(uptimeCommand.adminOnly).toBe(false)
  })

  it('tính uptime trong 24h theo mặc định', async () => {
    const t = seed('web')
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-08-24T11:00:00.000Z', status: 'UP', latencyMs: 100 })
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-08-24T11:30:00.000Z', status: 'DOWN' })

    const { it: i, replies } = interaction('uptime', { name: 'web' })
    await uptimeCommand.execute(ctx, i)
    const text = replies[0]?.content ?? ''
    expect(text).toContain('50%')
    expect(text).toContain('24h')
  })

  it('range 7d dùng khoảng 7 ngày', async () => {
    const t = seed('web')
    ctx.checks.insert({ targetId: t.id, checkedAt: '2026-08-20T00:00:00.000Z', status: 'UP', latencyMs: 100 })

    const { it: i, replies } = interaction('uptime', { name: 'web', range: '7d' })
    await uptimeCommand.execute(ctx, i)
    const text = replies[0]?.content ?? ''
    expect(text).toContain('7d')
    expect(text).toContain('100%')
  })

  it('chưa có dữ liệu thì nói rõ, không in NaN', async () => {
    seed('web')
    const { it: i, replies } = interaction('uptime', { name: 'web' })
    await uptimeCommand.execute(ctx, i)
    const text = replies[0]?.content ?? ''
    expect(text).not.toContain('NaN')
    expect(text).toMatch(/chưa có dữ liệu/i)
  })

  it('range không hợp lệ thì trả lời lỗi', async () => {
    seed('web')
    const { it: i, replies } = interaction('uptime', { name: 'web', range: '1 tháng' })
    await uptimeCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/range/)
  })

  it('target không tồn tại thì trả lời thân thiện', async () => {
    const { it: i, replies } = interaction('uptime', { name: 'không-có' })
    await uptimeCommand.execute(ctx, i)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })
})
```

- [ ] **Step 2: Cài đặt `src/bot/commands/pause.ts`**

Pause vô hạn dùng mốc năm 9999 thay vì một giá trị đặc biệt, nhờ đó `findDue` chỉ cần một phép so sánh duy nhất và không phải xử lý trường hợp riêng.

```ts
import { SlashCommandBuilder } from 'discord.js'
import { ValidationError, validateRange } from '../validate.js'
import { EPHEMERAL, type Command } from '../types.js'

const FOREVER_ISO = '9999-12-31T23:59:59.000Z'

export const pauseCommand: Command = {
  name: 'pause',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Tạm dừng theo dõi một endpoint')
    .addStringOption((o) => o.setName('name').setDescription('Tên target').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('Số phút tạm dừng; bỏ trống là vô hạn')),

  async execute(ctx, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const target = ctx.targets.findByName(name)
    if (!target) {
      await interaction.reply({ content: `Không tìm thấy target \`${name}\`.`, flags: EPHEMERAL })
      return
    }

    const rawMinutes = interaction.options.getInteger('minutes')

    try {
      if (rawMinutes === null) {
        ctx.targets.setPause(target.id, FOREVER_ISO)
        await interaction.reply({ content: `Đã tạm dừng \`${name}\` vô hạn. Dùng \`/resume\` để bật lại.` })
        return
      }

      const minutes = validateRange('minutes', rawMinutes, 1, 43_200)
      const until = new Date(ctx.clock().getTime() + minutes * 60_000).toISOString()
      ctx.targets.setPause(target.id, until)
      await interaction.reply({ content: `Đã tạm dừng \`${name}\` trong ${minutes} phút, tới ${until}.` })
    } catch (err) {
      if (err instanceof ValidationError) {
        await interaction.reply({ content: err.message, flags: EPHEMERAL })
        return
      }
      throw err
    }
  },
}

export const resumeCommand: Command = {
  name: 'resume',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Bật lại theo dõi một endpoint đang tạm dừng')
    .addStringOption((o) => o.setName('name').setDescription('Tên target').setRequired(true)),

  async execute(ctx, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const target = ctx.targets.findByName(name)
    if (!target) {
      await interaction.reply({ content: `Không tìm thấy target \`${name}\`.`, flags: EPHEMERAL })
      return
    }

    ctx.targets.setPause(target.id, null)
    await interaction.reply({ content: `Đã bật lại theo dõi \`${name}\`.` })
  },
}
```

- [ ] **Step 3: Cài đặt `src/bot/commands/history.ts`**

```ts
import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command } from '../types.js'
import { formatDuration } from '../../shared/time.js'

const LIMIT = 10

export const historyCommand: Command = {
  name: 'history',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Xem các sự cố gần nhất của một endpoint')
    .addStringOption((o) => o.setName('name').setDescription('Tên target').setRequired(true)),

  async execute(ctx, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const target = ctx.targets.findByName(name)
    if (!target) {
      await interaction.reply({ content: `Không tìm thấy target \`${name}\`.`, flags: EPHEMERAL })
      return
    }

    const incidents = ctx.incidents.listRecent(target.id, LIMIT)
    if (incidents.length === 0) {
      await interaction.reply({ content: `\`${name}\` chưa có sự cố nào được ghi nhận.` })
      return
    }

    const nowMs = ctx.clock().getTime()
    const rows = incidents.map((inc) => {
      const endMs = inc.endedAt ? Date.parse(inc.endedAt) : nowMs
      const duration = formatDuration(endMs - Date.parse(inc.startedAt))
      const state = inc.endedAt ? duration : `${duration} — đang diễn ra`
      return `• ${inc.startedAt} — ${state} — ${inc.reason ?? 'không rõ lý do'}`
    })

    await interaction.reply({
      content: `**${incidents.length} sự cố gần nhất của \`${name}\`**\n${rows.join('\n')}`,
    })
  },
}
```

- [ ] **Step 4: Cài đặt `src/bot/commands/uptime.ts`**

```ts
import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command } from '../types.js'
import { buildDigest, type DigestInput } from '../../digest/digest.js'
import { formatDuration } from '../../shared/time.js'

const RANGES: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
}

export const uptimeCommand: Command = {
  name: 'uptime',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Xem tỉ lệ uptime của một endpoint')
    .addStringOption((o) => o.setName('name').setDescription('Tên target').setRequired(true))
    .addStringOption((o) =>
      o.setName('range').setDescription('Khoảng thời gian').addChoices(
        { name: '24h', value: '24h' },
        { name: '7d', value: '7d' },
        { name: '30d', value: '30d' },
      ),
    ),

  async execute(ctx, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const rangeKey = interaction.options.getString('range') ?? '24h'
    const rangeMs = RANGES[rangeKey]
    if (rangeMs === undefined) {
      await interaction.reply({
        content: '`range` chỉ nhận `24h`, `7d` hoặc `30d`.',
        flags: EPHEMERAL,
      })
      return
    }

    const target = ctx.targets.findByName(name)
    if (!target) {
      await interaction.reply({ content: `Không tìm thấy target \`${name}\`.`, flags: EPHEMERAL })
      return
    }

    const now = ctx.clock()
    const nowIso = now.toISOString()
    const sinceIso = new Date(now.getTime() - rangeMs).toISOString()

    const input: DigestInput = {
      name: target.name,
      currentStatus: target.currentStatus,
      paused: target.pausedUntil !== null && Date.parse(target.pausedUntil) > now.getTime(),
      stats: ctx.checks.statsSince(target.id, sinceIso),
      incidents: ctx.incidents.listOverlapping(target.id, sinceIso),
    }

    const line = buildDigest([input], rangeKey, sinceIso, nowIso).lines[0]
    if (!line) {
      await interaction.reply({ content: `Không tính được uptime cho \`${name}\`.`, flags: EPHEMERAL })
      return
    }

    if (line.uptimePct === null) {
      await interaction.reply({
        content: `\`${name}\` chưa có dữ liệu check nào trong ${rangeKey}.`,
      })
      return
    }

    const latency = line.avgLatencyMs === null ? 'không có' : `${line.avgLatencyMs} ms`
    await interaction.reply({
      content: [
        `**Uptime \`${name}\` — ${rangeKey}**`,
        `Uptime: ${line.uptimePct}%`,
        `Latency trung bình: ${latency}`,
        `Số sự cố: ${line.incidentCount}`,
        `Tổng thời gian gián đoạn: ${formatDuration(line.downtimeMs)}`,
      ].join('\n'),
    })
  },
}
```

- [ ] **Step 5: Chạy test để chắc chắn nó xanh**

Run: `npx vitest run tests/bot/commands/pause-history-uptime.test.ts`
Expected: PASS — 18 test.

- [ ] **Step 6: Commit**

```bash
git add src/bot/commands/pause.ts src/bot/commands/history.ts src/bot/commands/uptime.ts tests/bot/commands/pause-history-uptime.test.ts
git commit -m "feat(bot): lệnh /pause, /resume, /history, /uptime"
```

---

### Task 20: Registry lệnh, client, deploy-commands, wiring và README

Task cuối ghép mọi thứ thành một chương trình chạy được.

**Files:**
- Create: `src/bot/commands/index.ts`, `src/bot/client.ts`, `src/bot/deploy-commands.ts`, `src/index.ts`, `README.md`
- Test: `tests/bot/commands/registry.test.ts`

**Interfaces:**
- Consumes: mọi module đã dựng
- Produces: `allCommands(): Command[]` từ `src/bot/commands/index.js` · `createClient(): Client` từ `src/bot/client.js`

- [ ] **Step 1: Viết test thất bại cho registry**

Test này bắt được lớp lỗi rất dễ xảy ra: thêm file lệnh mới mà quên đăng ký, hoặc đặt trùng tên, hoặc `name` của `Command` lệch với `name` trong `SlashCommandBuilder` khiến router không bao giờ tìm thấy lệnh.

```ts
import { describe, expect, it } from 'vitest'
import { allCommands } from '../../../src/bot/commands/index.js'

describe('allCommands', () => {
  it('đăng ký đủ 9 lệnh', () => {
    expect(allCommands()).toHaveLength(9)
  })

  it('có đúng tập tên lệnh mong đợi', () => {
    expect(allCommands().map((c) => c.name).sort()).toEqual(
      ['add', 'check', 'history', 'list', 'pause', 'remove', 'resume', 'status', 'uptime'],
    )
  })

  it('không có tên trùng', () => {
    const names = allCommands().map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('Command.name luôn khớp tên trong data — nếu lệch, router sẽ không bao giờ tìm thấy lệnh', () => {
    for (const c of allCommands()) {
      expect(c.data.name).toBe(c.name)
      expect((c.data.toJSON() as { name: string }).name).toBe(c.name)
    }
  })

  it('chỉ add, remove, pause, resume là lệnh admin', () => {
    const admin = allCommands().filter((c) => c.adminOnly).map((c) => c.name).sort()
    expect(admin).toEqual(['add', 'pause', 'remove', 'resume'])
  })

  it('mọi lệnh đều có execute là hàm', () => {
    for (const c of allCommands()) {
      expect(typeof c.execute).toBe('function')
    }
  })
})
```

- [ ] **Step 2: Cài đặt `src/bot/commands/index.ts`**

```ts
import { addCommand } from './add.js'
import { checkCommand } from './check.js'
import { historyCommand } from './history.js'
import { listCommand } from './list.js'
import { pauseCommand, resumeCommand } from './pause.js'
import { removeCommand } from './remove.js'
import { statusCommand } from './status.js'
import { uptimeCommand } from './uptime.js'
import type { Command } from '../types.js'

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
  ]
}
```

- [ ] **Step 3: Chạy test registry để chắc chắn nó xanh**

Run: `npx vitest run tests/bot/commands/registry.test.ts`
Expected: PASS — 6 test.

- [ ] **Step 4: Cài đặt `src/bot/client.ts`**

Chỉ cần intent `Guilds`. Slash command đến qua interaction, không cần `MessageContent` — intent đó là privileged và xin thêm chỉ làm bot khó được duyệt hơn mà chẳng dùng vào việc gì.

```ts
import { Client, GatewayIntentBits } from 'discord.js'

export function createClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] })
}
```

- [ ] **Step 5: Cài đặt `src/bot/deploy-commands.ts`**

Đăng ký ở phạm vi guild nên lệnh xuất hiện tức thì. Global command mất tới một tiếng để lan.

```ts
import 'dotenv/config'
import { REST, Routes } from 'discord.js'
import { allCommands } from './commands/index.js'
import { loadConfig } from '../config.js'
import { makeLogger } from '../shared/logger.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = makeLogger(config.logLevel)

  const body = allCommands().map((c) => c.data.toJSON())
  const rest = new REST().setToken(config.discordToken)

  logger.info(`Đang đăng ký ${body.length} slash command vào guild ${config.guildId}`)
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.guildId),
    { body },
  )
  logger.info('Đăng ký xong. Lệnh có hiệu lực ngay trong guild.')
}

main().catch((err) => {
  console.error('Đăng ký slash command thất bại:', err)
  process.exit(1)
})
```

- [ ] **Step 6: Cài đặt `src/index.ts`**

Ba chi tiết vận hành nằm ở đây và không nằm ở đâu khác: tạo thư mục chứa DB trước khi mở, backup trước khi áp migration, và tắt máy có trật tự khi nhận SIGINT/SIGTERM.

```ts
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { Events } from 'discord.js'
import { loadConfig } from './config.js'
import { openDb } from './db/connection.js'
import { applyMigrations, backupDbFile } from './db/migrate.js'
import { makeChecksRepo } from './db/checks.repo.js'
import { makeIncidentsRepo } from './db/incidents.repo.js'
import { makeMetaRepo } from './db/meta.repo.js'
import { makeTargetsRepo } from './db/targets.repo.js'
import { makeHttpProbe } from './monitor/http-probe.js'
import { makeRunner } from './monitor/runner.js'
import { makeScheduler } from './monitor/scheduler.js'
import { makeDigestJob } from './digest/schedule.js'
import { makeDiscordNotifier } from './notify/discord-notifier.js'
import { createClient } from './bot/client.js'
import { allCommands } from './bot/commands/index.js'
import { makeRouter } from './bot/router.js'
import type { InteractionLike } from './bot/types.js'
import { makeLogger } from './shared/logger.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = makeLogger(config.logLevel)
  const clock = () => new Date()

  if (config.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true })
    const backup = backupDbFile(config.dbPath, clock())
    if (backup) logger.info(`Đã backup DB sang ${backup}`)
  }

  const { raw, db } = openDb(config.dbPath)
  await applyMigrations(db)
  logger.info(`DB đã sẵn sàng tại ${config.dbPath}`)

  const targets = makeTargetsRepo(db)
  const checks = makeChecksRepo(db)
  const incidents = makeIncidentsRepo(db)
  const meta = makeMetaRepo(db)

  const client = createClient()
  const notifier = makeDiscordNotifier({ client, logger })

  const runner = makeRunner({
    probe: makeHttpProbe(),
    targets, checks, incidents, notifier, config, clock, logger,
  })

  const digestJob = makeDigestJob({
    targets, checks, incidents, meta, notifier, config, clock, logger,
  })

  const scheduler = makeScheduler({
    targets, runner, config, clock, logger,
    onTickDone: async () => {
      const res = await digestJob.maybeSend()
      if (res.sent) logger.info('Đã gửi digest hằng ngày')
    },
  })

  const router = makeRouter({
    commands: allCommands(),
    ctx: { targets, checks, incidents, runner, config, clock, logger },
    config,
    logger,
  })

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return
    void router.handle(interaction as unknown as InteractionLike)
  })

  client.once(Events.ClientReady, (ready) => {
    logger.info(`Đã đăng nhập với tư cách ${ready.user.tag}`)
    scheduler.start()
    logger.info(`Scheduler chạy mỗi ${config.tickIntervalMs}ms`)
  })

  process.on('unhandledRejection', (err) => logger.error('Promise bị reject mà không ai bắt', err))
  process.on('uncaughtException', (err) => logger.error('Ngoại lệ không ai bắt', err))

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`Nhận ${signal}, đang tắt`)
    scheduler.stop()
    await client.destroy()
    raw.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await client.login(config.discordToken)
}

main().catch((err) => {
  console.error('Khởi động thất bại:', err)
  process.exit(1)
})
```

Ép kiểu `interaction as unknown as InteractionLike` là **chỗ ép kiểu duy nhất trong toàn dự án**. Nó tồn tại đúng một lần ở biên giữa discord.js và code của ta, và chính nó là thứ cho phép mọi file command được test bằng object thường.

- [ ] **Step 7: Viết `README.md`**

```markdown
# noti-discord

Daemon theo dõi HTTP/HTTPS endpoint và gửi thông báo vào Discord khi trạng thái đổi.

## Yêu cầu

Node.js >= 25.

## Dựng bot trên Discord

1. Vào https://discord.com/developers/applications, bấm **New Application**.
2. Tab **Bot** → **Reset Token** → copy token, đặt vào `DISCORD_TOKEN`.
3. Tab **General Information** → copy **Application ID**, đặt vào `DISCORD_CLIENT_ID`.
4. Tab **OAuth2 → URL Generator**: chọn scope `bot` và `applications.commands`, quyền
   `Send Messages` và `Embed Links`. Mở URL sinh ra để mời bot vào server.
5. Bật **Developer Mode** trong Discord (Settings → Advanced) để copy được ID của
   server và channel bằng cách bấm chuột phải.

Không cần intent privileged nào. Bot chỉ dùng intent `Guilds`.

## Cài đặt

```bash
npm install
cp .env.example .env   # rồi điền giá trị thật
npm run db:generate    # chỉ cần khi đã sửa src/db/schema.ts
npm run db:migrate
npm run deploy-commands
npm run dev
```

## Script

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy ở chế độ dev, tự reload |
| `npm run build` && `npm start` | Build ra `dist/` rồi chạy |
| `npm test` | Chạy toàn bộ test |
| `npm run typecheck` | Kiểm tra kiểu, không xuất file |
| `npm run db:generate` | Sinh migration sau khi sửa `schema.ts` |
| `npm run db:migrate` | Áp migration vào DB |
| `npm run db:studio` | Mở UI xem dữ liệu |
| `npm run db:drift` | Chặn `schema.ts` lệch với `drizzle/` |
| `npm run deploy-commands` | Đăng ký slash command vào guild |

## Slash command

| Lệnh | Quyền | Việc |
|---|---|---|
| `/add name url [interval] [timeout] [latency] [channel]` | admin | Thêm endpoint |
| `/remove name` | admin | Xoá endpoint và lịch sử của nó |
| `/pause name [minutes]` | admin | Tạm dừng theo dõi |
| `/resume name` | admin | Bật lại theo dõi |
| `/list` | mọi người | Liệt kê endpoint |
| `/status [name]` | mọi người | Trạng thái hiện tại |
| `/check name` | mọi người | Kiểm tra ngay |
| `/history name` | mọi người | Sự cố gần nhất |
| `/uptime name [24h\|7d\|30d]` | mọi người | Tỉ lệ uptime |

Lệnh admin chỉ nhận user ID có trong `ADMIN_USER_IDS`.

## Hành vi

- Alert chỉ bắn khi trạng thái đổi giữa UP và DOWN. Trạng thái DEGRADED (còn trả
  status đúng nhưng chậm hơn ngưỡng latency) chỉ được ghi vào DB, không bắn alert.
- Mỗi endpoint có thể có channel alert riêng; không khai báo thì dùng
  `DEFAULT_ALERT_CHANNEL_ID`.
- Báo cáo tổng hợp gửi mỗi ngày lúc `DIGEST_HOUR_LOCAL` giờ Việt Nam vào
  `DIGEST_CHANNEL_ID`. Nếu process khởi động muộn hơn mốc đó mà hôm nay chưa gửi
  thì nó gửi bù.
- Endpoint hết hạn pause tự động được check lại, không cần `/resume`.

## Đổi schema DB

1. Sửa `src/db/schema.ts`.
2. `npm run db:generate`.
3. **Đọc file SQL sinh ra trong `drizzle/`** rồi commit nó cùng thay đổi schema.
4. `npm run db:migrate`.

Migration là forward-only, không có `down`. App tự backup file DB trước khi áp
migration mới và giữ 3 bản gần nhất. Không dùng `drizzle-kit push` — nó không để
lại file migration nên làm mất lịch sử schema.

## Deploy

`better-sqlite3` là native module, nên khi đóng Docker image:

- Dùng base `node:<ver>-slim` (debian), không dùng alpine — alpine dùng musl nên
  prebuild glibc không nạp được.
- Chạy `npm ci` bên trong image, đừng copy `node_modules` từ máy Windows sang.
- Nếu dùng multi-stage build thì stage runtime phải cùng base image với stage build.
- Mount volume cho thư mục chứa file SQLite (`./data`), vì filesystem của Fly.io và
  Railway là ephemeral. Trên Fly.io nhớ tắt autostop để process không bị suspend.
```

- [ ] **Step 8: Chạy toàn bộ kiểm tra**

```bash
npm run typecheck && npm test && npm run db:drift
```

Expected: typecheck không lỗi; toàn bộ test PASS; drift báo OK.

- [ ] **Step 9: Xác nhận lại ràng buộc kiến trúc**

```bash
grep -rn "discord.js" src/monitor src/digest src/notify/messages.ts src/notify/notifier.ts src/db src/config.ts src/shared && echo "LỖI: discord.js lọt vào nơi bị cấm" || echo "OK: chỉ bot/ và notify/embeds.ts, notify/discord-notifier.ts biết discord.js"
```

Expected: in `OK: ...`.

- [ ] **Step 10: Commit**

```bash
git add src/bot/commands/index.ts src/bot/client.ts src/bot/deploy-commands.ts src/index.ts README.md tests/bot/commands/registry.test.ts
git commit -m "feat: registry lệnh, discord client và wiring toàn hệ thống"
```

---

## Kiểm tra cuối cùng khi chạy thật

Plan hoàn tất khi toàn bộ test xanh. Nhưng test không thay được một lần chạy thật —
đây là những việc chỉ làm được với token thật, sau Task 20:

- [ ] Điền `.env` bằng giá trị thật, chạy `npm run deploy-commands`, xác nhận 9 lệnh
      hiện ra trong Discord khi gõ `/`.
- [ ] `npm run dev`, xác nhận log in ra `Đã đăng nhập với tư cách ...`.
- [ ] `/add web https://example.com` rồi `/list` và `/status` — thấy target xuất hiện.
- [ ] `/check web` — nhận embed kết quả, chứng minh `deferReply` hoạt động.
- [ ] `/add broken https://127.0.0.1:9999` — trong vòng một chu kỳ phải nhận alert đỏ
      trong `DEFAULT_ALERT_CHANNEL_ID`, rồi `/remove broken` để dọn.
- [ ] `/pause web 1` rồi `/status` — thấy nhãn paused; sau một phút nó tự được check lại.
- [ ] Tạm đặt `DIGEST_HOUR_LOCAL` bằng giờ VN hiện tại, khởi động lại, xác nhận digest
      được gửi vào `DIGEST_CHANNEL_ID`, rồi đặt lại về `9`.
