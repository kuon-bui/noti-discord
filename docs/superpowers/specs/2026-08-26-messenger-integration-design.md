# Tích hợp Facebook Messenger làm kênh thông báo thứ hai

Ngày: 2026-08-26

## Mục tiêu

Tách tầng thông báo của noti-discord thành kiến trúc đa provider, rồi thêm Facebook
Messenger làm provider thứ hai bên cạnh Discord. Messenger nhận được cả alert lẫn
toàn bộ slash command hiện có (kể cả lệnh admin) qua tin nhắn text. Discord giữ
nguyên vai trò kênh chính và hành vi hiện tại không đổi một ly.

Kết quả mong đợi: thêm provider thứ ba sau này (Telegram, Zalo, email, webhook) chỉ
là thêm một file implement `Notifier`, không phải đổi schema và không phải sửa file
lệnh nào.

## Quyết định đã chốt

| Trục | Chọn | Lý do |
|---|---|---|
| Nền tảng | Facebook Messenger | Người dùng chọn, biết trước ràng buộc 24h |
| Chiến lược | Refactor multi-provider trước, Messenger là provider best-effort | Discord vẫn là kênh đảm bảo; Messenger không được phép làm hỏng nó |
| Phạm vi inbound | Toàn bộ lệnh, kể cả admin | Người dùng chọn sau khi đã được nêu rõ rủi ro bảo mật |
| Định tuyến | Bảng `destinations` đa hình, bỏ `targets.alert_channel_id` | Đúng về mô hình; thêm provider sau không đổi schema |
| Bootstrap admin Messenger | Link code phát từ Discord | PSID là opaque, không biết trước; đường env buộc phải restart (xem "Phát hiện") |
| HTTP server | Elysia | `app.handle()` test được không cần bind port; `parse: 'none'` giữ được raw body |
| TLS | Do reverse proxy bên ngoài lo | Người dùng có domain trỏ về port; app chỉ serve HTTP trần |
| Alert ngoài cửa sổ 24h | Chặn trước khi gọi API, đẩy vào outbox, gộp khi flush | Gọi API vi phạm liên tục dẫn tới Page bị hạn chế |
| Mặc định | `MESSENGER_ENABLED=false` | Clone về là chạy; không bật thì app y hệt hôm nay |

## Phát hiện chi phối thiết kế

### 1. Messenger không có đường hợp lệ nào để push alert vào thời điểm bất kỳ

Xác minh từ docs chính thức của Meta:

- Cửa sổ nhắn tin chuẩn là **24 giờ** kể từ tin nhắn cuối cùng user gửi cho Page.
- **Từ 27/04/2026**, ba tag từng dùng đúng cho việc này đã bị bỏ. Nguyên văn:
  *"Effective April 27th, 2026, all API requests containing the Message Tags
  CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE, and POST_PURCHASE_UPDATE will receive
  error code 100."*
- **Recurring Notifications** bị tắt toàn cầu từ 10/02/2026, trừ AU/EU/JP/KR/UK.
  Việt Nam không nằm trong danh sách.
- Còn lại chỉ `HUMAN_AGENT` (7 ngày), nhưng docs ghi rõ tag này dành cho **người thật**
  soạn tin trả lời thủ công. Dùng cho alert tự động là vi phạm policy và có thể bị
  hạn chế Page.
- Messenger API chỉ gửi được hội thoại **1:1 user↔Page**, không gửi được vào group
  chat. Khái niệm "channel dùng chung cho cả team" của Discord không có bản đối ứng —
  nó thành fan-out tới N người.

Hệ quả trực tiếp lên thiết kế: Messenger **không thể** là kênh alert duy nhất. Đây là
giới hạn nền tảng, không phải bug sẽ sửa được. Toàn bộ mục "Chính sách cửa sổ 24h"
bên dưới tồn tại vì phát hiện này.

### 2. `InteractionLike` đã là structural type, không dính discord.js

`src/bot/types.ts:23-34` khai `InteractionLike` thuần structural, không import gì từ
`discord.js`. Kiểm tra thực tế toàn bộ 9 command handler: chúng chỉ dùng
`commandName`, `user.id`, `options.getString/getInteger/getChannel`, và
`reply/followUp/deferReply/editReply`.

Chỉ duy nhất `src/bot/commands/check.ts:34` chạm tới `embeds`.

Hệ quả: một adapter Messenger implement đúng `InteractionLike` **tái dùng được cả 9
lệnh mà không sửa file lệnh nào**. Đây là lý do "toàn bộ lệnh kể cả admin" không đắt
như nó nghe.

### 3. `SlashCommandBuilder.toJSON()` đã chứa sẵn schema option

`Command.data` có `toJSON()` trả về `{ name, description, options: [{ type, name,
required }] }` với type 3 = STRING, 4 = INTEGER, 7 = CHANNEL. Parser text cho Messenger
đọc chính nó làm schema, nên không phải khai báo đối số lần thứ hai và không thể lệch
khỏi định nghĩa Discord.

### 4. `digestMessage` nhồi sẵn bảng đã pad cột vào `description`

`src/notify/messages.ts` dựng digest bằng `padEnd`/`padStart` rồi bọc trong ` ``` `
và gán vào `description`. Messenger không có font monospace, nên bảng đó sẽ vỡ hoàn
toàn khi render sang text.

Đây là khiếm khuyết đang chặn đường: `AlertMessage` được quảng cáo là trung tính giữa
các provider, nhưng riêng digest đã bị format cứng theo Discord. Phải sửa.

### 5. Body của Web Standard `Request` chỉ đọc được một lần

Meta ký payload bằng `X-Hub-Signature-256` = HMAC-SHA256 trên **raw bytes**. Elysia
auto-parse JSON theo `content-type`, nên nếu để nó parse thì mất raw body và HMAC
không còn tính được. Docs Elysia có `parse: 'none'` đúng cho tình huống này, kèm cảnh
báo lỗi *"Body is already used"*.

### 6. `router.ts` phân quyền bằng danh sách Discord id

`src/bot/router.ts:44` gọi `isAdmin(interaction.user.id, deps.config)` với
`config.adminUserIds`. PSID Messenger nằm ở không gian định danh khác, nên không thể
dùng chung danh sách này.

## Phạm vi thay đổi

### 1. Tầng outbound: `Notifier` → `Dispatcher`

`src/notify/notifier.ts` hiện là `send(msg: AlertMessage, channelId: string)` —
`channelId` giả định Discord ngay trong tên tham số. Hình dạng mới:

```ts
export type ProviderName = 'discord' | 'messenger'
export type Destination = { provider: ProviderName; address: string }

export type Notifier = {
  readonly provider: ProviderName
  send(msg: AlertMessage, address: string): Promise<void>
}

export type Dispatcher = {
  dispatch(msg: AlertMessage, dests: readonly Destination[]): Promise<void>
}
```

`makeDispatcher({ notifiers, logger })` map provider→notifier và gửi song song. Bắt
buộc: **mỗi destination lỗi độc lập**. Một provider chết không được chặn provider
khác — nếu Messenger hết cửa sổ thì alert Discord vẫn phải tới. Destination có
provider không đăng ký thì log `warn` và bỏ qua, không throw.

`makeDiscordNotifier` giữ nguyên logic (kể cả retry-một-lần), chỉ thêm
`provider: 'discord'`.

`src/monitor/runner.ts` và `src/digest/schedule.ts` đổi dep `notifier: Notifier` sang
`dispatcher: Dispatcher`. Runner đổi `channelOf(target)` sang `destinationsFor(target)`.
`notifySafe` trong runner giữ nguyên vai trò — dispatcher không throw, nhưng lớp
try/catch ở runner vẫn là chốt cuối.

Digest là trường hợp riêng: nó không thuộc target nào, hiện gửi thẳng vào
`config.digestChannelId`. Nó dùng một quy tắc riêng `digestDestinations()`:

- Luôn có `('discord', DIGEST_CHANNEL_ID)` — giữ đúng hành vi hiện tại, và không bị
  destination Discord global ghi đè.
- Cộng thêm `('messenger', psid)` cho **mọi `messenger_identities` có `is_admin = 1`**.

Lưu ý định tuyến digest của Messenger là **identity-driven, không destination-driven** —
đây là cố ý, không phải lệch khỏi mô hình. Digest là báo cáo vận hành, nên vị ngữ đúng
để lọc là "có quyền admin", không phải "đã đăng ký nhận alert". Hai thứ đó trùng nhau
hôm nay nhưng không phải một.

Điều kiện `is_admin = 1` phải viết tường minh dù hôm nay nó luôn đúng: `/messenger-link`
là lệnh admin-only nên link code luôn mang Discord id của một admin, khiến mọi PSID đã
link đều là admin. Nếu dựa vào tính chất tình cờ đó thay vì lọc thật, thì ngày nào thêm
đường link cho người không phải admin (kiểu subscriber chỉ đọc), digest — vốn là bản
kiểm kê toàn bộ endpoint — sẽ âm thầm lọt sang họ.

### 2. Tầng render: `AlertMessage` nhận `table`

Thêm một field tuỳ chọn:

```ts
export type AlertMessage = {
  // ...giữ nguyên các field hiện có
  table?: { rows: string[][] }
}
```

`digestMessage` trả `table` có cấu trúc thay vì nhồi chuỗi đã pad vào `description`.
Việc pad cột chuyển vào `toEmbed`, và **hiển thị trên Discord phải giữ nguyên từng
ký tự** so với hiện tại.

Thêm `src/notify/messenger-text.ts` với `toMessengerText(msg: AlertMessage): string[]`:

- Render `table` thành từng dòng `icon name — uptime — latency — N sự cố`, không pad.
- Strip markdown Discord. Hiện `list.ts`, `status.ts`, `history.ts`, `uptime.ts` phát
  `**bold**` và `` `code` ``; Messenger hiện chúng thành ký tự literal.
- Tự cắt theo hạn **2000 ký tự** của Messenger, trả mảng nhiều tin nếu cần — cùng vai
  trò với việc `toEmbed` quản budget 6000 của embed.

### 3. Schema DB

Bốn bảng mới, một cột bị bỏ.

```
destinations                        -- thay targets.alert_channel_id
  id          INTEGER PK
  target_id   INTEGER NULL REFERENCES targets(id) ON DELETE CASCADE
  provider    TEXT NOT NULL         -- 'discord' | 'messenger'
  address     TEXT NOT NULL         -- channel id | PSID
  created_at  TEXT NOT NULL

messenger_identities
  psid            TEXT PK
  discord_user_id TEXT              -- ai đã link, NULL nếu chưa
  is_admin        INTEGER NOT NULL DEFAULT 0
  last_inbound_at TEXT              -- mốc tính cửa sổ 24h
  linked_at       TEXT

messenger_link_codes
  code            TEXT PK
  discord_user_id TEXT NOT NULL
  expires_at      TEXT NOT NULL
  used_at         TEXT

messenger_seen_mids                 -- idempotency cho webhook
  mid        TEXT PK
  seen_at    TEXT NOT NULL

outbox                              -- alert bị chặn vì hết cửa sổ
  id          INTEGER PK
  provider    TEXT NOT NULL
  address     TEXT NOT NULL
  payload     TEXT NOT NULL         -- AlertMessage dạng JSON
  created_at  TEXT NOT NULL
  attempts    INTEGER NOT NULL DEFAULT 0
  last_error  TEXT
```

Index: `destinations(target_id, provider)`, `outbox(provider, address, created_at)`,
`messenger_seen_mids(seen_at)` để dọn theo tuổi.

`target_id = NULL` nghĩa là destination mặc định cho mọi target. Lưu ý SQLite coi các
`NULL` là **khác nhau** trong UNIQUE constraint, nên `UNIQUE(target_id, provider,
address)` sẽ không chống trùng được các row global. Dùng unique index trên biểu thức
`ifnull(target_id, -1)` cùng `provider`, `address`; repo cũng chống trùng một lần nữa
ở tầng code.

### 4. Quy tắc phân giải destination

Đây là chỗ dễ làm sai nhất, nên viết rõ:

1. Lấy mọi row có `target_id = target.id`.
2. Với **từng provider không có row riêng cho target đó**, lấy row `target_id IS NULL`
   của chính provider ấy.
3. Nếu kết quả rỗng hoàn toàn → fallback `DEFAULT_ALERT_CHANNEL_ID` (Discord).

Hệ quả cần thiết: `/add ... channel=#ops` override channel Discord của một target
**không làm im Messenger**. Fallback theo từng provider, không phải fallback toàn bộ.

### 5. Migrate dữ liệu

Theo đúng đường ray README (`bun run db:data`, forward-only, không có `down`):

1. Tạo bảng mới bằng `bun run db:generate` sau khi sửa `schema.ts`.
2. Một migration dữ liệu backfill mọi `targets.alert_channel_id` non-null thành row
   `('discord', <channel id>)` gắn `target_id` tương ứng.
3. Drop cột `targets.alert_channel_id` (drizzle-kit sinh table rebuild 12 bước của
   SQLite).

`DEFAULT_ALERT_CHANNEL_ID` là biến env nên không backfill được bằng SQL. Nó ở lại làm
fallback trong code như mục 4.

### 6. Tầng inbound: adapter Messenger cho `InteractionLike`

`src/messenger/interaction.ts` — `makeMessengerInteraction()` implement
`InteractionLike`. Năm chỗ lệch và cách xử lý:

| Chỗ lệch | Xử lý |
|---|---|
| Parse text thành options | Đọc `command.data.toJSON().options` làm schema (Phát hiện 3) |
| `embeds` (chỉ `check.ts`) | Render qua `toMessengerText` |
| `EPHEMERAL` = 64 | Bỏ qua — Messenger không có khái niệm tin nhắn riêng tư |
| `getChannel` | Luôn trả `null`. `/add` từ Messenger dùng destination mặc định |
| `deferReply` | Gửi `sender_action: typing_on`; `editReply` gửi tin thật |

`src/messenger/parse-command.ts` — cú pháp: tên lệnh, rồi positional theo đúng thứ tự
khai báo trong builder, cộng dạng `key=value` cho phần tuỳ chọn. Prefix `/` cho phép
chứ không bắt buộc.

```
status                      add api https://x.dev interval=30
uptime api 7d               pause api 60
```

Type 3 → `getString`, type 4 → `getInteger`, type 7 → luôn `null`. Integer parse thất
bại phải **báo lỗi rõ ràng**, không im lặng thành `null` — nếu không thì `pause api
abc` sẽ thành pause vô thời hạn. Lệnh không nhận ra → trả danh sách lệnh khả dụng
**theo quyền của người gửi**.

### 7. Phân quyền và flow liên kết

`RouterDeps` đổi `config: Pick<AppConfig, 'adminUserIds'>` thành
`isAdmin: (userId: string) => boolean`. `src/index.ts` tạo **hai router instance**:
Discord dùng `ADMIN_USER_IDS`, Messenger tra `messenger_identities.is_admin`. Hai
instance cũng tách map `runningCommandsByUser`, nên PSID không thể trùng Discord id.

Flow liên kết:

1. Admin chạy `/messenger-link` trên Discord → bot trả (ephemeral) code 8 ký tự, hết
   hạn 10 phút, sinh bằng `crypto.randomBytes`.
2. Admin nhắn code đó cho Page.
3. Webhook khớp code chưa dùng và chưa hết hạn → tạo `messenger_identities` với
   `discord_user_id`, `is_admin` = (Discord id đó có trong `ADMIN_USER_IDS`), đánh dấu
   `used_at`, và tự thêm destination global `('messenger', psid)`.
4. Bot trả lời trên Messenger: đã liên kết, kèm danh sách lệnh.

Lý do không dùng env `MESSENGER_ADMIN_PSIDS`: PSID là opaque và page-scoped, không biết
trước được, nên đường env buộc phải *nhắn → đọc log lấy PSID → sửa env → restart*. Link
code bỏ cả ba bước và neo quyền admin Messenger vào một danh tính Discord đã xác thực,
thay vì một danh sách thứ hai phải tự tay giữ đồng bộ.

### 8. Lệnh Discord mới

| Lệnh | Quyền | Việc |
|---|---|---|
| `/dest list [name]` | mọi người | Xem destination của một target hoặc toàn cục |
| `/dest add provider address [name]` | admin | Thêm destination |
| `/dest remove provider address [name]` | admin | Bỏ destination |
| `/messenger-link` | admin | Phát link code |
| `/messenger-unlink psid` | admin | Bỏ liên kết và destination của PSID đó |

`/add` giữ nguyên option `channel` — nó chỉ ghi vào `destinations` thay vì cột cũ, nên
UX không đổi.

### 9. HTTP server bằng Elysia

`src/web/server.ts` dựng app; `src/web/messenger-webhook.ts` là plugin
`new Elysia({ name: 'messenger-webhook' })` nhận deps qua closure. App gốc `.use()` nó.

| Route | Hành vi |
|---|---|
| `GET {WEBHOOK_PATH}` | `hub.mode === 'subscribe'` và `hub.verify_token` khớp → trả `hub.challenge` dạng text. Sai → 403. Query khai bằng `t.Object` để Elysia tự trả 400 khi thiếu field |
| `POST {WEBHOOK_PATH}` | Verify HMAC → xử lý async → trả 200 ngay |
| `GET /healthz` | 200, cho reverse proxy probe |

```ts
.post(WEBHOOK_PATH, async ({ request, headers, status }) => {
  const raw = new Uint8Array(await request.arrayBuffer())   // đọc đúng một lần
  if (!verifySignature(raw, headers['x-hub-signature-256'], appSecret)) return status(401)
  const event = JSON.parse(new TextDecoder().decode(raw))
  void handleEvent(event).catch((e) => logger.error('Xử lý webhook thất bại', e))
  return 'EVENT_RECEIVED'
}, { parse: 'none' })
```

`parse: 'none'` là bắt buộc, không phải tối ưu (Phát hiện 5). HMAC phải tính trên byte
gốc, so sánh **timing-safe** bằng `crypto.timingSafeEqual`, và sai signature thì trả
401 mà **không parse** payload.

Trả 200 trước khi xử lý cũng là bắt buộc: Meta timeout khoảng 20 giây và sẽ vô hiệu hoá
webhook nếu chậm liên tục, trong khi một lệnh `check` có thể mất lâu hơn thế.

`new Elysia({ serve: { hostname: '0.0.0.0' } }).listen(MESSENGER_PORT)`. Khối
`shutdown()` đang có trong `src/index.ts` thêm bước dừng server — chữ ký chính xác của
`app.stop()` sẽ verify lúc implement, docs tra được chưa nói rõ.

Khi `MESSENGER_ENABLED=false`: **không dựng app, không mở port**. App chạy y hệt hôm nay.

### 10. Xử lý event webhook

Bốn chốt bắt buộc, mỗi cái tương ứng một lỗi thật nếu bỏ:

1. Chỉ nhận `object === 'page'`, lặp `entry[].messaging[]`.
2. **Bỏ `message.is_echo`.** Tin do chính Page gửi cũng vào webhook; không bỏ thì bot
   tự trả lời chính nó thành vòng lặp.
3. **Dedupe theo `message.mid`** qua `messenger_seen_mids`. Meta retry khi không nhận
   được 200 kịp; không dedupe thì một lệnh `add` chạy hai lần. Dọn row cũ hơn 24 giờ
   cùng lúc dọn `checks`.
4. Mọi event → cập nhật `last_inbound_at`. Đây chính là lúc cửa sổ 24h mở lại, nên nó
   kéo theo flush outbox cho PSID đó.

Rồi phân nhánh: text khớp link code → flow liên kết. PSID chưa có identity → trả hướng
dẫn link và **không chạy lệnh**. Còn lại → dựng `InteractionLike` đưa vào Messenger
router.

### 11. Chính sách cửa sổ 24h

Tách hai lớp cho rõ trách nhiệm:

- `src/notify/messenger-client.ts` — chỉ HTTP + Send API + `sender_action`.
- `src/notify/messenger-notifier.ts` — implement `Notifier`, chứa logic cửa sổ và
  outbox.

Adapter interaction gọi **client trực tiếp**, không qua outbox: user vừa nhắn nên cửa
sổ chắc chắn mở, reply cho lệnh không bao giờ cần hoãn. Chỉ alert và digest mới có thể
vào outbox.

Quy tắc gửi alert tới một PSID:

1. Nếu `now - last_inbound_at > 23h` (biên an toàn 1 giờ) → **không gọi Send API**, đẩy
   vào `outbox`, log `warn`. Chủ động chặn thay vì để Meta từ chối, vì gọi API vi phạm
   liên tục là đường dẫn tới việc Page bị hạn chế.
2. Nếu vẫn lọt và Meta trả lỗi cửa sổ → cũng đẩy vào `outbox`, ghi `last_error`.

Quy tắc flush khi cửa sổ mở lại:

1. Bỏ entry cũ hơn `MESSENGER_OUTBOX_MAX_AGE_HOURS` (mặc định 48).
2. Còn ≤ 3 entry → gửi từng cái theo thứ tự `created_at`.
3. Nhiều hơn 3 → gửi **một** tin gộp: "đã bỏ lỡ N thông báo" kèm **trạng thái hiện tại**
   của các target liên quan, rồi xoá hết.

Lý do gộp: dội lại 40 alert của hai ngày trước vừa spam vừa khiến người đọc tưởng hệ
thống đang DOWN trong khi nó đã hồi phục từ lâu. Trạng thái hiện tại là thông tin đúng;
lịch sử alert đã hết hạn sử dụng.

### 12. Config

```
MESSENGER_ENABLED=false
MESSENGER_PAGE_ACCESS_TOKEN=
MESSENGER_APP_SECRET=
MESSENGER_VERIFY_TOKEN=
MESSENGER_PORT=8080
MESSENGER_WEBHOOK_PATH=/webhook/messenger
MESSENGER_API_VERSION=v21.0
MESSENGER_OUTBOX_MAX_AGE_HOURS=48
```

Zod dùng `refine`: chỉ khi `MESSENGER_ENABLED=true` mới bắt buộc ba secret. Giữ được
tính chất "clone về là chạy" và giữ `tests/config.test.ts` xanh.

Trong `AppConfig` gom thành `messenger: MessengerConfig | null` thay vì rải 8 field
phẳng — `Pick<AppConfig, 'messenger'>` vẫn hoạt động cho các dep hiện có.

### 13. package.json

Thêm `elysia` vào `dependencies`. Đây là dependency runtime thứ tư của dự án; nó được
chọn thay `Bun.serve` vì `app.handle(new Request(...))` cho phép test webhook
in-process không cần bind port, và `parse: 'none'` giữ được raw body.

### 14. README

Thêm mục dựng Facebook App và Page: tạo app, lấy Page Access Token, App Secret, đặt
Verify Token, subscribe field `messages` và `messaging_postbacks`, trỏ domain về
`MESSENGER_PORT` qua reverse proxy có TLS.

Ghi rõ **ràng buộc 24h kèm lý do** trong mục "Hành vi", để sáu tháng sau không ai tưởng
đó là bug. Bổ sung bảng slash command với 5 lệnh mới ở mục 8, và bảng cú pháp lệnh text
của Messenger.

## Thứ tự triển khai

Mục 1–5 (dispatcher, `AlertMessage.table`, schema, phân giải destination, migrate dữ
liệu) **không phụ thuộc gì vào Messenger** và tự nó là một lát cắt chạy được: sau khi
xong, app vẫn chỉ có Discord nhưng đã đứng trên kiến trúc đa provider, và toàn bộ test
hiện có phải xanh với hành vi Discord không đổi một ly.

Làm và verify lát cắt đó trước khi viết dòng code Messenger nào. Nếu refactor làm hỏng
Discord thì phải phát hiện lúc chưa có biến số Messenger nào trong ảnh, chứ không phải
lúc đang debug HMAC.

Mục 6–14 là lát cắt Messenger, dựng sau và bật bằng `MESSENGER_ENABLED`.

## Xác minh

1. `bun run typecheck` — không lỗi
2. `bun test` — toàn bộ file xanh, gồm các file mới dưới đây
3. `bun run db:drift` — schema khớp `drizzle/`
4. `bun run db:migrate` trên bản copy DB thật — backfill đúng, không mất destination nào
5. Smoke test với `MESSENGER_ENABLED=false` — app chạy y hệt trước, không mở port
6. Smoke test với `MESSENGER_ENABLED=true`: Meta verify được webhook; `/messenger-link`
   rồi nhắn code cho Page thì link thành công; `status` qua Messenger trả đúng; một
   alert thật tới cả Discord lẫn Messenger

| File test | Kiểm cái gì |
|---|---|
| `notify/dispatcher.test.ts` | Fan-out; một provider lỗi không chặn provider kia; provider lạ chỉ log |
| `notify/messenger-notifier.test.ts` | Cửa sổ mở → gửi; đóng → vào outbox **và không gọi API**; lỗi cửa sổ từ API → vào outbox |
| `notify/messenger-text.test.ts` | Strip markdown, cắt 2000 ký tự, digest dạng dòng |
| `notify/embeds.test.ts` | Bổ sung: `table` render ra đúng chuỗi đã pad như trước khi sửa |
| `notify/messages.test.ts` | Sửa: 3 assertion về `description` chuyển sang `table` |
| `web/signature.test.ts` | HMAC đúng/sai, timing-safe, tính trên raw bytes |
| `web/webhook.test.ts` | Qua `app.handle()`: GET verify pass/fail, POST 401 khi sai sig, bỏ `is_echo`, dedupe `mid`, trả 200 trước khi xử lý xong |
| `messenger/parse-command.test.ts` | Parser sinh từ `toJSON()`, positional + `key=value`, integer sai báo lỗi, lệnh lạ |
| `messenger/interaction.test.ts` | Chạy thật `statusCommand` và `addCommand` qua adapter — bằng chứng tái dùng được, không chỉ là tuyên bố |
| `messenger/link.test.ts` | Code hết hạn, code đã dùng, link thành công cấp đúng quyền |
| `db/destinations.repo.test.ts` | Fallback **theo từng provider**, chống trùng row global |
| `digest/schedule.test.ts` | Bổ sung: digest tới `DIGEST_CHANNEL_ID` cộng mọi PSID `is_admin = 1`; PSID đã link nhưng `is_admin = 0` **không** nhận digest dù vẫn nhận alert |
| `db/outbox.repo.test.ts` | Enqueue, flush, gộp khi > 3, bỏ khi quá hạn |
| `db/migrate.test.ts` | Bổ sung: backfill `alert_channel_id` đúng |

Bước 6 không thể bỏ. Không test nào phủ được Meta thật gọi vào webhook thật, và
signature verification là chỗ sai thì im lặng 401 mà không ai biết.

## Rủi ro đã biết

1. **Ràng buộc 24h là rủi ro vận hành, không phải bug.** Messenger sẽ im lặng nếu không
   ai nhắn Page trong 24 giờ. Discord phải giữ vai trò kênh đảm bảo; Messenger là kênh
   phụ. Nếu sau này cần một kênh phụ *đáng tin*, Telegram không có ràng buộc này.
2. **Bề mặt tấn công tăng.** App mở HTTP server public và nhận **lệnh admin** từ một
   danh tính Facebook — chiếm được Facebook của admin là chiếm được quyền ghi. Đây là
   đánh đổi đã chọn có ý thức. Giảm nhẹ bằng: HMAC bắt buộc, PSID chưa link không chạy
   được lệnh nào, và `is_admin` chỉ cấp qua link code phát từ một Discord admin.
3. **Meta đã siết policy hai lần trong 2026** (tag tháng 4, recurring notifications
   tháng 2). Thiết kế cô lập provider sau `Notifier`, nên nếu Messenger chết hẳn thì rút
   provider ra mà không đụng phần còn lại.

## Ngoài phạm vi

- Không dùng One-Time Notification, Marketing Messages, hay Sponsored Messages — đều
  không phù hợp cho alert uptime
- Không dùng `HUMAN_AGENT` tag để lách cửa sổ 24h; đó là vi phạm policy
- Không làm quick replies, persistent menu, hay template card của Messenger — chỉ text
- Không làm Instagram Messaging, dù dùng chung API
- Không đổi hành vi Discord hiện có, ngoài 5 lệnh mới
- Không làm hàng đợi retry tổng quát cho Discord; Discord giữ retry-một-lần như hiện tại
- Không thêm provider thứ ba trong lần này; kiến trúc mở đường nhưng Telegram/Zalo là
  việc riêng
