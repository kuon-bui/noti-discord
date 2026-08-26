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
