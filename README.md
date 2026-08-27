# noti-discord

Daemon theo dõi HTTP/HTTPS endpoint và gửi thông báo vào Discord hoặc Messenger khi trạng thái đổi.

Hỗ trợ hai platform:
- **Discord**: slash commands để quản lý endpoint
- **Messenger**: text commands via Messenger bot, liên kết với Discord account

## Yêu cầu

Bun >= 1.3.

## Dựng bot trên Discord

1. Vào <https://discord.com/developers/applications>, bấm **New Application**.
2. Tab **Bot** → **Reset Token** → copy token, đặt vào `DISCORD_TOKEN`.
3. Tab **General Information** → copy **Application ID**, đặt vào `DISCORD_CLIENT_ID`.
4. Tab **OAuth2 → URL Generator**: chọn scope `bot` và `applications.commands`, quyền
   `Send Messages` và `Embed Links`. Mở URL sinh ra để mời bot vào server.
5. Bật **Developer Mode** trong Discord (Settings → Advanced) để copy được ID của
   server và channel bằng cách bấm chuột phải.

Không cần intent privileged nào. Bot chỉ dùng intent `Guilds`.

## Dựng Messenger bot (tùy chọn)

Để gửi alert qua Messenger, cần:

1. Tạo Facebook Page: <https://www.facebook.com/pages/creation/> (hoặc dùng page sẵn có).
2. Tạo Meta App tại <https://developers.facebook.com/apps>:
   - **Type**: Business (hoặc Consumer nếu không có business account).
   - **Add Products** → **Messenger** → **Set Up** → **Generate Tokens**.
3. Vào tab **Messenger** → **Settings**:
   - **Access Tokens**: generate token cho page, đặt vào `MESSENGER_PAGE_ACCESS_TOKEN`.
   - **App Roles** → **Test Users**: thêm tài khoản Messenger để test.
4. Vào **Messenger** → **Configuration**:
   - **Callback URL**: `https://your-domain.com/webhook/messenger` (URL deploy của bạn).
   - **Verify Token**: sinh chuỗi ngẫu nhiên, đặt vào `MESSENGER_VERIFY_TOKEN`.
   - **Subscriptions**: tích `messages`, `message_echoes`.
5. Vào tab **Settings** → **Basic**:
   - Copy **App Secret**, đặt vào `MESSENGER_APP_SECRET`.
6. Set `MESSENGER_ENABLED=true` trong `.env`.

**Lưu ý:**
- Webhook phải qua HTTPS công khai (Meta không chấp http://localhost).
- App cần `pages_manage_messaging`, `pages_read_user_profile` permission.
- Để nhắn tin cho non-admin user, App phải được phê duyệt — trong khi phát triển, chỉ test user nào được.

## Cài đặt

```bash
bun install
cp .env.example .env   # rồi điền giá trị thật
bun run db:generate    # chỉ cần khi đã sửa src/db/schema.ts
bun run db:migrate
bun run deploy-commands
bun run dev
```

## Biến cấu hình

### Bắt buộc

- `DISCORD_TOKEN` — Token Discord bot.
- `DISCORD_CLIENT_ID` — Application ID.
- `GUILD_ID` — Server ID để đăng ký slash command.
- `DEFAULT_ALERT_CHANNEL_ID` — Channel mặc định cho alert.
- `DIGEST_CHANNEL_ID` — Channel cho digest hằng ngày.
- `ADMIN_USER_IDS` — Comma-separated user IDs (ví dụ: `123,456,789`).

### Tùy chọn

- `DB_PATH` — Đường dẫn file SQLite, mặc định `./data/monitor.db`.
- `DIGEST_HOUR_LOCAL` — Giờ Việt Nam gửi digest (0-23), mặc định `9`.
- `DEFAULT_INTERVAL_SECONDS` — Chu kỳ check mặc định, mặc định `60`.
- `DEFAULT_TIMEOUT_MS` — Timeout mặc định, mặc định `10000`.
- `DEFAULT_LATENCY_THRESHOLD_MS` — Ngưỡng latency DEGRADED, mặc định `2000`.
- `CHECK_RETENTION_DAYS` — Giữ lịch sử check (ngày), mặc định `30`.
- `LOG_LEVEL` — `debug|info|warn|error`, mặc định `info`.

### Messenger (nếu `MESSENGER_ENABLED=true`)

- `MESSENGER_ENABLED` — `true` hoặc `false`, mặc định `false`.
- `MESSENGER_PAGE_ACCESS_TOKEN` — Token truy cập page (bắt buộc nếu enabled).
- `MESSENGER_APP_SECRET` — App Secret (bắt buộc nếu enabled).
- `MESSENGER_VERIFY_TOKEN` — Verify token webhook (bắt buộc nếu enabled).
- `MESSENGER_PORT` — Cổng HTTP server webhook, mặc định `8080`.
- `MESSENGER_WEBHOOK_PATH` — Path webhook, mặc định `/webhook/messenger`.
- `MESSENGER_API_VERSION` — Meta API version, mặc định `v21.0`.
- `MESSENGER_OUTBOX_MAX_AGE_HOURS` — Max age alert trước khi bỏ, mặc định `48`.

## Script

| Lệnh | Việc |
|---|---|
| `bun run dev` | Chạy ở chế độ dev, tự reload |
| `bun start` | Chạy thẳng mã nguồn, không cần build |
| `bun test` | Chạy toàn bộ test |
| `bun run typecheck` | Kiểm tra kiểu, không xuất file |
| `bun run db:generate` | Sinh migration sau khi sửa `schema.ts` |
| `bun run db:data <tên>` | Sinh migration rỗng để tự viết SQL đổi dữ liệu |
| `bun run db:migrate` | Áp migration vào DB |
| `bun run db:drift` | Chặn `schema.ts` lệch với `drizzle/` |
| `bun run db:studio` | Mở Drizzle Studio để xem/sửa dữ liệu |
| `bun run deploy-commands` | Đăng ký slash command vào guild |

## Discord Slash command

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
| `/messenger-link` | admin | Sinh mã 8 ký tự để liên kết Messenger với Discord |
| `/messenger-unlink` | mọi người | Huỷ liên kết Messenger của bạn |

Admin chỉ là user ID có trong `ADMIN_USER_IDS`.

## Messenger Text command

Messenger chỉ hỗ trợ text command, ngôn ngữ như Discord nhưng không có `/`. Format:

```
/[command] [arg1] [arg2] ...
```

Ví dụ: `/add myapi https://api.example.com` hoặc `add myapi https://api.example.com`.

**Liên kết đầu tiên:**
1. User Discord nhắn `/messenger-link` để sinh mã (ví dụ `A1B2C3D4`).
2. User nhắn tin đó vào Messenger bot.
3. Bot liên kết PSID Messenger ↔ Discord ID, cấp quyền admin nếu Discord ID nằm trong `ADMIN_USER_IDS`.
4. User bây giờ có thể dùng mọi command.

**Command từ Messenger:**
- Giống với Discord: `/status`, `/add ...`, `/list`, v.v.
- Nếu là admin trên Discord → là admin trên Messenger (cho Messenger admin check).
- Kết quả trả về dạng text, tự động cắt thành messages nếu >2000 ký tự.

**Huỷ liên kết:**
- User nhắn `/messenger-unlink` để xoá link và ngừng nhận alert.

## Hành vi

### Chung

- Alert chỉ bắn khi trạng thái đổi giữa UP và DOWN. Trạng thái DEGRADED (còn trả
  status đúng nhưng chậm hơn ngưỡng latency) chỉ được ghi vào DB, không bắn alert.
- Báo cáo tổng hợp gửi mỗi ngày lúc `DIGEST_HOUR_LOCAL` giờ Việt Nam vào
  `DIGEST_CHANNEL_ID`. Nếu process khởi động muộn hơn mốc đó mà hôm nay chưa gửi
  thì nó gửi bù.
- Endpoint hết hạn pause tự động được check lại, không cần `/resume`.
- URL lưu nguyên vẹn để probe, nhưng mọi URL hiển thị trên Discord/Messenger đều che
  userinfo, query và hash để tránh lộ token/credential.

### Discord

- Mỗi endpoint có thể có channel alert riêng; không khai báo thì dùng
  `DEFAULT_ALERT_CHANNEL_ID`.

### Messenger

- Alert gửi qua Messenger có **hạn thời gian 24 giờ** (hạn chế của Meta). Bot gửi bằng cách tích lũy
  trong outbox rồi flush định kỳ.
- Nếu alert cũ hơn 23 giờ mà chưa gửi được → bỏ qua, không thử gửi (tránh error từ Meta).
- User liên kết với Messenger nhận alert tới Messenger của mình (`destination` kiểu global).
- Mỗi PSID là một người dùng riêng biệt, có thể liên kết với user Discord khác nhau.
- Nếu PSID chưa liên kết → sẽ được hướng dẫn gửi `/messenger-link` code.
- Tin nhắn echo (do Page gửi, không phải user gửi) bị bỏ qua để tránh loop.

## Đổi schema DB

1. Sửa `src/db/schema.ts`.
2. `bun run db:generate`.
3. **Đọc file SQL sinh ra trong `drizzle/`** rồi commit nó cùng thay đổi schema.
4. `bun run db:migrate`.

Migration là forward-only, không có `down`. App chỉ backup file DB khi phát hiện
có migration mới chưa áp và giữ 1 bản gần nhất để không làm đầy quota lưu trữ.
Không dùng `drizzle-kit push` — nó không để lại file migration nên làm mất lịch sử
schema.

## Migrate dữ liệu

`drizzle-kit` chỉ sinh được DDL từ `schema.ts`. Khi cần đổi chính dữ liệu (backfill
cột mới, chuẩn hoá giá trị, sửa hàng đã lỗi), tạo một migration rỗng rồi tự viết SQL:

1. `bun run db:data ten_viec` — sinh file `drizzle/NNNN_ten_viec.sql` rỗng.
2. Viết DML vào đó (`UPDATE`/`INSERT`/`DELETE`), nhiều câu thì phân tách bằng
   `--> statement-breakpoint`.
3. `bun run db:migrate`.

Migration dữ liệu đi cùng đường ray với migration schema: cùng thứ tự, cùng bảng ghi
nhận `__drizzle_migrations`, nên mỗi file chỉ chạy đúng một lần và tự chạy khi process
khởi động. Nó cũng không làm `db:drift` đỏ, vì snapshot schema không đổi.

## Xem dữ liệu

`bun run db:studio` mở Drizzle Studio trên đúng file DB trong `DB_PATH`.

Lưu ý duy nhất: **đừng ép drizzle-kit chạy bằng Bun.** Mọi lệnh drizzle-kit cần mở file
SQLite (`studio`, `migrate`, `push`, `introspect`) đều đi qua `better-sqlite3` — native
module dùng NAPI — và `bunx --bun drizzle-kit ...` làm Bun panic. Không truyền `--bun`
thì `bunx` giao cho Node theo shebang và mọi thứ chạy bình thường.

Không phải cài thêm gì: `better-sqlite3` đã là `optionalDependencies` của `drizzle-orm`,
kèm prebuilt cho linux/linuxmusl/darwin/win32 (cả x64 và arm64), nên vẫn không có bước
biên dịch native nào. Nó chỉ được dùng bởi tool drizzle-kit lúc phát triển; app chạy
bằng `bun:sqlite` như trước.

## Kiến trúc multi-platform

### Luồng chung

1. **Monitor**: runner chạy probe mỗi chu kỳ, cập nhật status, phát alert khi trạng thái đổi.
2. **Dispatcher**: nhận alert từ runner, route tới notifiers (Discord, Messenger).
3. **Routing**: quyết định alert gửi tới đâu dựa trên **destination** của endpoint.
4. **Discord Notifier**: nhận alert, định dạng embed, gửi qua Discord channel API.
5. **Messenger Flusher**: tích lũy alert vào outbox, flush định kỳ qua Messenger Send API.

### Phân giải destination

Mỗi endpoint có một danh sách **destination** — các nơi nhận alert. Destination có hai loại:

- **Channel-specific** (Discord): `provider=discord`, `address=<channel-id>`.
- **Global** (Messenger): `provider=messenger`, `address=<psid>`, `targetId=null`.

Routing chọn destination dựa trên provider + quy tắc fallback:
1. Nếu endpoint có destination riêng → dùng cái đó.
2. Nếu không → dùng default destination (channel mặc định Discord, hoặc global cho Messenger).

### Database

Một cơ sở dữ liệu SQLite chứa:
- **targets**: endpoint cần monitor.
- **checks**: lịch sử kết quả check.
- **incidents**: sự cố (khoảng thời gian trạng thái ≠ UP).
- **destinations**: nơi gửi alert.
- **outbox**: tích lũy alert chưa gửi Messenger (Meta limit 24h).
- **messenger_identities**: ánh xạ PSID ↔ Discord ID + quyền admin.
- **messenger_link_codes**: mã liên kết tạm thời (hiệu lực 10 phút).
- **messenger_seen_mids**: dedup Messenger (mỗi message ID xử lý một lần).

### Router

Hai router độc lập:
- **Discord Router**: xử lý slash command từ Discord, isAdmin = Discord ID trong `ADMIN_USER_IDS`.
- **Messenger Router**: xử lý text command từ Messenger, isAdmin = PSID linked với admin Discord ID.

Cả hai dùng chung `allCommands()` nhưng cách kiểm soát quyền khác nhau.

## Deploy

Không còn module cần biên dịch native nào, nên không còn ràng buộc về base image, glibc/musl hay
rebuild khi đổi máy. Điều duy nhất còn quan trọng: **mount volume cho thư mục chứa file
SQLite** (`./data`), vì filesystem của Fly.io và Railway là ephemeral. Trên Fly.io nhớ
tắt autostop để process không bị suspend.

**Nếu bật Messenger**, cần thêm:
- **HTTPS công khai** cho webhook (`MESSENGER_WEBHOOK_PATH`).
- **Port mở** (mặc định `8080`) để app có thể nhận request từ Meta.
- **Thêm port vào firewall** nếu có (ví dụ Fly.io cần `fly open` hoặc expose port trong config).

Không có bước build. `bun src/index.ts` chạy thẳng mã nguồn. Migration DB không cần chạy
tay — `main()` trong `src/index.ts` tự backup khi cần và chạy `applyMigrations` mỗi lần
process khởi động. Lịch sử check hết hạn cũng được dọn ngay khi khởi động và trước mỗi
digest, kể cả khi gửi Discord thất bại.

### Wispbyte (hoặc panel Pterodactyl khác)

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

## Vận hành an toàn

`ADMIN_USER_IDS` là danh sách người tin cậy có thể thêm endpoint. Monitor có thể
kiểm tra endpoint nội bộ, nên môi trường triển khai nên giới hạn outbound network
theo chính sách hạ tầng phù hợp nếu mô hình đe doạ cần bảo vệ trước tài khoản admin
bị chiếm quyền.
