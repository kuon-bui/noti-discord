# noti-discord

Daemon theo dõi HTTP/HTTPS endpoint và gửi thông báo vào Discord khi trạng thái đổi.

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

## Cài đặt

```bash
bun install
cp .env.example .env   # rồi điền giá trị thật
bun run db:generate    # chỉ cần khi đã sửa src/db/schema.ts
bun run db:migrate
bun run deploy-commands
bun run dev
```

## Script

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
- URL lưu nguyên vẹn để probe, nhưng mọi URL hiển thị trên Discord đều che
  userinfo, query và hash để tránh lộ token/credential.

## Đổi schema DB

1. Sửa `src/db/schema.ts`.
2. `bun run db:generate`.
3. **Đọc file SQL sinh ra trong `drizzle/`** rồi commit nó cùng thay đổi schema.
4. `bun run db:migrate`.

Migration là forward-only, không có `down`. App chỉ backup file DB khi phát hiện
có migration mới chưa áp và giữ 1 bản gần nhất để không làm đầy quota lưu trữ.
Không dùng `drizzle-kit push` — nó không để lại file migration nên làm mất lịch sử
schema.

Không còn script `db:studio`: `drizzle-kit` chỉ kết nối SQLite qua `better-sqlite3`
hoặc `@libsql/client`, nó không hỗ trợ `bun:sqlite`, và giữ một native module chỉ để
xem dữ liệu thì không đáng. Khi cần nhìn vào DB, hoặc mở thẳng file `.db` bằng một
SQLite browser bất kỳ, hoặc cài tạm rồi gỡ đi.

```bash
bun add -D better-sqlite3 && bunx drizzle-kit studio
```

## Deploy

Không còn module cần biên dịch native nào, nên không còn ràng buộc về base image, glibc/musl hay
rebuild khi đổi máy. Điều duy nhất còn quan trọng: **mount volume cho thư mục chứa file
SQLite** (`./data`), vì filesystem của Fly.io và Railway là ephemeral. Trên Fly.io nhớ
tắt autostop để process không bị suspend.

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
