// global-teardown.ts: leave a fresh stage behind: nothing synced (no TIDEWELL_
// secret left in GitHub), nothing imported. KEEP_STAGE=1 keeps the state the
// run left (for example make screenshots, to present from it); make
// stage-reset CONFIRM=yes cleans up afterwards.
import { stageReset } from './helpers/env';

export default async function globalTeardown(): Promise<void> {
  if (process.env.KEEP_STAGE === '1') return;
  stageReset();
}
