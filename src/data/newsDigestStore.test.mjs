import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createDigestStore,
  dailyBudgetUsd,
  localDayKey,
} from '../../server/providers/news/digest/store.js';

const NOW = new Date(2026, 9, 26, 12, 0, 0).getTime(); // local noon

async function store(t) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gev-news-digest-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  let clock = NOW;
  const digest = createDigestStore({
    theaterId: 'fixture',
    cacheDir,
    now: () => clock,
  });
  await digest.load();
  return { digest, cacheDir, advance: (ms) => (clock += ms), at: () => clock };
}
const story = (id, updatedAt, itemIds = ['a']) => ({
  id,
  status: 'open',
  itemIds,
  firstSeenAt: updatedAt,
  updatedAt,
});
const run = (startedAt, costUsd, status = 'ok') => ({
  id: `run_${startedAt}`,
  startedAt,
  costUsd,
  status,
});

test('daily budget defaults to 2.00 and accepts any non-negative number', () => {
  assert.equal(dailyBudgetUsd({}), 2);
  assert.equal(dailyBudgetUsd({ NEWS_DIGEST_DAILY_BUDGET_USD: '0.5' }), 0.5);
  assert.equal(dailyBudgetUsd({ NEWS_DIGEST_DAILY_BUDGET_USD: '0' }), 0);
  assert.equal(dailyBudgetUsd({ NEWS_DIGEST_DAILY_BUDGET_USD: 'two' }), 2);
  assert.equal(dailyBudgetUsd({ NEWS_DIGEST_DAILY_BUDGET_USD: '-1' }), 2);
});

test('spend sums every run started on the local day, failed runs included', async (t) => {
  const { digest } = await store(t);
  const yesterday = new Date(NOW - 24 * 3600_000).toISOString();
  digest.recordRun(run(yesterday, 1.5));
  digest.recordRun(run(new Date(NOW - 3600_000).toISOString(), 0.2, 'failed'));
  digest.commit({
    stories: [],
    run: run(new Date(NOW).toISOString(), 0.18),
    citedItems: [],
  });
  assert.equal(Math.round(digest.spentOnDay(NOW) * 100) / 100, 0.38);
  assert.equal(localDayKey(NOW), '2026-10-26');
  assert.equal(digest.lastRun().costUsd, 0.18);
  assert.equal(digest.lastCompletedRun().costUsd, 0.18);
});

test('commit snapshots cited items; stories close after 48 h and leave after a week', async (t) => {
  const { digest, advance } = await store(t);
  digest.commit({
    stories: [story('st_1', new Date(NOW).toISOString(), ['a', 'b'])],
    run: run(new Date(NOW).toISOString(), 0.1),
    citedItems: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
  });
  assert.equal(digest.citation('a').title, 'A');
  const revision = digest.revision();
  assert.equal(digest.stories()[0].status, 'open');
  assert.equal(
    digest.revision(),
    revision,
    'reading does not churn the revision',
  );
  advance(49 * 3600_000);
  const [closed] = digest.stories();
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedReason, 'age');
  assert.ok(digest.revision() > revision);
  advance(7 * 24 * 3600_000);
  assert.deepEqual(digest.stories(), []);
  assert.equal(digest.citation('a'), null, 'snapshots go with their stories');
});

test('the digest file round-trips stories, runs and citations', async (t) => {
  const { digest, cacheDir } = await store(t);
  digest.commit({
    stories: [story('st_1', new Date(NOW).toISOString())],
    run: run(new Date(NOW).toISOString(), 0.1),
    citedItems: [{ id: 'a', title: 'A' }],
  });
  await digest.save();
  const again = createDigestStore({
    theaterId: 'fixture',
    cacheDir,
    now: () => NOW,
  });
  await again.load();
  assert.equal(again.stories()[0].id, 'st_1');
  assert.equal(again.runs().length, 1);
  assert.equal(again.citation('a').title, 'A');
});
