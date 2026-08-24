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
