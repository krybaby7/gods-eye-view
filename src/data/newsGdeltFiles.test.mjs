import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readSingleEntryZip } from '../../server/providers/news/fetchers/zip.js';
import {
  createGdeltFileFeed,
  fetchGdeltFileSources,
  gdeltFileStamps,
  gdeltFilesEnabled,
  gdeltTitleFilter,
  gkgRows,
  parseLastUpdate,
} from '../../server/providers/news/fetchers/gdeltFiles.js';
import {
  gdeltDataResponse,
  gdeltLastUpdate,
  gkgZip as zipped,
} from '../testSupport/gdeltFiles.mjs';
import { zipOneEntry } from '../testSupport/zipFixture.mjs';

// Eight real GKG 2.1 rows (see fixtures/README.md): six from the English
// 20261028210000 file, two from the 20261028000000 translation file, one of
// them with line breaks inside its extras XML. Long list fields are trimmed.
const GKG = readFileSync(
  new URL('./fixtures/gdelt-gkg-20261028.csv', import.meta.url),
);
const LATE = Date.parse('2026-10-28T22:00:00Z');

const source = (id, domain, overrides = {}) => ({
  id,
  name: id.toUpperCase(),
  folder: 'reporting',
  kind: 'independent',
  perspective: 'international-wire',
  languages: ['en'],
  starred: false,
  transport: { type: 'gdelt-domain', domain },
  ...overrides,
});

/** data.gdeltproject.org double over `state` (see testSupport/gdeltFiles). */
const gdeltData = (state) => async (raw) =>
  gdeltDataResponse(new URL(raw), state);

test('the zip reader returns the one stored or deflated entry', () => {
  const text = 'GKGRECORDID\tV2.1DATE\tÄnderung\n'.repeat(200);
  for (const method of [0, 8]) {
    const { name, data } = readSingleEntryZip(
      zipOneEntry('20261028210000.gkg.csv', text, { method }),
    );
    assert.equal(name, '20261028210000.gkg.csv');
    assert.equal(data.toString('utf8'), text);
  }
});

test('the zip reader refuses corrupt, unsupported and oversized archives', () => {
  const good = zipOneEntry('a.csv', 'row\n'.repeat(100));
  const fails = (bytes, pattern, options) =>
    assert.throws(() => readSingleEntryZip(bytes, options), pattern);
  fails(
    new TextEncoder().encode('<html>Not Found</html>'),
    /^Error: zip: not a zip file$/,
  );
  fails(good.subarray(0, 20), /zip: truncated/);
  fails(good.subarray(0, 40), /zip: truncated/);
  const flipped = Uint8Array.from(good);
  flipped[37] ^= 0xff;
  fails(flipped, /zip: (corrupt data|checksum mismatch|size mismatch)/);
  fails(zipOneEntry('a.csv', 'row', { crc: 1 }), /zip: checksum mismatch/);
  fails(
    zipOneEntry('a.csv', 'row', { uncompressedSize: 2 }),
    /zip: size mismatch/,
  );
  fails(zipOneEntry('a.csv', 'row', { flags: 1 }), /zip: encrypted/);
  fails(zipOneEntry('a.csv', 'row', { flags: 8 }), /zip: streamed entry/);
  fails(
    zipOneEntry('a.csv', 'row', { method: 12 }),
    /zip: unsupported method 12/,
  );
  fails(
    zipOneEntry('a.csv', 'row', { uncompressedSize: 0xffffffff }),
    /zip: zip64/,
  );
  fails(
    zipOneEntry('a.csv', 'row', { extraEntry: true }),
    /zip: more than one entry/,
  );
  fails(good, /zip: entry larger than 100 bytes/, { maxBytes: 100 });
  // A header that understates the size still stops at the cap.
  fails(
    zipOneEntry('a.csv', 'row\n'.repeat(100), { uncompressedSize: 10 }),
    /zip: entry larger than 100 bytes/,
    { maxBytes: 100 },
  );
});

test('GKG rows keep registered outlets with decoded titles and file times', () => {
  const domains = [
    'iheart.com',
    'heart.com',
    'azernews.az',
    'news.az',
    'arabnews.com',
    'iraqsun.com',
    'berliner-kurier.de',
    'vetogate.com',
  ];
  const { rows, total } = gkgRows(GKG, domains, { readAt: LATE });
  assert.equal(total, 8, 'the record with line breaks stays one record');
  assert.deepEqual(rows, [
    {
      domain: 'iheart.com',
      url: 'https://real923la.iheart.com/content/2026-10-28-nbas-first-overall-pick-to-debut-tonight/',
      title: "NBA's First Overall Pick To Debut Tonight",
      publishedAt: '2026-10-28T21:00:00.000Z',
      language: 'en',
    },
    {
      domain: 'azernews.az',
      url: 'https://www.azernews.az/region/266401.html',
      title: 'Iran: Israeli military action major concern for gas markets',
      publishedAt: '2026-10-28T21:00:00.000Z',
      language: 'en',
    },
    {
      domain: 'arabnews.com',
      url: 'https://www.arabnews.com/middle-east/israeli-forces-shell-southern-syria-village-after-raid-state-media-3008717',
      title:
        'Arab News | Israeli forces shell southern Syria village after raid: state media',
      publishedAt: '2026-10-28T21:00:00.000Z',
      language: 'en',
    },
    {
      domain: 'iraqsun.com',
      url: 'http://www.iraqsun.com/news/279402062/israel-polls-democrats-yair-golan-to-hold-coalition-talks-with-eisenkot-lapid',
      title:
        "Israel polls: Democrats' Yair Golan to hold coalition talks with Eisenkot, Lapid",
      publishedAt: '2026-10-28T21:00:00.000Z',
      language: 'en',
    },
    {
      domain: 'berliner-kurier.de',
      url: 'https://www.berliner-kurier.de:443/article/s-bahn-berlin-fahrplanaenderung-s41-s42-s15-10536545',
      title:
        'Änderung bei der S-Bahn, Ringbahn betroffen: Einschränkungen am Mittwoch',
      publishedAt: '2026-10-28T00:00:00.000Z',
      language: 'de',
    },
    {
      domain: 'vetogate.com',
      url: 'https://www.vetogate.com/5759008',
      title: 'ليبرمان يدعو أعضاء الليكود إلى التمرد لإسقاط نتنياهو',
      publishedAt: '2026-10-28T00:00:00.000Z',
      language: 'ar',
    },
  ]);
  // GDELT names a file about ten minutes before its stamp; a row read
  // early is never dated after the moment it was read.
  const early = gkgRows(GKG, ['iheart.com'], {
    readAt: Date.parse('2026-10-28T20:52:00Z'),
  });
  assert.equal(early.rows[0].publishedAt, '2026-10-28T20:52:00.000Z');
  // Rows with no title, and rows cut short, are dropped.
  const untitled = Buffer.from(
    GKG.toString('utf8')
      .replace(/<PAGE_TITLE>Arab News[^<]*<\/PAGE_TITLE>/, '')
      .concat(
        '20261028210000-9\t20261028210000\t1\tarabnews.com\thttps://www.arabnews.com/x\n',
      ),
  );
  assert.deepEqual(
    gkgRows(untitled, ['arabnews.com'], { readAt: LATE }).rows,
    [],
  );
  assert.deepEqual(gkgRows(GKG, [], { readAt: LATE }).rows, []);
});

test('the theater terms filter titles on word starts, case-insensitively', () => {
  const keep = gdeltTitleFilter(['Iran', 'Israel', 'Red Sea', 'IRGC']);
  assert.equal(
    keep('Iran: Israeli military action major concern for gas markets'),
    true,
  );
  assert.equal(keep('Iranian drones over the red  sea'), true);
  assert.equal(keep('irgc commander named'), true);
  assert.equal(keep('Fans gather in Tirana'), false);
  assert.equal(keep("NBA's First Overall Pick To Debut Tonight"), false);
  assert.equal(gdeltTitleFilter([])('Anything at all'), true);
});

test('lastupdate.txt names the newest GKG file on GDELT’s own host', () => {
  assert.deepEqual(parseLastUpdate(gdeltLastUpdate('20261028210000')), {
    stamp: '20261028210000',
    bytes: 6_957_885,
  });
  assert.equal(parseLastUpdate('<html>maintenance</html>'), null);
  assert.equal(
    parseLastUpdate(
      '6957885 76ec http://elsewhere.example/gdeltv2/20261028210000.gkg.csv.zip',
    ),
    null,
  );
});

test('only files newer than the last one read, and at most four to seed', () => {
  assert.deepEqual(gdeltFileStamps('20261028210000', null), [
    '20261028201500',
    '20261028203000',
    '20261028204500',
    '20261028210000',
  ]);
  assert.deepEqual(gdeltFileStamps('20261028210000', '20261028203000'), [
    '20261028204500',
    '20261028210000',
  ]);
  assert.deepEqual(gdeltFileStamps('20261028210000', '20261028210000'), []);
  assert.deepEqual(gdeltFileStamps('20261028210000', '20261028211500'), []);
  assert.deepEqual(
    gdeltFileStamps('20261028210000', '20261027090000'),
    gdeltFileStamps('20261028210000', null),
    'a long gap reads only the last hour',
  );
  assert.deepEqual(gdeltFileStamps('20261029000000', '20261028233000'), [
    '20261028234500',
    '20261029000000',
  ]);
  assert.deepEqual(gdeltFileStamps('20261028210000', 'garbage', 2), [
    '20261028204500',
    '20261028210000',
  ]);
});

test('the feed seeds four files, then reads only newer ones, once for every theater', async () => {
  const stamps = [
    '20261028194500',
    '20261028200000',
    '20261028201500',
    '20261028203000',
    '20261028204500',
    '20261028210000',
    '20261028211500',
  ];
  const state = {
    latest: '20261028210000',
    files: Object.fromEntries(
      stamps.map((stamp) => [
        stamp,
        zipped(stamp, [
          [`https://apnews.com/article/${stamp}`, `Iran update ${stamp}`],
          [`https://example.org/${stamp}`, `Elsewhere ${stamp}`],
        ]),
      ]),
    ),
  };
  const logs = [];
  const feed = createGdeltFileFeed({ log: (line) => logs.push(line) });
  const read = (after) =>
    feed.read({
      after,
      domains: ['apnews.com'],
      fetchImpl: gdeltData(state),
      now: () => LATE,
    });

  const first = await read(null);
  assert.equal(first.error, null);
  assert.equal(first.cursor, '20261028210000');
  assert.deepEqual(
    first.rows.map((row) => row.url.slice(-14)),
    stamps.slice(2, 6),
  );
  assert.deepEqual(state.calls, [
    'lastupdate.txt',
    '20261028201500.gkg.csv.zip',
    '20261028203000.gkg.csv.zip',
    '20261028204500.gkg.csv.zip',
    '20261028210000.gkg.csv.zip',
  ]);
  assert.equal(first.downloads.length, 4);
  assert.ok(
    first.downloads.every((d) => d.bytes > 0 && d.rows === 2 && d.kept === 1),
  );
  assert.equal(logs.length, 1);
  assert.match(
    logs[0],
    /^\[news\] GDELT files: 4 files, [\d.]+ MB, 8 rows, 4 kept$/,
  );

  state.calls.length = 0;
  const again = await read(first.cursor);
  assert.deepEqual(again.rows, []);
  assert.equal(again.cursor, '20261028210000');
  assert.deepEqual(state.calls, ['lastupdate.txt'], 'no file is read twice');

  // A second theater, a file behind, is served from memory.
  const behind = await read('20261028204500');
  assert.deepEqual(
    behind.rows.map((row) => row.title),
    ['Iran update 20261028210000'],
  );
  assert.deepEqual(state.calls, ['lastupdate.txt', 'lastupdate.txt']);

  state.latest = '20261028211500';
  state.calls.length = 0;
  const next = await read(first.cursor);
  assert.deepEqual(state.calls, [
    'lastupdate.txt',
    '20261028211500.gkg.csv.zip',
  ]);
  assert.equal(next.cursor, '20261028211500');
  assert.equal(logs.length, 2, 'one log line per read that downloads');
});

test('size caps fail the cycle cleanly before or during the download', async () => {
  const stamp = '20261028210000';
  // Random text barely compresses: the zip is about 600 kB.
  const big = zipped(stamp, [
    ['https://apnews.com/a', randomBytes(600_000).toString('base64')],
  ]);
  const read = (state, options) =>
    createGdeltFileFeed({ log: () => {}, ...options }).read({
      after: '20261028204500',
      domains: ['apnews.com'],
      fetchImpl: gdeltData(state),
      now: () => LATE,
    });

  const declared = {
    latest: stamp,
    declared: 50_000_000,
    files: { [stamp]: big },
  };
  const refused = await read(declared, { maxFileBytes: 32 * 1024 * 1024 });
  assert.equal(
    refused.error,
    'file 20261028210000 is 47.7 MB, over the 32 MB cap',
  );
  assert.equal(refused.cursor, '20261028204500');
  assert.deepEqual(declared.calls, ['lastupdate.txt'], 'nothing downloaded');

  const lying = { latest: stamp, declared: 100, files: { [stamp]: big } };
  const cut = await read(lying, { maxFileBytes: 512 * 1024 });
  assert.equal(cut.error, 'file 20261028210000 is over the 0.5 MB cap');
  assert.equal(cut.cursor, '20261028204500');

  const inflated = { latest: stamp, declared: 100, files: { [stamp]: big } };
  const unzipped = await read(inflated, { maxCsvBytes: 1000 });
  assert.match(unzipped.error, /^zip: entry larger than 1000 bytes$/);
  assert.equal(unzipped.cursor, '20261028204500');
});

test('sources report counts, and one clear error when the files fail', async () => {
  const apnews = source('apnews', 'apnews.com');
  const reuters = source('reuters', 'reuters.com');
  const tasnim = source('tasnim', 'tasnimnews.com', {
    folder: 'official',
    kind: 'state',
    languages: ['en', 'fa'],
  });
  const sources = [apnews, reuters, tasnim];
  const domains = ['apnews.com', 'reuters.com', 'tasnimnews.com', 'afp.com'];
  const state = {
    latest: '20261028210000',
    files: {
      20261028204500: zipped('20261028204500', [
        ['https://apnews.com/article/1', 'Strikes reported near Isfahan, Iran'],
        ['https://apnews.com/article/2', 'Baseball playoffs open tonight'],
      ]),
      20261028210000: zipped('20261028210000', [
        [
          'https://www.tasnimnews.com/en/news/3',
          'IRGC says drills begin in Hormuz',
        ],
        ['https://factcheck.afp.com/x', 'Fact check: Israel video is old'],
        ['https://apnews.com/article/4', null],
      ]),
    },
  };
  const collect = (options = {}) =>
    fetchGdeltFileSources(sources, {
      feed: createGdeltFileFeed({ log: () => {} }),
      after: '20261028203000',
      domains,
      terms: ['Iran', 'Israel', 'IRGC', 'Hormuz'],
      fetchImpl: gdeltData(state),
      now: () => LATE,
      ...options,
    });

  const ok = await collect();
  assert.equal(ok.cursor, '20261028210000');
  assert.deepEqual(
    ok.results.map(({ status }) => [
      status.sourceId,
      status.ok,
      status.count,
      status.error,
    ]),
    [
      ['apnews', true, 1, null],
      ['reuters', true, 0, null],
      ['tasnim', true, 1, null],
    ],
  );
  const items = ok.results.flatMap((result) => result.items);
  assert.deepEqual(
    items.map((item) => [item.sourceId, item.title, item.publishedAt]),
    [
      [
        'apnews',
        'Strikes reported near Isfahan, Iran',
        '2026-10-28T20:45:00.000Z',
      ],
      [
        'tasnim',
        'IRGC says drills begin in Hormuz',
        '2026-10-28T21:00:00.000Z',
      ],
    ],
  );
  assert.equal(items[1].primarySource.kind, 'statement');
  assert.equal(items[1].transport, 'gdelt-domain');
  assert.equal(items[1].snippet, '');

  const errorOf = (result) =>
    result.results.map(({ status, items: found }) => [
      status.sourceId,
      status.ok,
      status.error,
      found.length,
    ]);
  const down = await collect({
    fetchImpl: gdeltData({ ...state, lastUpdateStatus: 503 }),
  });
  assert.equal(down.cursor, '20261028203000');
  assert.deepEqual(errorOf(down), [
    ['apnews', false, 'GDELT files: lastupdate.txt HTTP 503', 0],
    ['reuters', false, 'GDELT files: lastupdate.txt HTTP 503', 0],
    ['tasnim', false, 'GDELT files: lastupdate.txt HTTP 503', 0],
  ]);

  // The newest file is not a zip: the older one still delivers, the cursor
  // stops before the bad file, and every source carries the error.
  const broken = await collect({
    fetchImpl: gdeltData({
      ...state,
      files: {
        ...state.files,
        20261028210000: new TextEncoder().encode('<html>Not Found</html>'),
      },
    }),
  });
  assert.equal(broken.cursor, '20261028204500');
  assert.deepEqual(errorOf(broken), [
    ['apnews', false, 'GDELT files: zip: not a zip file', 1],
    ['reuters', false, 'GDELT files: zip: not a zip file', 0],
    ['tasnim', false, 'GDELT files: zip: not a zip file', 0],
  ]);

  // GDELT sometimes skips an interval: a missing older file is passed over,
  // a missing newest file is an error.
  const gap = await collect({
    fetchImpl: gdeltData({
      ...state,
      files: { 20261028210000: state.files[20261028210000] },
    }),
  });
  assert.equal(gap.cursor, '20261028210000');
  assert.equal(gap.results[0].status.ok, true);
  const missing = await collect({
    fetchImpl: gdeltData({
      ...state,
      files: { 20261028204500: state.files[20261028204500] },
    }),
  });
  assert.equal(missing.cursor, '20261028204500');
  assert.equal(
    missing.results[0].status.error,
    'GDELT files: file 20261028210000 HTTP 404',
  );
});

test('NEWS_GDELT_FILES=off switches the files path off', () => {
  assert.equal(gdeltFilesEnabled({}), true);
  assert.equal(gdeltFilesEnabled({ NEWS_GDELT_FILES: 'on' }), true);
  assert.equal(gdeltFilesEnabled({ NEWS_GDELT_FILES: 'off' }), false);
  assert.equal(gdeltFilesEnabled({ NEWS_GDELT_FILES: ' OFF ' }), false);
});
