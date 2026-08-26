# Bun Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển noti-discord sang chạy hoàn toàn trên Bun — package manager, runtime, test runner, driver SQLite — để repo không còn native module và không còn bước build.

**Architecture:** Đây là migration toolchain, không đổi logic nghiệp vụ. `bun install` thay pnpm; `bun` chạy thẳng TypeScript nên `tsc → dist/` bị xoá hẳn; `bun:sqlite` + `drizzle-orm/bun-sqlite` thay `better-sqlite3`; `bun test` thay vitest. Vì `drizzle-kit` không biết `bun:sqlite`, lệnh `db:migrate` chuyển sang script tự viết dùng lại chính `openDb`/`applyMigrations` của app, và `db:studio` bị bỏ.

**Tech Stack:** Bun >= 1.3, TypeScript 7 (chỉ để typecheck), drizzle-orm 0.45 (adapter `bun-sqlite`), drizzle-kit 0.31 (chỉ còn dùng `generate`), discord.js 14.

**Spec:** `docs/superpowers/specs/2026-08-26-bun-migration-design.md`

## Global Constraints

- Bun >= 1.3.0. Máy dev đã có Bun 1.3.14.
- **Chiến lược big-bang:** toàn bộ migration giao ra dưới dạng **một commit duy nhất**. Mỗi task dưới đây vẫn commit riêng làm checkpoint để dễ lùi, nhưng Task 6 squash tất cả lại thành một.
- Không đổi logic nghiệp vụ, không đổi schema DB, không đổi hành vi bot.
- Không thêm `tests/**/*.ts` vào `tsconfig.include`. Tests đang có 4 lỗi type tồn sẵn; dọn chúng là việc riêng, ngoài phạm vi.
- Giữ `module`/`moduleResolution` = `nodenext`. Mã nguồn import kèm đuôi `.js`, `nodenext` xử lý đúng sẵn.
- Không giữ lại bất kỳ native dependency nào. Đây là lý do tồn tại của cả migration.
- Mọi lệnh chạy từ thư mục gốc repo.

## Trạng thái đỏ giữa chừng là bình thường

Vì là big-bang, repo **không** xanh giữa các task. Cụ thể:

| Sau task | `bun run typecheck` | `bun test` |
|---|---|---|
| 1 | ĐỎ (src còn import `better-sqlite3` vừa bị gỡ) | ĐỎ (vitest đã bị gỡ) |
| 2 | ĐỎ (như trên, đã đỡ) | ĐỎ |
| 3 | XANH | XANH |
| 4 | XANH | XANH |

Đừng hoảng khi task 1 và 2 đỏ. Mỗi task có cổng xác minh **riêng** của nó, ghi rõ ở bước cuối. Chỉ dùng cổng đó để phán xét task đó.

## File Structure

**Sửa:**
- `package.json` — deps, scripts, engines
- `tsconfig.json` — bỏ cấu hình emit
- `.gitignore` — bỏ `dist/`
- `src/db/connection.ts` — driver `bun:sqlite`
- `src/db/migrate.ts` — migrator `bun-sqlite`
- `src/index.ts` — pragma + bỏ dotenv
- `src/bot/deploy-commands.ts` — bỏ dotenv
- `drizzle.config.ts` — bỏ dotenv
- `tests/db/migrate.test.ts` — type `bun:sqlite`
- 27 file `tests/**/*.test.ts` — import `bun:test`
- `README.md` — toàn bộ phần cài đặt/script/deploy

**Tạo:**
- `scripts/migrate.ts` — thay `drizzle-kit migrate`
- `scripts/check-drift.ts` — thay `scripts/check-drift.mjs`

**Xoá:**
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `vitest.config.ts`
- `scripts/rewrite-aliases.mjs`, `scripts/check-drift.mjs`
- `dist/`

---

### Task 1: Toolchain, build pipeline, dotenv

Gỡ pnpm, gỡ toàn bộ bước build, gỡ các dependency sắp không còn dùng. Sau task này repo cài bằng Bun và không còn `dist/`.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore`
- Modify: `src/index.ts:1` (bỏ dòng `import 'dotenv/config'`)
- Modify: `src/bot/deploy-commands.ts:1` (bỏ dòng `import 'dotenv/config'`)
- Modify: `drizzle.config.ts:1` (bỏ dòng `import 'dotenv/config'`)
- Delete: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `scripts/rewrite-aliases.mjs`, `dist/`, `node_modules/`

**Interfaces:**
- Consumes: không có (task đầu tiên)
- Produces: script `bun run db:migrate` trỏ tới `scripts/migrate.ts` (Task 2 tạo file này); script `bun run db:drift` trỏ tới `scripts/check-drift.ts` (Task 4 tạo file này). Hai script đó chưa chạy được cho tới task tương ứng — đúng như dự kiến.

- [ ] **Step 1: Thay toàn bộ `package.json`**

```json
{
  "name": "noti-discord",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "bun": ">=1.3.0"
  },
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "typecheck": "tsc --noEmit",
    "db:generate": "bunx drizzle-kit generate",
    "db:migrate": "bun scripts/migrate.ts",
    "db:drift": "bun scripts/check-drift.ts",
    "deploy-commands": "bun src/bot/deploy-commands.ts"
  },
  "dependencies": {
    "discord.js": "^14.27.0",
    "drizzle-orm": "^0.45.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/bun": "^1.4.0",
    "@types/node": "^26.2.0",
    "drizzle-kit": "^0.31.10",
    "typescript": "^7.0.2"
  }
}
```

Những thứ vừa biến mất, và vì sao: `postinstall`/`build` (Bun chạy thẳng TS, không cần `dist/`), `db:studio` (drizzle-kit bắt buộc `better-sqlite3` hoặc `@libsql/client` mới kết nối được SQLite, không đáng giữ native dep chỉ để xem dữ liệu), `better-sqlite3` + `@types/better-sqlite3` (thay bằng `bun:sqlite`), `tsx` (Bun chạy TS sẵn), `vitest` (thay bằng `bun test`), `dotenv` (Bun tự nạp `.env`).

- [ ] **Step 2: Thay `tsconfig.json`**

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
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "types": ["bun"]
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts"]
}
```

Đã bỏ `rootDir`, `outDir`, `sourceMap`, `declaration` — không còn emit thì chúng vô nghĩa, và `rootDir: src` sẽ báo lỗi ngay khi `include` có `scripts/`. `types` đổi sang `["bun"]` để `bun:sqlite`, `bun:test`, `Bun.*` có kiểu.

Lưu ý: file gốc có BOM ở đầu. Ghi lại file không BOM là được, không ảnh hưởng gì.

Nếu tới cổng typecheck ở Task 3 mà `tsc` báo không tìm thấy kiểu cho các import `node:fs`,
`node:path`, `node:child_process`, đổi `"types": ["bun"]` thành `"types": ["bun", "node"]`.
`@types/bun` bình thường đã kéo theo kiểu Node, nên chỉ dùng cách này khi thật sự thấy lỗi.

- [ ] **Step 3: Bỏ `dist/` khỏi `.gitignore`**

Xoá hai dòng này trong khối `# Build output`:

```
dist/
*.tsbuildinfo
```

Giữ nguyên phần còn lại của file.

- [ ] **Step 4: Bỏ ba dòng `import 'dotenv/config'`**

Xoá dòng đầu tiên của mỗi file sau — chính xác là dòng `import 'dotenv/config'`:

- `src/index.ts` (dòng 1)
- `src/bot/deploy-commands.ts` (dòng 1)
- `drizzle.config.ts` (dòng 1)

Không đổi gì khác trong ba file đó ở task này. Bun nạp `.env` từ thư mục làm việc một cách tự động, nên `process.env.*` vẫn có giá trị như cũ.

- [ ] **Step 5: Xoá file và thư mục thừa**

```bash
rm -f pnpm-lock.yaml pnpm-workspace.yaml vitest.config.ts scripts/rewrite-aliases.mjs
rm -rf dist node_modules
```

`pnpm-workspace.yaml` chỉ chứa `allowBuilds` cho `better-sqlite3`/`esbuild` — cả hai lý do đều biến mất. Xoá `node_modules` để `bun install` dựng lại từ đầu, không sót artifact của pnpm.

- [ ] **Step 6: Cài bằng Bun**

```bash
bun install
```

Expected: chạy xong không lỗi, sinh ra file `bun.lock` ở thư mục gốc.

- [ ] **Step 7: Cổng xác minh của task này**

```bash
test -f bun.lock && echo "bun.lock OK"
test ! -d dist && echo "dist đã xoá OK"
test ! -f pnpm-lock.yaml && echo "pnpm-lock đã xoá OK"
bun -e "console.log('DB_PATH =', process.env.DB_PATH)"
```

Expected: ba dòng OK, và dòng cuối in ra giá trị `DB_PATH` lấy từ `.env` — đây là bằng chứng Bun tự nạp `.env` nên gỡ `dotenv` là an toàn.

**KHÔNG** chạy `bun test` hay `bun run typecheck` ở task này. Chúng đỏ, và đó là dự kiến (xem bảng ở đầu plan).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: chuyển toolchain sang Bun, bỏ bước build"
```

---

### Task 2: Tầng DB sang bun:sqlite

Đổi driver và tạo script migrate thay cho `drizzle-kit migrate`. Đây là task có cổng xác minh mạnh nhất: chạy migration thật trên file DB tạm.

**Files:**
- Modify: `src/db/connection.ts` (toàn bộ)
- Modify: `src/db/migrate.ts:1-5` (khối import) và chữ ký `hasPendingMigrations`
- Modify: `src/index.ts:41` (`raw.pragma` → `raw.exec`)
- Create: `scripts/migrate.ts`

**Interfaces:**
- Consumes: `package.json` đã gỡ `better-sqlite3` (Task 1)
- Produces:
  - `openDb(path: string): OpenedDb` và `openTestDb(): OpenedDb` với `OpenedDb = { raw: Database; db: Db }`, trong đó `Database` là lớp của `bun:sqlite` và `Db = BunSQLiteDatabase<typeof schema>`. Task 3 dùng `openTestDb()` trong tests.
  - `hasPendingMigrations(raw: Database, folder?: string): boolean` — tham số đầu giờ là `Database` của `bun:sqlite`. Task 3 dựa vào chữ ký này.
  - `applyMigrations(db: Db, folder?: string): Promise<void>` — không đổi chữ ký.
  - `scripts/migrate.ts` — chạy được bằng `bun run db:migrate`.

- [ ] **Step 1: Viết lại `src/db/connection.ts`**

```ts
import Database from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.js'

export type Db = BunSQLiteDatabase<typeof schema>

export type OpenedDb = { raw: Database; db: Db }

export function openDb(path: string): OpenedDb {
  const raw = new Database(path)
  raw.exec('PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(raw, { schema })
  return { raw, db }
}

export function openTestDb(): OpenedDb {
  const raw = new Database(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(raw, { schema })
  return { raw, db }
}
```

Ba thứ đổi so với bản cũ: nguồn của `Database` (`bun:sqlite` thay `better-sqlite3`), adapter drizzle (`bun-sqlite` thay `better-sqlite3`), và `raw.pragma('X')` → `raw.exec('PRAGMA X')` vì `bun:sqlite` không có phương thức `.pragma()`. Kiểu `raw` cũng đơn giản hơn: `Database` chứ không phải `Database.Database`.

- [ ] **Step 2: Sửa khối import và chữ ký trong `src/db/migrate.ts`**

Thay 5 dòng import đầu file:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'bun:sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { Db } from './connection.js'
```

Rồi đổi kiểu tham số của `hasPendingMigrations` từ `Database.Database` thành `Database`:

```ts
export function hasPendingMigrations(
  raw: Database,
  folder: string = MIGRATIONS_FOLDER,
): boolean {
```

**Thân hàm giữ nguyên hoàn toàn.** Truy vấn `SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1` vẫn đúng: đã chạy probe thật với adapter `bun-sqlite` trên đúng thư mục `drizzle/` của repo và bảng sinh ra có cột `id`/`hash`/`created_at`, với `created_at` là epoch mili-giây — cùng đơn vị mà `folderMillis` so sánh. `readMigrationFiles`, `backupDbFile`, `pruneBackups` cũng không đổi vì chúng chỉ đụng filesystem.

- [ ] **Step 3: Sửa pragma trong `src/index.ts`**

Trong `main()`, đổi đúng một dòng:

```ts
  const { raw, db } = openDb(config.dbPath)
  if (dbExisted && hasPendingMigrations(raw)) {
    raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const backup = backupDbFile(config.dbPath, clock())
    if (backup) logger.info(`Đã backup DB trước migration sang ${backup}`)
  }
```

Dòng cũ là `raw.pragma('wal_checkpoint(TRUNCATE)')`. `raw.close()` ở hàm `shutdown` giữ nguyên — `bun:sqlite` có `.close()`.

- [ ] **Step 4: Tạo `scripts/migrate.ts`**

```ts
import { openDb } from '../src/db/connection.js'
import { applyMigrations } from '../src/db/migrate.js'

const dbPath = process.env.DB_PATH ?? './data/monitor.db'

const { raw, db } = openDb(dbPath)
await applyMigrations(db)
raw.close()

console.log(`Đã áp migration vào ${dbPath}`)
```

Script này cố ý dùng lại `openDb` và `applyMigrations` của app thay vì tự mở kết nối riêng, để không sinh ra đường migration thứ hai phải bảo trì song song. Mặc định `./data/monitor.db` khớp với mặc định trong `drizzle.config.ts` cũ.

- [ ] **Step 5: Cổng xác minh — chạy migration thật**

```bash
DB_PATH=./data/_verify.db bun scripts/migrate.ts
```

Expected: in `Đã áp migration vào ./data/_verify.db`, không lỗi.

Rồi kiểm nội dung DB vừa tạo:

```bash
bun -e "
const { Database } = await import('bun:sqlite');
const raw = new Database('./data/_verify.db');
const t = raw.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map(r => r.name);
console.log('tables:', t);
const row = raw.prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get();
console.log('migration row:', row);
raw.close();
"
```

Expected: `tables` chứa đủ `__drizzle_migrations`, `checks`, `incidents`, `meta`, `targets`; `migration row` là một object có `created_at` là số.

Chạy lại lần nữa để xác nhận tính bình phương (áp lần hai không làm gì và không lỗi):

```bash
DB_PATH=./data/_verify.db bun scripts/migrate.ts
```

Expected: vẫn in dòng thành công, không ném lỗi.

- [ ] **Step 6: Dọn file DB tạm**

```bash
rm -f data/_verify.db data/_verify.db-wal data/_verify.db-shm
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): đổi driver sang bun:sqlite, thay db:migrate bằng script riêng"
```

---

### Task 3: Test suite sang bun:test

Chuyển cả 27 file test. Sau task này repo **xanh trở lại** — đây là cổng lớn nhất của cả plan.

**Files:**
- Modify: tất cả 27 file `tests/**/*.test.ts` (đổi dòng import)
- Modify: `tests/db/migrate.test.ts:12` (kiểu `Database`)
- Modify: `tests/monitor/scheduler.test.ts` (viết lại test fake timer)

**Interfaces:**
- Consumes: `openTestDb()`, `applyMigrations()`, `hasPendingMigrations(raw: Database)` từ Task 2
- Produces: không có gì cho task sau — đây là cổng xác minh

- [ ] **Step 1: Đổi dòng import trong cả 27 file**

Chỉ đổi nguồn module, giữ nguyên danh sách tên import. Có đúng 6 biến thể trong repo:

| Số file | Dòng cũ | Dòng mới |
|---|---|---|
| 12 | `import { describe, expect, it } from 'vitest'` | `import { describe, expect, it } from 'bun:test'` |
| 9 | `import { beforeEach, describe, expect, it } from 'vitest'` | `import { beforeEach, describe, expect, it } from 'bun:test'` |
| 3 | `import { describe, expect, it, vi } from 'vitest'` | `import { describe, expect, it, mock } from 'bun:test'` |
| 1 | `import { afterEach, describe, expect, it } from 'vitest'` | `import { afterEach, describe, expect, it } from 'bun:test'` |
| 1 | `import { afterAll, beforeAll, describe, expect, it } from 'vitest'` | `import { afterAll, beforeAll, describe, expect, it } from 'bun:test'` |
| 1 | `import { beforeEach, describe, expect, it, vi } from 'vitest'` | `import { beforeEach, describe, expect, it, mock } from 'bun:test'` |

Cách làm nhanh, chạy từ thư mục gốc:

```bash
grep -rl "from 'vitest'" tests | while read -r f; do
  sed -i "s/ from 'vitest'/ from 'bun:test'/" "$f"
  sed -i "s/import { describe, expect, it, vi }/import { describe, expect, it, mock }/" "$f"
  sed -i "s/import { beforeEach, describe, expect, it, vi }/import { beforeEach, describe, expect, it, mock }/" "$f"
done
grep -rn "from 'vitest'" tests || echo "Không còn import vitest nào"
```

Riêng `tests/monitor/scheduler.test.ts` sẽ cần thêm `jest` vào danh sách import — Step 4 xử lý.

- [ ] **Step 2: Đổi 18 chỗ `vi.fn(` thành `mock(`**

```bash
grep -rl "vi\.fn(" tests | while read -r f; do sed -i "s/vi\.fn(/mock(/g" "$f"; done
grep -rn "vi\.fn(" tests || echo "Không còn vi.fn nào"
```

`mock()` của `bun:test` nhận cùng dạng đối số như `vi.fn()`: `mock()` cho hàm rỗng, `mock(() => giá_trị)` cho hàm có sẵn thân.

- [ ] **Step 3: Đổi kiểu `Database` trong `tests/db/migrate.test.ts`**

Dòng 12 hiện là:

```ts
function tableNames(raw: import('better-sqlite3').Database): string[] {
```

Đổi thành:

```ts
function tableNames(raw: import('bun:sqlite').Database): string[] {
```

Thân hàm giữ nguyên — `raw.prepare(...).all()` có ở cả hai driver. Các chỗ khác trong file dùng `raw.prepare(...).run()`, `.get()`, `raw.close()` cũng đều không đổi.

- [ ] **Step 4: Viết lại test fake timer trong `tests/monitor/scheduler.test.ts`**

Sửa dòng import đầu file thành:

```ts
import { describe, expect, it, jest, mock } from 'bun:test'
```

Thêm hàm trợ giúp này ngay dưới hàm `setup(...)`:

```ts
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
```

Rồi thay nguyên test `'start chạy tick theo chu kỳ, stop thì dừng'` bằng:

```ts
  it('start chạy tick theo chu kỳ, stop thì dừng', async () => {
    jest.useFakeTimers()
    try {
      const context = setup([target('a', 1)])
      context.scheduler.start()

      jest.advanceTimersByTime(10_000)
      await flushMicrotasks()
      jest.advanceTimersByTime(10_000)
      await flushMicrotasks()
      const afterTwoTicks = context.calls.length
      expect(afterTwoTicks).toBeGreaterThanOrEqual(2)

      context.scheduler.stop()
      jest.advanceTimersByTime(30_000)
      await flushMicrotasks()
      expect(context.calls.length).toBe(afterTwoTicks)
    } finally {
      jest.useRealTimers()
    }
  })
```

Vì sao phải viết lại: `bun test` 1.3.14 **không có** `advanceTimersByTimeAsync`, chỉ có bản đồng bộ. `scheduler.start()` gọi `setInterval` với callback chạy `void tick()`, nên sau khi đẩy đồng hồ ta phải nhường microtask cho `tick()` chạy xong. `runWithLimit` trong `src/shared/concurrency.ts` thuần microtask, không đụng timer, nên vòng lặp `await Promise.resolve()` là đủ — không được dùng `setTimeout` để flush vì timer đang bị giả lập.

Bản viết lại này đã được chạy thật dưới `bun test` 1.3.14 và pass.

Test `'stop khi chưa start không lỗi'` phía dưới giữ nguyên, không đụng vào.

- [ ] **Step 5: Cổng xác minh — cả suite phải xanh**

```bash
bun test
```

Expected: 0 fail, và số file chạy đúng bằng 27.

```bash
bun run typecheck
```

Expected: không in lỗi nào, exit code 0.

Nếu `bun test` báo lỗi ở một matcher cụ thể nào đó, sửa đúng matcher đó rồi chạy lại — đừng đổi hành vi mà test đang khẳng định.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: chuyển toàn bộ test suite sang bun:test"
```

---

### Task 4: Port script check-drift

Đưa `db:drift` chạy được trở lại dưới Bun, và nhân tiện xoá đoạn workaround Windows đã hết lý do tồn tại.

**Files:**
- Create: `scripts/check-drift.ts`
- Delete: `scripts/check-drift.mjs`

**Interfaces:**
- Consumes: script `db:drift` trong `package.json` đã trỏ tới `scripts/check-drift.ts` (Task 1)
- Produces: không có gì cho task sau

- [ ] **Step 1: Tạo `scripts/check-drift.ts`**

```ts
function git(args: string[]): string {
  const result = Bun.spawnSync(['git', ...args])
  if (result.exitCode !== 0) {
    console.error(new TextDecoder().decode(result.stderr))
    process.exit(1)
  }
  return new TextDecoder().decode(result.stdout)
}

const before = git(['status', '--porcelain', '--', 'drizzle'])

const generated = Bun.spawnSync(['bunx', 'drizzle-kit', 'generate'])
if (generated.exitCode !== 0) {
  console.error('drizzle-kit generate thất bại:')
  console.error(new TextDecoder().decode(generated.stdout))
  console.error(new TextDecoder().decode(generated.stderr))
  process.exit(1)
}

const after = git(['status', '--porcelain', '--', 'drizzle'])

if (after !== before) {
  console.error('src/db/schema.ts đã lệch với thư mục drizzle/.')
  console.error('Chạy `bun run db:generate`, đọc file SQL sinh ra, rồi commit nó.')
  console.error('Thay đổi mà lệnh này phát hiện:')
  console.error(after)
  process.exit(1)
}

console.log('OK: schema.ts khớp với drizzle/.')
```

Logic giữ nguyên bản cũ: chụp trạng thái git của thư mục `drizzle/` trước và sau khi `generate`, khác nhau nghĩa là schema đã lệch.

Thứ **cố ý bỏ đi** là đoạn `createRequire` + `require.resolve('drizzle-kit')` + gọi `bin.cjs` qua `process.execPath`. Đoạn đó chỉ tồn tại vì `execFileSync` của Node không spawn được `npx.cmd` trên Windows nếu không qua shell. `Bun.spawnSync` không dính vấn đề đó, nên gọi thẳng `bunx drizzle-kit generate` là đủ và dễ đọc hơn nhiều.

Cũng đổi thông điệp lỗi từ `npm run db:generate` sang `bun run db:generate` cho khớp toolchain mới.

- [ ] **Step 2: Xoá script cũ**

```bash
rm -f scripts/check-drift.mjs
```

- [ ] **Step 3: Cổng xác minh — trường hợp không lệch**

```bash
bun run db:drift
```

Expected: in `OK: schema.ts khớp với drizzle/.`, exit code 0.

- [ ] **Step 4: Cổng xác minh — trường hợp có lệch**

Script chỉ có giá trị nếu nó thật sự **bắt được** lệch. Tạo lệch giả rồi kiểm tra nó fail:

```bash
cp src/db/schema.ts /tmp/schema.bak
printf "\nexport const _driftProbe = sqliteTable('_drift_probe', { id: integer('id').primaryKey() })\n" >> src/db/schema.ts
bun run db:drift; echo "exit=$?"
```

Expected: in `src/db/schema.ts đã lệch với thư mục drizzle/.` và `exit=1`.

Rồi khôi phục nguyên trạng — cả `schema.ts` lẫn file migration mà `generate` vừa sinh ra:

```bash
cp /tmp/schema.bak src/db/schema.ts
git checkout -- drizzle/ 2>/dev/null
git clean -fd drizzle/
bun run db:drift
git status --porcelain
```

Expected: `bun run db:drift` in OK trở lại, và `git status --porcelain` không còn file lạ nào trong `drizzle/`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: port check-drift sang bun, bỏ workaround npx trên Windows"
```

---

### Task 5: README và tài liệu deploy

Cập nhật tài liệu cho khớp thực tế mới. Phần lớn công việc ở đây là **xoá** — cả một mục cảnh báo dài chỉ tồn tại vì `better-sqlite3`.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: mọi thay đổi từ Task 1–4
- Produces: không có gì cho task sau

- [ ] **Step 1: Sửa mục "Yêu cầu"**

Thay:

```markdown
## Yêu cầu

Node.js >= 25.
```

bằng:

```markdown
## Yêu cầu

Bun >= 1.3.
```

- [ ] **Step 2: Sửa khối lệnh trong mục "Cài đặt"**

Thay khối bash hiện có bằng:

```bash
bun install
cp .env.example .env   # rồi điền giá trị thật
bun run db:generate    # chỉ cần khi đã sửa src/db/schema.ts
bun run db:migrate
bun run deploy-commands
bun run dev
```

- [ ] **Step 3: Thay bảng "Script"**

Thay nguyên bảng hiện có bằng:

```markdown
| Lệnh | Việc |
|---|---|
| `bun run dev` | Chạy ở chế độ dev, tự reload |
| `bun start` | Chạy thẳng mã nguồn, không cần build |
| `bun test` | Chạy toàn bộ test |
| `bun run typecheck` | Kiểm tra kiểu, không xuất file |
| `bun run db:generate` | Sinh migration sau khi sửa `schema.ts` |
| `bun run db:migrate` | Áp migration vào DB |
| `bun run db:drift` | Chặn `schema.ts` lệch với `drizzle/` |
| `bun run deploy-commands` | Đăng ký slash command vào guild |
```

Dòng `build && start` biến mất vì không còn bước build. Dòng `db:studio` biến mất — Step 5 giải thích chỗ thay thế.

- [ ] **Step 4: Sửa mục "Đổi schema DB"**

Trong danh sách 4 bước, đổi `npm run db:generate` thành `bun run db:generate` và `npm run db:migrate` thành `bun run db:migrate`. Giữ nguyên đoạn văn phía dưới về forward-only và về việc không dùng `drizzle-kit push`.

- [ ] **Step 5: Thêm ghi chú về việc xem dữ liệu**

Thêm vào cuối mục "Đổi schema DB" đoạn văn sau, rồi một khối bash chứa đúng lệnh
`bun add -D better-sqlite3 && bunx drizzle-kit studio`:

> Không còn script `db:studio`: `drizzle-kit` chỉ kết nối SQLite qua `better-sqlite3`
> hoặc `@libsql/client`, nó không hỗ trợ `bun:sqlite`, và giữ một native module chỉ để
> xem dữ liệu thì không đáng. Khi cần nhìn vào DB, hoặc mở thẳng file `.db` bằng một
> SQLite browser bất kỳ, hoặc cài tạm rồi gỡ đi.

- [ ] **Step 6: Viết lại mục "Deploy"**

Thay toàn bộ đoạn mở đầu mục `## Deploy` — tức cả danh sách gạch đầu dòng nói về native module (base image debian thay vì alpine, `npm ci` bên trong image, multi-stage cùng base, mount volume) lẫn đoạn văn nói về `postinstall` — bằng:

```markdown
Không còn native module nào, nên không còn ràng buộc về base image, glibc/musl hay
rebuild khi đổi máy. Điều duy nhất còn quan trọng: **mount volume cho thư mục chứa file
SQLite** (`./data`), vì filesystem của Fly.io và Railway là ephemeral. Trên Fly.io nhớ
tắt autostop để process không bị suspend.

Không có bước build. `bun src/index.ts` chạy thẳng mã nguồn. Migration DB không cần chạy
tay — `main()` trong `src/index.ts` tự backup khi cần và chạy `applyMigrations` mỗi lần
process khởi động. Lịch sử check hết hạn cũng được dọn ngay khi khởi động và trước mỗi
digest, kể cả khi gửi Discord thất bại.
```

- [ ] **Step 7: Viết lại mục "Wispbyte (hoặc panel Pterodactyl khác)"**

Thay toàn bộ nội dung mục đó — 6 bước cộng đoạn lưu ý cuối về `postinstall`/`--omit=dev` — bằng:

```markdown
Không cần Dockerfile — panel chạy app trực tiếp.

1. Tạo server, chọn egg Bun (hoặc egg cho phép tự cài Bun binary trong container).
2. Đưa code lên bằng file manager/SFTP hoặc git pull qua console, rồi chạy `bun install`.
3. Điền toàn bộ biến trong `.env.example` vào tab **Startup/Variables** của panel.
4. Đảm bảo thư mục `data/` (giá trị `DB_PATH`) nằm trong phần lưu trữ persistent của
   server, không bị xoá giữa các lần restart.
5. Startup command: `bun src/index.ts`.
6. Chạy `bun run deploy-commands` một lần qua console panel sau khi đã điền
   `DISCORD_TOKEN`/`DISCORD_CLIENT_ID` để đăng ký slash command — bước này không tự động,
   vì đăng ký lại mỗi lần deploy có thể dư thừa hoặc hit rate limit.
```

Đoạn cảnh báo cũ về việc không copy `node_modules` từ Windows sang cũng bỏ luôn: nó tồn tại vì `better-sqlite3` biên dịch theo glibc của máy build.

- [ ] **Step 8: Đọc lại toàn bộ README**

```bash
grep -n "npm \|node \|better-sqlite3\|dist/\|db:studio\|postinstall\|alpine" README.md
```

Expected: không còn dòng nào, **trừ** dòng trong khối `bun add -D better-sqlite3` ở Step 5 (đó là cố ý). Nếu còn sót chỗ nào khác, sửa nốt.

- [ ] **Step 9: Commit**

```bash
git add README.md
git commit -m "docs: cập nhật README cho toolchain Bun"
```

---

### Task 6: Xác minh toàn cục và gộp thành một commit

Chạy lại mọi cổng một lượt trên trạng thái cuối, làm smoke test thật, rồi squash 5 commit checkpoint thành một commit theo đúng chiến lược big-bang đã chốt.

**Files:** không sửa file nào (trừ khi smoke test lộ ra lỗi)

**Interfaces:**
- Consumes: toàn bộ Task 1–5

- [ ] **Step 1: Cài lại từ đầu**

```bash
rm -rf node_modules
bun install
```

Expected: không lỗi. Đây là bằng chứng `bun.lock` đủ dùng cho một máy sạch — chính là thứ panel sẽ làm.

- [ ] **Step 2: Chạy hết các cổng tự động**

```bash
bun run typecheck
bun test
bun run db:drift
```

Expected: cả ba exit code 0, `bun test` 0 fail.

- [ ] **Step 3: Xác nhận không còn dấu vết Node/pnpm/native**

```bash
grep -rn "better-sqlite3\|vitest\|dotenv\|tsx" package.json || echo "package.json sạch"
test ! -f pnpm-lock.yaml && test ! -f pnpm-workspace.yaml && echo "pnpm đã sạch"
test ! -f vitest.config.ts && test ! -f scripts/rewrite-aliases.mjs && test ! -f scripts/check-drift.mjs && echo "script cũ đã sạch"
test ! -d dist && echo "dist đã sạch"
grep -rn "dotenv" src drizzle.config.ts || echo "src sạch dotenv"
```

Expected: cả 5 dòng xác nhận.

- [ ] **Step 4: Smoke test thật**

Đây là bước **không được bỏ**. Không test nào trong repo phủ được discord.js chạy dưới Bun, mà đó là dependency nặng nhất của dự án.

Với `.env` đã có `DISCORD_TOKEN` thật:

```bash
bun src/index.ts
```

Expected, trong vòng vài giây:
- Dòng log `DB đã sẵn sàng tại <đường dẫn>`
- Dòng log `Đã đăng nhập với tư cách <tên bot>` — đây là bằng chứng discord.js bắt tay được gateway dưới Bun
- Dòng log `Scheduler chạy mỗi <n>ms`

Rồi bấm `Ctrl+C`. Expected: log `Nhận SIGINT, đang tắt` rồi process thoát sạch — bằng chứng handler tín hiệu và `raw.close()` của `bun:sqlite` hoạt động.

Nếu bất kỳ dòng nào không xuất hiện, **dừng lại và báo cáo**. Đừng squash một migration chưa chạy được.

- [ ] **Step 5: Gộp thành một commit**

Chiến lược đã chốt là giao ra một commit duy nhất. Gộp 5 commit checkpoint của Task 1–5:

```bash
git reset --soft HEAD~5
git status
```

Expected: mọi thay đổi nằm ở vùng staged, không mất gì. Đối chiếu danh sách file với mục "File Structure" ở đầu plan trước khi commit.

```bash
git commit -m "$(cat <<'EOF'
chore: migrate toàn bộ dự án sang Bun

Đổi package manager, runtime, test runner và driver SQLite sang Bun.

- bun install thay pnpm; bỏ pnpm-lock.yaml và pnpm-workspace.yaml
- Bỏ hẳn bước build: không còn tsc, dist/, postinstall, rewrite-aliases.mjs
- bun:sqlite + drizzle-orm/bun-sqlite thay better-sqlite3; repo không còn
  native module nào, nên mọi ràng buộc glibc/musl/prebuild khi deploy biến mất
- bun test thay vitest trên cả 27 file test
- drizzle-kit không hỗ trợ bun:sqlite nên db:migrate chuyển sang
  scripts/migrate.ts dùng lại openDb/applyMigrations của app, và db:studio bị bỏ
- Bun tự nạp .env nên gỡ dotenv
- README bỏ toàn bộ mục cảnh báo native module; panel chuyển sang egg Bun với
  startup command `bun src/index.ts`

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Kiểm tra lần cuối sau khi squash**

```bash
git log --oneline -3
git status --porcelain
bun test
```

Expected: đúng một commit mới trên đầu, working tree sạch, test vẫn xanh.

---

## Ngoài phạm vi

Những việc dưới đây **cố ý không làm** trong plan này. Đừng tiện tay làm luôn.

- Bật typecheck cho `tests/`. Đang có 4 lỗi type tồn sẵn ở `tests/bot/router.test.ts` (phương sai của `Mock<>`) và `tests/notify/discord-notifier.test.ts:41` (`noUncheckedIndexedAccess` trên tuple rỗng). Dọn chúng rồi thêm `tests/**/*.ts` vào `include` là một thay đổi riêng.
- Thêm CI. Repo chưa có `.github/workflows`.
- Viết Dockerfile. Panel chạy trực tiếp, không đóng image.
- Dùng `bun build --compile` đóng binary. Chạy thẳng mã nguồn đơn giản hơn và không mất gì.
- Đổi logic nghiệp vụ, schema DB, hay hành vi bot.
