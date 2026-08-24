import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

const before = git(['status', '--porcelain', '--', 'drizzle'])

// Gọi thẳng bin.cjs của drizzle-kit bằng `node` thay vì đi qua `npx`.
// Trên Windows, `npx` thực chất là `npx.cmd`, và execFileSync spawn file .cmd
// không qua shell bị lỗi ENOENT/EINVAL trên Node hiện tại — chạy `node <bin.cjs>`
// trực tiếp tránh hoàn toàn vấn đề đó và vẫn chạy được trên cả Windows lẫn Linux.
const require = createRequire(import.meta.url)
const drizzleKitEntry = require.resolve('drizzle-kit')
const drizzleKitBin = path.join(path.dirname(drizzleKitEntry), 'bin.cjs')

try {
  execFileSync(process.execPath, [drizzleKitBin, 'generate'], { encoding: 'utf8', stdio: 'pipe' })
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
