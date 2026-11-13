// helpers/op.ts: a wave runs on the host; wait for the runner's next
// operation (a newer id than before the click) to end, and return it.
import { expect, type Page } from '@playwright/test';

type Op = { id: number; state: string; action: string; lines?: string[] };
const opJson = (page: Page, q = '') => page.evaluate((u) => fetch(u).then((r) => r.json()), `/api/op${q}`);
const op = async (page: Page): Promise<Op | null> => (await opJson(page)).op;

export async function lastOpId(page: Page): Promise<number> {
  return (await op(page))?.id ?? 0;
}

// action: the make target to wait for (the Scoreboard starts witness runs of
// its own in between); without it, any newer operation.
export async function waitOp(page: Page, after: number, timeoutMs = 300_000, action?: string) {
  let last: Op | null = null;
  await expect
    .poll(async () => {
      const recent: Op[] = (await opJson(page)).recent || [];
      const hit = recent.filter((o) => o.id > after && (!action || o.action === action)).at(-1); // the first after the click
      if (!hit || hit.state === 'running') return 'waiting';
      last = (await opJson(page, `?id=${hit.id}`)).op;
      return last!.state;
    }, { timeout: timeoutMs, intervals: [2000] })
    .not.toBe('waiting');
  expect(last!.state, `make ${last!.action}:\n${(last!.lines || []).slice(-25).join('\n')}`).toBe('succeeded');
  return last!;
}

// The runner does one thing at a time (409 while busy, by design): the
// Scoreboard itself may have just started a witness run.
export async function runViaApi(page: Page, path: string, body?: unknown) {
  let before = 0;
  await expect
    .poll(async () => {
      before = await lastOpId(page);
      return page.evaluate(([p, b]) => fetch(p as string, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.status), [path, body]);
    }, { timeout: 120_000, intervals: [2000] })
    .toBe(200);
  return waitOp(page, before, 300_000, path === '/api/witness/run' ? 'witness' : undefined);
}
