import { describe, expect, it } from 'vitest'
import { runWithLimit } from '../../src/shared/concurrency.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('runWithLimit', () => {
  it('chạy hết mọi phần tử', async () => {
    const done: number[] = []
    await runWithLimit([1, 2, 3, 4, 5], 2, async (item) => {
      done.push(item)
    })
    expect(done.sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('truyền đúng index', async () => {
    const seen: Array<[string, number]> = []
    await runWithLimit(['a', 'b', 'c'], 3, async (item, index) => {
      seen.push([item, index])
    })
    expect(seen.sort()).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
  })

  it('không bao giờ vượt quá limit tại một thời điểm', async () => {
    let running = 0
    let peak = 0
    const gates = [deferred(), deferred(), deferred(), deferred()]

    const all = runWithLimit([0, 1, 2, 3], 2, async (index) => {
      running++
      peak = Math.max(peak, running)
      await gates[index]?.promise
      running--
    })

    await Promise.resolve()
    expect(peak).toBeLessThanOrEqual(2)
    for (const gate of gates) gate.resolve()
    await all
    expect(peak).toBe(2)
  })

  it('danh sách rỗng thì trả về ngay', async () => {
    await expect(
      runWithLimit([], 5, async () => {
        throw new Error('không được gọi')
      }),
    ).resolves.toBeUndefined()
  })

  it('limit lớn hơn số phần tử vẫn chạy đúng', async () => {
    const done: number[] = []
    await runWithLimit([1, 2], 10, async (item) => {
      done.push(item)
    })
    expect(done.sort()).toEqual([1, 2])
  })

  it('không bắt lỗi — task throw thì promise reject', async () => {
    await expect(
      runWithLimit([1], 1, async () => {
        throw new Error('nổ')
      }),
    ).rejects.toThrow('nổ')
  })
})
