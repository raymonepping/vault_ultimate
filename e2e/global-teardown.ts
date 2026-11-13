// global-teardown.ts: leave act 0 behind (the journey resets through the
// console already; this catches a run that failed halfway). KEEP_STAGE=1
// keeps whatever the run left.
import { currentAct, stageReset } from './helpers/env';

export default async function globalTeardown(): Promise<void> {
  if (process.env.KEEP_STAGE === '1' || currentAct() === 0) return;
  stageReset();
}
