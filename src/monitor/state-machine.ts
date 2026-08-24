import type { Status, Transition } from '../shared/types.js'

export function transitionFor(prev: Status, next: Status): Transition | null {
  const wasDown = prev === 'DOWN'
  const isDown = next === 'DOWN'

  if (!wasDown && isDown) return { kind: 'down' }
  if (wasDown && !isDown) return { kind: 'recovered' }
  return null
}
