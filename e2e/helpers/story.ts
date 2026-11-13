// helpers/story.ts: put the stage in a shown state through the API, as the
// signed-in presenter (the same steps the buttons run): imported, pushed to
// both destinations and rotated once, with both copies synced.
import { expect, type APIRequestContext } from '@playwright/test';

export async function populate(request: APIRequestContext): Promise<void> {
  for (const step of ['home/apply', 'out/localstack', 'out/github', 'change/rotate']) {
    const r = await request.post(`/api/acts/${step}`);
    expect([200, 409], `${step}: HTTP ${r.status()}`).toContain(r.status());
  }
  await expect
    .poll(async () => {
      const j = await (await request.get('/api/sync')).json();
      return Object.values(j.destinations).map((d: any) => d.associations[0]?.sync_status);
    }, { timeout: 60_000 })
    .toEqual(['SYNCED', 'SYNCED']);
}
