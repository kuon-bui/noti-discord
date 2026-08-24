# Discord Server Monitor — Design

Ngày: 2026-08-24
Trạng thái: đã duyệt design, chờ viết implementation plan

## 1. Mục tiêu

Một daemon Node.js chạy liên tục, định kỳ kiểm tra sức khoẻ các HTTP/HTTPS
endpoint, và gửi thông báo vào Discord khi trạng thái thay đổi. Quản lý danh
sách endpoint bằng slash command ngay trong Discord.

## 2. Quyết định đã chốt

| Hạng mục | Quyết định |
|---|---|
| Runtime | Node.js 25 + TypeScript, ESM |
| Discord | discord.js v14, bot gateway (process 24/7) |
| Lưu trữ | SQLite qua `node:sqlite` (built-in, stability 1.2, không cần flag, không native build) |
| Loại check | HTTP/HTTPS: status code + latency |
| Chính sách alert | Chỉ khi đổi trạng thái UP↔DOWN. DEGRADED chỉ ghi DB, không alert |
| Báo cáo | Digest hằng ngày 09:00 `Asia/Ho_Chi_Minh`, vào channel digest riêng |
| Phạm vi | 1 guild; mỗi target có `alert_channel_id` riêng, fallback về default |
| Phân quyền | Lệnh ghi giới hạn theo `ADMIN_USER_IDS` trong `.env` |
| Kiến trúc | Một process, module hoá; interface `Probe` và `Notifier` để mở rộng |
| Vận hành | Chạy local Windows trước; Dockerfile để sau |

### Vì sao không dùng Vercel

Ban đầu cân nhắc Vercel. Hai rào cản từ tài liệu chính thức:

- **Vercel Cron trên Hobby chỉ chạy 1 lần/ngày**, sai số tới cả tiếng, và cron
  expression dày hơn sẽ làm **deploy fail**. Pro/Enterprise mới cho tới mỗi phút.
- **Serverless không giữ WebSocket lâu dài** nên `discord.js` gateway không chạy
  được; sẽ phải dùng Interactions Endpoint URL (verify Ed25519, PONG, defer type 5).

Chạy daemon giải quyết cả hai: gateway thật + interval tự do.

## 3. Ngoài phạm vi (non-goals)

- TCP port / ICMP ping / Docker / metrics CPU-RAM-disk
- Kiểm tra nội dung response body, kiểm tra hạn SSL certificate
- Nhắc lại định kỳ khi còn down (re-alert)
- Alert cho trạng thái DEGRADED
- Multi-guild
- Web dashboard

Interface `Probe` và `Notifier` được đặt sẵn để thêm các hạng mục trên về sau
mà không phải viết lại lõi.

## 4. Chi tiết cần lưu ý khi triển khai

Retry trong một lần check: người dùng không chọn chính sách "N lần fail liên
tiếp mới báo", nên mặc định một lần fail là DOWN. Để giảm báo động giả mà không
thêm luật alert mới, `http-probe` thử tối đa **2 lần cách nhau 2s** trong cùng
một lần check trước khi kết luận. Đây là chi tiết nội bộ của "một lần check",
không phải chính sách alert riêng.

## 5. Kiến trúc

Hướng phụ thuộc một chiều, không có vòng:

```
        index.ts  (wiring — module duy nhất biết mọi thứ)
            |
   +--------+----------+----------+
   v        v          v          v
  bot    monitor    digest    notify
   |        |          |          |
   +--------+----------+-----+----+
                             v
                        db  <-  config  <-  shared
```

**Luật bất biến:** `monitor` và `digest` không được import discord.js. Chúng chỉ
biết interface `Notifier`. Toàn bộ logic nghiệp vụ test được mà không cần Discord.

Mọi logic quyết định là hàm thuần (`evaluate`, `state-machine`, `embeds`,
`buildDigest`). I/O bị đẩy ra biên (`http-probe`, repo, `discord-notifier`).

### Cấu trúc thư mục

```
src/
  index.ts
  config.ts
  db/
    connection.ts  migrations.ts
    targets.repo.ts  checks.repo.ts  incidents.repo.ts  meta.repo.ts
  monitor/
    probe.ts  http-probe.ts  evaluate.ts  state-machine.ts  runner.ts  scheduler.ts
  notify/
    notifier.ts  discord-notifier.ts  embeds.ts
  digest/
    digest.ts  schedule.ts
  bot/
    client.ts  deploy-commands.ts  permissions.ts
    commands/ add.ts remove.ts list.ts status.ts check.ts pause.ts history.ts uptime.ts
  shared/
    types.ts  logger.ts  time.ts
tests/
```

## 6. Module

### M1 · config

- **Trách nhiệm:** đọc `.env`, validate bằng zod, gán default, thoát ngay nếu sai.
- **Interface:** `loadConfig(): AppConfig` — object readonly.
- **Phụ thuộc:** zod, dotenv.
- **Ghi chú:** `AppConfig` được **truyền vào** các module, không dùng biến global,
  để test bơm được config giả.
- **Test:** env hợp lệ parse đúng; thiếu `DISCORD_TOKEN` throw message rõ ràng;
  `ADMIN_USER_IDS` dạng csv trả về array.

### M2 · db

- **Trách nhiệm:** mở SQLite, chạy migration, cung cấp repository theo bảng.
  Không chứa logic nghiệp vụ.
- **Interface:** `openDb(path)`, `runMigrations(db)`, `TargetsRepo`, `ChecksRepo`,
  `IncidentsRepo`, `MetaRepo`.
- **Phụ thuộc:** `node:sqlite`, config.
- **Repo trả plain object có kiểu**, không trả row SQLite thô.

`TargetsRepo`: `create` · `findByName` · `findAll` · `findDue(now)` ·
`updateStatus` · `setPause` · `remove`

`ChecksRepo`: `insert` · `listRecent(targetId, limit)` ·
`statsSince(targetId, since)` · `deleteOlderThan(date)`

`IncidentsRepo`: `open(targetId, reason, at)` · `close(targetId, at)` ·
`findOpen(targetId)` · `listRecent(targetId, limit)` · `sumDowntime(targetId, since)`

`MetaRepo`: `get(key)` · `set(key, value)`

- **Test:** DB `:memory:` thật — CRUD target; `findDue` trả đúng target tới hạn;
  chạy migration hai lần không lỗi.

### M3 · monitor (lõi nghiệp vụ)

**probe.ts** — chỉ định nghĩa hợp đồng, điểm mở rộng cho TCP/ping:

```ts
interface Probe { run(t: Target): Promise<ProbeResult> }

type ProbeResult =
  | { ok: true;  httpStatus: number;  latencyMs: number }
  | { ok: false; httpStatus?: number; latencyMs?: number; error: string }
```

**http-probe.ts** — I/O thuần túy: `fetch` + `AbortSignal.timeout(t.timeoutMs)`,
đo latency, retry tối đa 2 lần cách nhau 2s. Không quyết định trạng thái.

**evaluate.ts** — hàm thuần `(ProbeResult, Target) => Status`:
- status code ngoài `expected_status`, hoặc lỗi mạng/timeout → `DOWN`
- ok nhưng `latencyMs > latencyThresholdMs` → `DEGRADED`
- còn lại → `UP`

**state-machine.ts** — hàm thuần `(prev: Status, next: Status) => Transition | null`.
Nơi **duy nhất** cài chính sách alert:
- `UP|DEGRADED -> DOWN` → `{ kind: 'down' }` (mở incident, embed đỏ)
- `DOWN -> UP|DEGRADED` → `{ kind: 'recovered' }` (đóng incident, embed xanh, kèm downtime)
- vào/ra `DEGRADED`, hoặc trạng thái không đổi → `null`
- `UNKNOWN -> DOWN` → `{ kind: 'down' }`; `UNKNOWN -> UP|DEGRADED` → `null`

**runner.ts** — điều phối một lần check trọn vẹn:
probe → evaluate → ghi `checks` → state-machine → mở/đóng incident → gọi
`Notifier` → cập nhật `current_status` + `last_checked_at`.
Ghi DB **trước** khi notify, nên Discord lỗi không làm mất dữ liệu.
`checkTarget(name: string): Promise<CheckOutcome>` — dùng bởi cả scheduler và `/check`.

**scheduler.ts** — tick mỗi 10s: `findDue()` → gọi `runner.checkTarget` song song
có giới hạn (mặc định 5 concurrent), bỏ qua target đang pause. Không chứa logic check.

- **Test:** `evaluate` và `state-machine` test bằng bảng input→output; `http-probe`
  test với server `node:http` local trả 200/500/chậm/treo; `runner` test với fake
  probe + fake notifier + DB in-memory — chuỗi UP→DOWN→DOWN→UP phải bắn đúng **2**
  alert; `scheduler` test với clock giả.

### M4 · notify

- **Trách nhiệm:** gửi thông báo, chọn channel, dựng embed.
- **Interface:** `interface Notifier { send(msg: AlertMessage, channelId: string): Promise<void> }`
- **Phụ thuộc:** discord.js `Client` (inject từ ngoài), config.
- **Tính năng:** embed đỏ DOWN / xanh recovered; routing channel
  (`alert_channel_id ?? DEFAULT_ALERT_CHANNEL_ID`); retry 1 lần khi Discord lỗi;
  gửi digest.
- **Test:** `embeds.ts` là builder thuần → assert title/màu/field; `discord-notifier`
  test với client giả, kiểm tra gọi đúng channel và retry đúng 1 lần.

### M5 · digest

- **Trách nhiệm:** tính số liệu, quyết định đã tới lúc gửi chưa, dọn dữ liệu cũ.
- **Interface:** `buildDigest(stats: TargetStats[], range): DigestReport` (thuần) ·
  `maybeSendDigest(now)`
- **Phân vai rõ:** `ChecksRepo.statsSince` / `IncidentsRepo.sumDowntime` trả **số
  liệu thô** (đếm check, tổng latency, số incident, tổng downtime). `buildDigest`
  là hàm thuần nhận số liệu thô đó và tính ra uptime %, latency trung bình, xếp
  hạng — không tự truy vấn DB. Nhờ vậy `/uptime` (một target, range 24h/7d/30d) và
  digest hằng ngày (mọi target, range 24h) **dùng chung đúng một hàm tính**.
- **Phạm vi digest:** báo cáo tổng hợp **toàn bộ target** đang tồn tại, kể cả
  target đang pause (ghi rõ nhãn `paused`).
- **Phụ thuộc:** db, notify, config.
- **Tính năng:** digest 09:00 VN; uptime %; latency trung bình; số lần down; dọn
  `checks` cũ hơn `CHECK_RETENTION_DAYS`.
- **Không dùng thư viện cron:** so `meta.last_digest_date` với ngày hiện tại theo
  giờ VN. Ít phụ thuộc hơn và tự gửi bù khi process restart muộn.
- **Test:** `buildDigest` với dữ liệu dựng sẵn → uptime% đúng; `maybeSendDigest`
  đã gửi hôm nay thì không gửi lại; restart lúc 14h mà sáng chưa gửi thì vẫn gửi bù.

### M6 · bot

- **Trách nhiệm:** kết nối gateway, đăng ký lệnh, route interaction, kiểm tra quyền.
- **Interface:** `createClient(config)` · `deployCommands()` (script riêng) · mỗi
  command là `{ data, execute, adminOnly }`.
- **Phụ thuộc:** discord.js, db repo, `monitor/runner` (cho `/check`),
  `digest.buildDigest` (cho `/uptime`), config.
- **Đăng ký lệnh:** `REST.put(Routes.applicationGuildCommands(clientId, guildId))`
  — guild command cập nhật tức thì, global command mất tới 1 tiếng để lan.
- **permissions.ts** giữ toàn bộ luật quyền: `isAdmin(userId, config)`. Command chỉ
  khai báo `adminOnly: true`; router kiểm tra. Luật quyền ở đúng một chỗ.

| Lệnh | File | Quyền | Gọi vào |
|---|---|---|---|
| `/add name url [interval] [timeout] [latency] [channel]` | `commands/add.ts` | admin | `TargetsRepo.create` |
| `/remove name` | `commands/remove.ts` | admin | `TargetsRepo.remove` |
| `/list` | `commands/list.ts` | mọi người | `TargetsRepo.findAll` |
| `/status [name]` | `commands/status.ts` | mọi người | `TargetsRepo` + `ChecksRepo` |
| `/check name` | `commands/check.ts` | mọi người | `runner.checkTarget`, defer trước vì có thể quá 3s |
| `/pause name [minutes]` | `commands/pause.ts` | admin | `TargetsRepo.setPause` |
| `/resume name` | `commands/pause.ts` | admin | `TargetsRepo.setPause(null)` |
| `/history name` | `commands/history.ts` | mọi người | `IncidentsRepo.listRecent` |
| `/uptime name [24h/7d/30d]` | `commands/uptime.ts` | mọi người | `digest.buildDigest` (dùng lại, không viết logic tính lần hai) |

Validate đầu vào của `/add` (từ chối kèm message rõ ràng, không throw):

- `name`: `^[a-z0-9-]{1,32}$`, phải chưa tồn tại
- `url`: parse được và scheme phải là `http` hoặc `https`
- `interval`: 10–86400 giây · `timeout`: 1000–60000 ms · `latency`: > 0
- `channel`: phải là text channel thuộc `GUILD_ID` và bot có quyền gửi tin

- **Test:** mỗi command test với interaction giả + DB in-memory, assert reply và
  tác động lên DB; `permissions.ts` test riêng. Không test gateway discord.js.

### M7 · shared

`types.ts` (`Target`, `Status`, `Transition`, `AlertMessage`, `CheckOutcome`,
`DigestReport`) · `logger.ts` · `time.ts` (helper timezone VN, tách riêng để test
được mà không đụng `Date.now()` toàn cục).

## 7. Schema SQLite

```sql
CREATE TABLE targets (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  url                   TEXT NOT NULL,
  method                TEXT NOT NULL DEFAULT 'GET',
  expected_status       TEXT NOT NULL DEFAULT '200-299',
  latency_threshold_ms  INTEGER,
  interval_seconds      INTEGER NOT NULL,
  timeout_ms            INTEGER NOT NULL,
  alert_channel_id      TEXT,
  paused_until          TEXT,
  current_status        TEXT NOT NULL DEFAULT 'UNKNOWN',
  last_checked_at       TEXT,
  created_at            TEXT NOT NULL,
  created_by            TEXT NOT NULL
);

CREATE TABLE checks (
  id           INTEGER PRIMARY KEY,
  target_id    INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  checked_at   TEXT NOT NULL,
  status       TEXT NOT NULL,
  http_status  INTEGER,
  latency_ms   INTEGER,
  error        TEXT
);
CREATE INDEX idx_checks_target_time ON checks(target_id, checked_at);

CREATE TABLE incidents (
  id          INTEGER PRIMARY KEY,
  target_id   INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  reason      TEXT
);
CREATE INDEX idx_incidents_target_time ON incidents(target_id, started_at);

CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
```

Quy ước:

- Mọi mốc thời gian lưu dạng **ISO 8601 UTC** dạng chuỗi. Chuyển sang giờ VN chỉ
  khi hiển thị và khi quyết định mốc digest.
- `paused_until` NULL = không pause. Pause vô hạn dùng mốc rất xa (năm 9999).
- `latency_threshold_ms` NULL → dùng `DEFAULT_LATENCY_THRESHOLD_MS`.
- `alert_channel_id` NULL → dùng `DEFAULT_ALERT_CHANNEL_ID`.
- `expected_status` chỉ nhận **một** trong hai dạng: một dải `NNN-NNN` (ví dụ
  `200-299`) hoặc một mã đơn `NNN` (ví dụ `204`). Không hỗ trợ danh sách nhiều
  dải. Giá trị sai định dạng bị từ chối ngay ở `/add`.
- `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`.
- Version schema lưu ở `PRAGMA user_version`.
- `status` nhận một trong: `UP`, `DEGRADED`, `DOWN`, `UNKNOWN`.

Định nghĩa `findDue(now)` — điều kiện lọc nằm trong SQL, không nằm ở scheduler:

```
(last_checked_at IS NULL OR datetime(last_checked_at, '+' || interval_seconds || ' seconds') <= now)
AND (paused_until IS NULL OR paused_until <= now)
```

Kéo theo: target hết hạn pause **tự động được check lại** ở tick kế tiếp, không
cần `/resume`. `/resume` chỉ để bỏ pause sớm hơn dự định.

## 8. Luồng dữ liệu

Một tick (mỗi 10s):

1. `scheduler` lấy target `due && không pause` từ `TargetsRepo.findDue(now)`.
2. Với từng target (tối đa 5 song song), `runner.checkTarget`:
   1. `http-probe.run` → `ProbeResult`
   2. `evaluate` → `Status`
   3. `ChecksRepo.insert` — ghi một dòng log
   4. `state-machine(current_status, status)` → `Transition | null`
   5. Nếu `down`: `IncidentsRepo.open` rồi `Notifier.send` embed đỏ
   6. Nếu `recovered`: `IncidentsRepo.close` rồi `Notifier.send` embed xanh kèm downtime
   7. `TargetsRepo.updateStatus(status, now)`
3. `digest.maybeSendDigest(now)`: nếu giờ VN đã qua 09:00 và `last_digest_date`
   khác ngày hôm nay → dựng report, gửi vào `DIGEST_CHANNEL_ID`, dọn `checks` cũ,
   cập nhật `last_digest_date`.

## 9. Cấu hình (.env)

| Biến | Bắt buộc | Default | Ý nghĩa |
|---|---|---|---|
| `DISCORD_TOKEN` | có | — | Bot token |
| `DISCORD_CLIENT_ID` | có | — | Application ID, dùng khi đăng ký lệnh |
| `GUILD_ID` | có | — | Guild đăng ký slash command |
| `DEFAULT_ALERT_CHANNEL_ID` | có | — | Channel alert mặc định |
| `DIGEST_CHANNEL_ID` | có | — | Channel nhận báo cáo hằng ngày |
| `ADMIN_USER_IDS` | có | — | Danh sách user ID (csv) được dùng lệnh ghi |
| `DB_PATH` | không | `./data/monitor.db` | Đường dẫn file SQLite |
| `DIGEST_HOUR_LOCAL` | không | `9` | Giờ gửi digest theo `Asia/Ho_Chi_Minh` |
| `DEFAULT_INTERVAL_SECONDS` | không | `60` | Chu kỳ check mặc định |
| `DEFAULT_TIMEOUT_MS` | không | `10000` | Timeout mặc định |
| `DEFAULT_LATENCY_THRESHOLD_MS` | không | `2000` | Ngưỡng DEGRADED mặc định |
| `CHECK_RETENTION_DAYS` | không | `30` | Số ngày giữ dòng `checks` |
| `MAX_CONCURRENT_CHECKS` | không | `5` | Số check song song tối đa |
| `TICK_INTERVAL_MS` | không | `10000` | Chu kỳ tick của scheduler |
| `LOG_LEVEL` | không | `info` | Mức log |

`.env` không commit. Kèm `.env.example` đầy đủ khoá, không có giá trị thật.

## 10. Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| Timeout / DNS / TLS lỗi | Kết luận `DOWN`, lưu message vào `checks.error` |
| Gửi Discord thất bại | Log, thử lại 1 lần. DB đã ghi trước nên không mất dữ liệu |
| Bot mất kết nối gateway | discord.js tự reconnect; scheduler vẫn chạy và vẫn ghi DB, alert bị hoãn |
| `unhandledRejection` / `uncaughtException` | Log, không tự kill process |
| Config thiếu hoặc sai | Thoát ngay khi khởi động, message nêu rõ biến nào |
| Target trùng tên khi `/add` | Reply lỗi thân thiện, không throw |
| Lệnh trên target không tồn tại | Reply lỗi thân thiện |
| Một target lỗi trong tick | Không làm hỏng các target còn lại trong cùng tick |

## 11. Chiến lược test (TDD, vitest)

| Loại | Cách test |
|---|---|
| Hàm thuần (`evaluate`, `state-machine`, `embeds`, `buildDigest`, `time`) | Unit test bảng input→output, không I/O |
| Repository | SQLite `:memory:` thật — nhanh, không mock |
| `http-probe` | Server `node:http` local trả 200 / 500 / chậm / treo → test timeout, latency, retry |
| `runner` | Fake probe + fake notifier + DB in-memory; chuỗi UP→DOWN→DOWN→UP bắn đúng 2 alert |
| `scheduler` | Clock giả, kiểm tra chọn đúng target tới hạn và tôn trọng pause |
| Command | Interaction giả + DB in-memory; assert reply và tác động DB |
| Gateway discord.js | Không test |

## 12. Phụ thuộc

Runtime: `discord.js`, `zod`, `dotenv`.
Dev: `typescript`, `tsx`, `vitest`, `@types/node`.
Không native module, không service ngoài, không thư viện cron.

## 13. Đường deploy về sau

Chạy local Windows trước (`npm run dev` bằng tsx). Khi cần deploy: Dockerfile +
`docker-compose.yml` bind-mount `./data:/app/data` cho file SQLite. Trên Fly.io
hoặc Railway phải gắn volume vào `/data` vì filesystem của chúng là ephemeral,
và phải tắt autostop để process không bị suspend.
