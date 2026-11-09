import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorldService } from '../../server/providers/world/index.js';
import { loadWorldRegistry } from '../../server/providers/world/registry.js';
import { unhcr } from '../../server/providers/world/sources/liveDisplacement.js';
import { gdacs } from '../../server/providers/world/sources/liveDisasters.js';
import { gdelt } from '../../server/providers/world/sources/liveGovernance.js';

const gdeltSource = 'https://www.gdeltproject.org/data.html';
const gdacsSource = 'https://www.gdacs.org/xml/rss.xml';
const unhcrSource = 'https://api.unhcr.org/docs/refugee-statistics.html';
const controlledRss =
  '<rss><channel><item><gdacs:alertlevel>Red</gdacs:alertlevel>' +
  '<gdacs:eventtype>FL</gdacs:eventtype><gdacs:eventid>1</gdacs:eventid>' +
  '<gdacs:country iso3="IND">India</gdacs:country><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate>' +
  '</item></channel></rss>';

function awaitGate(promise) {
  return Promise.race([
    promise,
    delay(5_000, null, { ref: false }).then(() => {
      throw new Error('Controlled live proof gate timed out');
    }),
  ]);
}

async function controlledLive() {
  const cacheDir = await mkdtemp(join(tmpdir(), 'gev-world-live-proof-'));
  let clock = new Date('2026-11-09T10:00:00Z');
  let calls = 0;
  let manuals = 0;
  const tickStarted = Promise.withResolvers();
  const releaseTick = Promise.withResolvers();
  const manualStarted = Promise.withResolvers();
  const releaseManual = Promise.withResolvers();
  const service = createWorldService({
    cacheDir,
    now: () => clock,
    loadRegistry: async () => ({
      countries: [{ iso3: 'IND', name: 'India' }],
      indicators: [],
      sources: [{ id: 'probe' }, { id: 'live-gdacs' }],
    }),
    adapters: {
      'live-gdacs': gdacs,
      probe: {
        shouldCheck: () => true,
        async fetchObservations() {
          if (++manuals === 2) {
            manualStarted.resolve();
            await releaseManual.promise;
          }
          return {};
        },
      },
    },
    async fetchImpl(url) {
      if (url !== gdacsSource)
        throw new Error('Unexpected controlled request ' + url);
      if (++calls === 3) return new Response('', { status: 503 });
      if (calls === 5) {
        tickStarted.resolve();
        await releaseTick.promise;
      }
      return new Response(controlledRss);
    },
  });
  try {
    await service.refreshStatus();
    await service.whenIdle();
    const stateFile = join(cacheDir, 'world', 'state.json');
    const initial = await readFile(stateFile, 'utf8');
    const initialMtime = (await stat(stateFile)).mtimeMs;
    const unchanged = async () =>
      (await readFile(stateFile, 'utf8')) === initial &&
      (await stat(stateFile)).mtimeMs === initialMtime;
    const turnBefore = (await service.snapshot()).turn.number;
    const ticks = [];
    let stale;
    for (let tick = 1; tick <= 3; tick++) {
      clock = new Date(+clock + 3_600_000);
      await service.refresh('live-gdacs', { compact: true });
      await service.whenIdle();
      const snapshot = await service.snapshot({ compact: true });
      ticks.push({
        turn: snapshot.turn.number,
        stateUnchanged: await unchanged(),
      });
      if (tick === 2) stale = snapshot.features['live-gdacs'].flags[0];
    }
    clock = new Date(+clock + 3_600_000);
    await service.refresh('live-gdacs', { compact: true });
    await awaitGate(tickStarted.promise);
    const queued = (await service.refreshStatus()).refresh;
    const idle = service.whenIdle();
    releaseTick.resolve();
    await awaitGate(manualStarted.promise);
    ticks.push({
      turn: (await service.snapshot()).turn.number,
      stateUnchanged: await unchanged(),
    });
    releaseManual.resolve();
    await idle;
    return {
      turnBefore,
      ticks,
      turnAfter: (await service.snapshot()).turn.number,
      queued,
      lastGoodAt: stale?.lastGoodAt,
      staleSince: stale?.staleSince,
      staleStatus: stale?.status,
      manualJobs: manuals,
      liveFileBytes: (await stat(join(cacheDir, 'world', 'live.json'))).size,
    };
  } finally {
    releaseTick.resolve();
    releaseManual.resolve();
    await service.whenIdle();
    await rm(cacheDir, { recursive: true, force: true });
  }
}

async function controlledUnhcr(clock, yearAvailable) {
  const requested = [];
  const result = await unhcr.fetchObservations({
    now: new Date(clock),
    registry: { countries: [{ iso3: 'SDN' }] },
    fetchImpl(url) {
      const year = Number(new URL(url).searchParams.get('year'));
      requested.push(year);
      return Response.json(
        year === yearAvailable
          ? {
              maxPages: 1,
              items: [{ year, coa_iso: 'SDN', coo_iso: 'SDN', idps: 180000 }],
            }
          : { maxPages: 0, items: [] },
      );
    },
  });
  return { period: result.data.period, requested };
}

async function replayGdelt(directory) {
  const [manifest, archive, registry] = await Promise.all([
    readFile(join(directory, 'phase6-gdelt-manifest.txt'), 'utf8'),
    readFile(join(directory, 'phase6-gdelt.zip')),
    loadWorldRegistry(),
  ]);
  const stamp = manifest.match(/(\d{14})\.export\.CSV\.zip/)?.[1];
  if (!stamp)
    throw new Error('Recorded GDELT manifest has no export timestamp');
  const clock = new Date(
    stamp.replace(/^(....)(..)(..)(..)(..)(..)$/, '$1-$2-$3T$4:$5:$6Z'),
  );
  const result = await gdelt.fetchObservations({
    registry,
    now: clock,
    fetchImpl(url) {
      if (url.endsWith('lastupdate.txt')) return new Response(manifest);
      if (url.endsWith(stamp + '.export.CSV.zip')) return new Response(archive);
      throw new Error('Unexpected archive in recorded replay');
    },
  });
  return {
    ...result.data,
    flags: result.data.flags,
    clock: clock.toISOString(),
  };
}

export default async function live({ board }) {
  const [proof, march, november] = await Promise.all([
    controlledLive(),
    controlledUnhcr('2026-03-15T08:00:00Z', 2024),
    controlledUnhcr('2026-11-09T08:00:00Z', 2025),
  ]);
  const recorded = process.env.GEV_WORLD_GDELT_EVIDENCE_DIR;
  const current = board?.features?.['live-gdelt'];
  const observed = recorded ? await replayGdelt(recorded) : current;
  const quietCountries = ['CAN', 'NZL', 'IRL'];
  const flags =
    observed?.flags?.filter(
      ({ status }) => !status || status === 'active' || status === 'stale',
    ) ?? [];
  const found = flags.map(
    ({ iso3, slot, eventCount, sourceDomains, sourceUrls, evidence }) => ({
      iso3,
      slot,
      eventCount,
      distinctDomains: sourceDomains?.length,
      sourceUrls,
      evidence,
    }),
  );
  const valid = found.every(
    ({ eventCount, distinctDomains, sourceUrls, evidence }) =>
      eventCount >= 5 &&
      distinctDomains >= 3 &&
      sourceUrls?.length === 3 &&
      evidence === 'news-derived, low confidence',
  );
  const boardUnhcr = board?.features?.['live-unhcr'];
  const date = new Date().toISOString().slice(0, 10);
  return [
    {
      id: 'live-gdelt-evidence',
      expected:
        'Every flag has five distinct events, three domains, and three news URLs in the 72-hour window.',
      found: {
        basis: recorded
          ? 'Offline replay of one recorded publisher export'
          : 'World Board API',
        flags: found,
        ...(recorded && {
          archiveTime: observed.clock,
          namedCountrySampleCounts: Object.fromEntries(
            quietCountries.map((iso3) => [
              iso3,
              observed.batches
                .flatMap(({ events }) => events)
                .filter((event) => event[1] === iso3).length,
            ]),
          ),
        }),
      },
      source: gdeltSource,
      pass: Boolean(
        (recorded || (current?.lastGoodAt && current.sampledFiles > 0)) &&
        valid &&
        (!recorded ||
          found.every(({ iso3 }) => !quietCountries.includes(iso3))),
      ),
    },
    {
      id: 'live-ticks-no-turn',
      expected:
        'Four scoped ticks retain turn count and state.json bytes and modification time. A queued manual refresh adds one turn.',
      found: {
        basis:
          'Controlled local service with fixed clock and injected transport',
        ...proof,
      },
      source: 'server/providers/world/index.js',
      pass:
        proof.ticks.length === 4 &&
        proof.ticks.every(
          ({ turn, stateUnchanged }) =>
            turn === proof.turnBefore && stateUnchanged,
        ) &&
        proof.queued?.kind === 'live' &&
        proof.queued?.queued === true &&
        proof.turnAfter === proof.turnBefore + 1 &&
        proof.manualJobs === 2,
    },
    {
      id: 'live-stale-after-failure',
      expected:
        'A failed 12:00Z pull retains the flag with last good time 11:00Z.',
      found: {
        status: proof.staleStatus,
        lastGoodAt: proof.lastGoodAt,
        staleSince: proof.staleSince,
      },
      source: gdacsSource,
      pass:
        proof.staleStatus === 'stale' &&
        proof.lastGoodAt === '2026-11-09T11:00:00.000Z' &&
        proof.staleSince === '2026-11-09T12:00:00.000Z',
    },
    {
      id: 'live-unhcr-release-fallback',
      expected: {
        march: '2024 after unpublished 2025',
        november: '2025 on first request',
      },
      found: {
        basis: 'Controlled fixed-clock publisher responses',
        march,
        november,
        apiYear: boardUnhcr?.period ?? null,
      },
      source: unhcrSource,
      pass:
        march.period === '2024' &&
        march.requested.join(',') === '2025,2024' &&
        november.period === '2025' &&
        november.requested.join(',') === '2025',
    },
  ].map((row) => ({ ...row, checkedOn: date }));
}
