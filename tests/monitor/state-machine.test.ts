import { describe, expect, it } from 'bun:test'
import { transitionFor } from '../../src/monitor/state-machine.js'
import type { Status, Transition } from '../../src/shared/types.js'

const down: Transition = { kind: 'down' }
const recovered: Transition = { kind: 'recovered' }

describe('transitionFor', () => {
  it.each<[Status, Status, Transition | null]>([
    ['UNKNOWN', 'UP', null],
    ['UNKNOWN', 'DEGRADED', null],
    ['UNKNOWN', 'DOWN', down],
    ['UNKNOWN', 'UNKNOWN', null],

    ['UP', 'UP', null],
    ['UP', 'DEGRADED', null],
    ['UP', 'DOWN', down],
    ['UP', 'UNKNOWN', null],

    ['DEGRADED', 'UP', null],
    ['DEGRADED', 'DEGRADED', null],
    ['DEGRADED', 'DOWN', down],
    ['DEGRADED', 'UNKNOWN', null],

    ['DOWN', 'UP', recovered],
    ['DOWN', 'DEGRADED', recovered],
    ['DOWN', 'DOWN', null],
    ['DOWN', 'UNKNOWN', recovered],
  ])('%s -> %s cho %o', (prev, next, expected) => {
    expect(transitionFor(prev, next)).toEqual(expected)
  })

  it('vào và ra DEGRADED không bao giờ sinh alert', () => {
    expect(transitionFor('UP', 'DEGRADED')).toBeNull()
    expect(transitionFor('DEGRADED', 'UP')).toBeNull()
  })
})
