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

test("the run log cap never drops today's billed runs", async (t) => {
  const { digest } = await store(t);
  digest.recordRun(run(new Date(NOW - 3 * 3600_000).toISOString(), 1.9));
  for (let i = 0; i < 520; i++)
    digest.recordRun(
      run(
        new Date(NOW - 3 * 3600_000 + (i + 1) * 1000).toISOString(),
        0,
        'skipped',
      ),
    );
  assert.equal(Math.round(digest.spentOnDay(NOW) * 100) / 100, 1.9);
});

const briefRun = (startedAt, costUsd, digestRunId, status = 'ok') => ({
  ...run(startedAt, costUsd, status),
  id: `brief_${startedAt}`,
  kind: 'brief',
  digestRunId,
});
const brief = (id, digestRunId) => ({
  id,
  digestRunId,
  createdAt: new Date(NOW).toISOString(),
  headline: { text: `Headline ${id}`, storyIds: ['st_1'] },
});

test('brief runs share the run log and budget; old records read as digests', async (t) => {
  const { digest } = await store(t);
  const at = (minutes) => new Date(NOW + minutes * 60_000).toISOString();
  // A record from before run kinds existed has no kind: it is a digest.
  digest.commit({ stories: [], run: run(at(0), 0.34), citedItems: [] });
  digest.commitBrief({
    brief: brief('br_1', `run_${at(0)}`),
    run: briefRun(at(1), 0.12, `run_${at(0)}`),
  });
  assert.equal(digest.lastRun().id, `run_${at(0)}`, 'the last digest run');
  assert.equal(digest.lastCompletedRun().id, `run_${at(0)}`);
  assert.equal(digest.lastBriefRun().id, `brief_${at(1)}`);
  assert.equal(Math.round(digest.spentOnDay(NOW) * 100) / 100, 0.46);
  assert.equal(digest.brief().id, 'br_1');
  assert.equal(digest.previousBrief(), null);
  assert.equal(digest.digestsSince(`run_${at(0)}`), 0);
  // A second digest whose brief fails: the first brief stays, one behind.
  digest.commit({
    stories: [],
    run: { ...run(at(5), 0.4), kind: 'digest' },
    citedItems: [],
  });
  digest.recordRun(briefRun(at(6), 0.05, `run_${at(5)}`, 'failed'));
  assert.equal(digest.brief().id, 'br_1');
  assert.equal(digest.lastBriefRun().status, 'failed');
  assert.equal(digest.digestsSince(digest.brief().digestRunId), 1);
  assert.equal(digest.digestsSince('run_unknown'), null);
  digest.commitBrief({
    brief: brief('br_2', `run_${at(5)}`),
    run: briefRun(at(7), 0.1, `run_${at(5)}`),
  });
  assert.equal(digest.brief().id, 'br_2');
  assert.equal(digest.previousBrief().id, 'br_1');
});

test('the current and previous brief survive a restart', async (t) => {
  const { digest, cacheDir } = await store(t);
  const at = new Date(NOW).toISOString();
  digest.commit({ stories: [], run: run(at, 0.3), citedItems: [] });
  digest.commitBrief({
    brief: brief('br_1', `run_${at}`),
    run: briefRun(at, 0.1, `run_${at}`),
  });
  assert.deepEqual(digest.actorState(), { roles: {}, learned: [] });
  const actors = {
    roles: {
      'saudi-arabia': {
        role: 'party',
        since: at,
        storyIds: ['st_1'],
        changedFrom: 'external',
        briefId: 'br_2',
      },
    },
    learned: [
      {
        id: 'egypt',
        name: 'Egypt',
        type: 'state',
        role: 'external',
        aliases: [],
        addedAt: at,
        briefId: 'br_2',
      },
    ],
  };
  digest.commitBrief({
    brief: brief('br_2', `run_${at}`),
    run: briefRun(at, 0.1, `run_${at}`),
    actors,
  });
  await digest.save();
  const again = createDigestStore({
    theaterId: 'fixture',
    cacheDir,
    now: () => NOW,
  });
  await again.load();
  assert.equal(again.brief().id, 'br_2');
  assert.equal(again.previousBrief().id, 'br_1');
  assert.equal(again.lastBriefRun().kind, 'brief');
  assert.deepEqual(again.actorState(), actors, 'roles and learned actors too');
});
