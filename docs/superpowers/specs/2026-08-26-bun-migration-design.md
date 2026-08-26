# Migrate noti-discord sang Bun

Ngày: 2026-08-26

## Mục tiêu

Chuyển toàn bộ dự án sang chạy trên Bun: package manager, runtime, test runner và
driver SQLite. Kết quả mong đợi là repo không còn native module nào, không còn bước
build, và deploy chỉ còn một lệnh chạy thẳng mã nguồn.

## Quyết định đã chốt

| Trục | Chọn | Lý do |
|---|---|---|
| Môi trường deploy | Panel chạy được Bun | Cho phép migrate toàn phần thay vì chỉ đổi toolchain dev |
| Driver SQLite | `bun:sqlite` | Gỡ hẳn native module, xoá toàn bộ rủi ro glibc/musl/prebuild khi deploy |
| Test runner | `bun test` | Một runtime duy nhất; gỡ được `vitest` lẫn `tsx` |
| Chiến lược | Big-bang một commit | Người dùng chọn; đổi hết cùng lúc nên không bao giờ phải chạy `better-sqlite3` dưới `bun test` |
| `db:studio` | Bỏ | Là thứ duy nhất buộc giữ native dep; không đáng đánh đổi |

## Phát hiện chi phối thiết kế

**`drizzle-kit` không hỗ trợ `bun:sqlite`.** Mã trong `node_modules/drizzle-kit/bin.cjs`
chỉ thử `@libsql/client` rồi `better-sqlite3`, không có nhánh nào cho `bun:sqlite`. Khi
không tìm thấy cả hai, nó in "Please install either 'better-sqlite3' or '@libsql/client'
for Drizzle Kit to connect to SQLite databases" rồi `process.exit(1)`.

Hệ quả: sau khi gỡ `better-sqlite3`, mọi lệnh drizzle-kit **cần kết nối DB** sẽ chết.
Lệnh không cần kết nối DB thì vẫn sống. Đã xác minh `bunx drizzle-kit check` chạy tốt
dưới Bun và đọc được `drizzle.config.ts` viết bằng TypeScript.

**`bun test` không có `advanceTimersByTimeAsync`.** Đã xác minh trên Bun 1.3.14:
`jest.advanceTimersByTime` (bản đồng bộ) tồn tại và hoạt động, bản `...Async` thì không.

**Tầng DB chạm 3 file, không phải 2.** Ngoài `connection.ts` và `migrate.ts`,
`src/index.ts:41` cũng gọi API riêng của better-sqlite3 (`raw.pragma`).

## Phạm vi thay đổi

### 1. Toolchain và build pipeline

Đổi package manager sang `bun install`. Xoá `pnpm-lock.yaml` và `pnpm-workspace.yaml`
— file thứ hai chỉ tồn tại để khai báo `allowBuilds` cho `better-sqlite3`/`esbuild`, nên
mất sạch lý do tồn tại. Commit `bun.lock`.

Bỏ toàn bộ bước build. Bun chạy thẳng TypeScript nên không cần `tsc` sinh `dist/`:

- Xoá script `build` và `postinstall`
- Xoá `scripts/rewrite-aliases.mjs` — Bun đọc alias `@/` thẳng từ `tsconfig.paths`
- Xoá thư mục `dist/` và mục `dist/` trong `.gitignore`
- Giữ `typecheck` là `tsc --noEmit`; Bun không kiểm kiểu

Dependencies bị gỡ: `better-sqlite3`, `@types/better-sqlite3`, `tsx`, `vitest`, `dotenv`.
Bun tự nạp `.env` nên ba dòng `import 'dotenv/config'` (trong `src/index.ts`,
`src/bot/deploy-commands.ts`, `drizzle.config.ts`) bỏ luôn.

Thêm `@types/bun`. Giữ `@types/node` — mã vẫn import `node:fs`, `node:path`,
`node:child_process`, và `@types/bun` phụ thuộc vào nó. Danh sách `devDependencies` cuối
cùng: `@types/bun`, `@types/node`, `drizzle-kit`, `typescript`. `dependencies` cuối cùng:
`discord.js`, `drizzle-orm`, `zod`.

`package.json` sau khi đổi:

| Script | Lệnh |
|---|---|
| `dev` | `bun --watch src/index.ts` |
| `start` | `bun src/index.ts` |
| `test` | `bun test` |
| `test:watch` | `bun test --watch` |
| `typecheck` | `tsc --noEmit` |
| `db:generate` | `bunx drizzle-kit generate` |
| `db:migrate` | `bun scripts/migrate.ts` |
| `db:drift` | `bun scripts/check-drift.ts` |
| `deploy-commands` | `bun src/bot/deploy-commands.ts` |

`engines` đổi từ `{ "node": ">=25.0.0" }` thành `{ "bun": ">=1.3.0" }`.

`tsconfig.json`: `module`/`moduleResolution` sang `preserve`/`bundler`, thêm
`noEmit: true`, bỏ `rootDir` và `outDir`, `types` đổi từ `["node"]` sang `["bun"]`,
`include` mở rộng cho `tests/` và `scripts/`.

### 2. Tầng DB

`src/db/connection.ts`:

- `import Database from 'bun:sqlite'`
- `drizzle` và type từ `drizzle-orm/bun-sqlite` (`BunSQLiteDatabase`)
- `raw.pragma('journal_mode = WAL')` thành `raw.exec('PRAGMA journal_mode = WAL')`
- `raw.pragma('foreign_keys = ON')` thành `raw.exec('PRAGMA foreign_keys = ON')`
- Type `OpenedDb.raw` đổi sang `Database` của `bun:sqlite`

`src/db/migrate.ts`:

- `migrate` từ `drizzle-orm/bun-sqlite/migrator`
- Bỏ `import type Database from 'better-sqlite3'`, dùng type của `bun:sqlite`
- `readMigrationFiles` từ `drizzle-orm/migrator` giữ nguyên — không phụ thuộc runtime
- `raw.prepare(...).get()` giữ nguyên; `bun:sqlite` có API tương đương

`src/index.ts`: `raw.pragma('wal_checkpoint(TRUNCATE)')` thành
`raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')`. `raw.close()` giữ nguyên.

Rủi ro cần canh: `hasPendingMigrations` truy vấn thẳng bảng `__drizzle_migrations`.
Hai adapter dùng chung `drizzle-orm/migrator` nên nhiều khả năng schema bảng giống nhau,
nhưng `tests/db/migrate.test.ts` là chỗ bắt được nếu không. Nếu cột `created_at` khác đi
thì phải sửa truy vấn cho khớp thực tế của adapter mới.

### 3. Script quanh drizzle-kit

`db:generate` giữ nguyên hành vi, chỉ chạy qua `bunx`.

`db:migrate` không dùng drizzle-kit được nữa. Thay bằng `scripts/migrate.ts` mới, gọi
chính `openDb` và `applyMigrations` của app — cùng đường dẫn mã mà `main()` đã dùng, nên
không phát sinh đường migration thứ hai cần bảo trì.

`scripts/check-drift.mjs` port sang `scripts/check-drift.ts`. Giữ nguyên logic (chụp
`git status --porcelain -- drizzle` trước và sau khi `generate`, khác nhau thì báo lệch),
nhưng **xoá toàn bộ đoạn workaround gọi `bin.cjs` qua `process.execPath`**: workaround đó
tồn tại chỉ vì `execFileSync` không spawn được `npx.cmd` trên Windows, và `Bun.spawn`
không dính vấn đề đó. Script mới gọi thẳng `bunx drizzle-kit generate`.

`db:studio` xoá khỏi `package.json`.

### 4. Test suite

27 file trong `tests/`:

- `from 'vitest'` thành `from 'bun:test'`
- 18 chỗ `vi.fn()` thành `mock()` của `bun:test`
- `tests/db/migrate.test.ts:12`: `import('better-sqlite3').Database` thành
  `import('bun:sqlite').Database`

Xoá `vitest.config.ts` — alias `@/` Bun đọc thẳng từ tsconfig, không cần khai báo lại.

`tests/monitor/scheduler.test.ts:98-113` là chỗ rủi ro duy nhất. Test này gọi
`vi.advanceTimersByTimeAsync` ba lần. Phương án chính: `jest.useFakeTimers()` +
`jest.advanceTimersByTime()` rồi flush microtask thủ công để `tick()` bất đồng bộ kịp
chạy. Nếu không ổn định, phương án dự phòng là tiêm timer vào `makeScheduler` và bỏ hẳn
fake timer toàn cục — cách này bền hơn nhưng chạm mã sản phẩm nên chỉ dùng khi cần.

### 5. README và deploy

Mục "Yêu cầu" đổi từ Node >= 25 sang Bun >= 1.3. Mọi lệnh `npm run` đổi thành `bun run`.
Bảng script bỏ dòng `db:studio` và dòng `build && start`, thay bằng `start` chạy thẳng.

**Xoá hẳn mục cảnh báo native module trong phần Deploy.** Toàn bộ nội dung đó — base
image debian thay vì alpine vì musl, chạy `npm ci` trong image, multi-stage phải cùng
base, và cái bẫy `postinstall` fail vì `--omit=dev` thiếu `tsc` — chỉ tồn tại vì
`better-sqlite3`. Không còn native dep thì không còn bẫy nào trong số đó. Phần cần giữ
lại là lưu ý mount volume cho thư mục chứa file SQLite.

Mục Wispbyte/Pterodactyl: đổi sang egg Bun, cài đặt bằng `bun install`, startup command
`bun src/index.ts`. Bỏ bước liên quan `postinstall`/`dist/`.

Mục "Đổi schema DB" đổi `npm run db:migrate` thành `bun run db:migrate`.

Ghi thêm vào README cách xem dữ liệu sau khi bỏ `db:studio`: cài tạm
`bun add -D better-sqlite3` rồi `bunx drizzle-kit studio`, hoặc mở file `.db` bằng một
SQLite browser bất kỳ.

## Xác minh

Thứ tự chạy sau khi hoàn tất:

1. `bun install` sạch (xoá `node_modules/` trước)
2. `bun run typecheck` — không lỗi
3. `bun test` — cả 27 file xanh
4. `bun run db:drift` — báo schema khớp
5. `bun run db:migrate` trên một file DB tạm — tạo được bảng
6. Smoke test thật: `bun src/index.ts` login được Discord gateway và mở được DB thật

Bước 6 không thể bỏ. Không test nào trong repo phủ được discord.js chạy dưới Bun, và đó
là dependency nặng nhất của dự án.

## Ngoài phạm vi

- Không đổi logic nghiệp vụ, không đổi schema DB, không đổi hành vi bot
- Không thêm CI (repo hiện chưa có `.github/workflows`)
- Không viết Dockerfile (panel chạy trực tiếp, không đóng image)
- Không dùng `bun build --compile` đóng binary — chạy thẳng mã nguồn đơn giản hơn và
  không mất gì
