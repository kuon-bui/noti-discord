import type { ProbeResult, Target } from '../shared/types.js'

export type Probe = {
  run(target: Target): Promise<ProbeResult>
}
