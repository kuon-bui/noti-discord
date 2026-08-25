# noti-discord

Daemon theo dõi HTTP/HTTPS endpoint và gửi thông báo vào Discord khi trạng thái đổi.

## Yêu cầu

Node.js >= 25.

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
- URL lưu nguyên vẹn để probe, nhưng mọi URL hiển thị trên Discord đều che
  userinfo, query và hash để tránh lộ token/credential.

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

`npm install`/`npm ci` tự chạy `postinstall` để build ra `dist/`. Migration DB không
cần chạy tay — `main()` trong `src/index.ts` tự backup và `applyMigrations` mỗi lần
process khởi động.

### Wispbyte (hoặc panel Pterodactyl khác)

Không cần Dockerfile — panel chạy app theo egg Node.js có sẵn.

1. Tạo server, chọn egg Node.js. Kiểm tra version egg hỗ trợ có `>=25` không
   (`engines.node` trong `package.json`); nếu panel chưa có Node 25, hạ tạm
   `engines.node` xuống bản panel hỗ trợ rồi chạy lại `npm test`/`typecheck` để
   xác nhận không có gì vỡ trước khi đổi.
2. Đưa code lên bằng file manager/SFTP hoặc git pull qua console — **không copy
   `node_modules` từ Windows**, để panel tự `npm install`/`npm ci` build lại
   `better-sqlite3` đúng glibc của container.
3. Điền toàn bộ biến trong `.env.example` vào tab **Startup/Variables** của panel.
4. Đảm bảo thư mục `data/` (giá trị `DB_PATH`) nằm trong phần lưu trữ persistent
   của server, không bị xoá giữa các lần restart.
5. Startup command: `node dist/index.js` (đã có `dist/` nhờ `postinstall`).
6. Chạy `npm run deploy-commands` một lần qua console panel sau khi đã điền
   `DISCORD_TOKEN`/`DISCORD_CLIENT_ID` để đăng ký slash command — bước này không
   tự động, vì đăng ký lại mỗi lần deploy có thể dư thừa/hit rate limit.

Lưu ý: `postinstall` gọi `npm run build` (`tsc`), cần `typescript` trong
`devDependencies` đã được cài. Nếu egg cấu hình install command với
`--omit=dev`/`NODE_ENV=production`, `postinstall` sẽ fail vì thiếu `tsc` — khi đó
bỏ cờ đó đi hoặc build tay bằng `npm run build` sau khi cài xong.

## Vận hành an toàn

`ADMIN_USER_IDS` là danh sách người tin cậy có thể thêm endpoint. Monitor có thể
kiểm tra endpoint nội bộ, nên môi trường triển khai nên giới hạn outbound network
theo chính sách hạ tầng phù hợp nếu mô hình đe doạ cần bảo vệ trước tài khoản admin
bị chiếm quyền.
