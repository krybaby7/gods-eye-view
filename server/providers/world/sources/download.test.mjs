import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { downloadWorldFile } from './download.js';
import { createWorldFetch } from './transport.js';

const url = 'https://source.test/archive.zip';
const etag = '"version-1"';
const lastModified = 'Mon, 09 Nov 2026 00:00:00 GMT';
const realSetTimeout = setTimeout;

async function downloadFixture(t, fetchImpl, options) {
  const cacheDirectory = await mkdtemp(
    path.join(tmpdir(), 'gev-world-download-'),
  );
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  return {
    cacheDirectory,
    download: (overrides) =>
      downloadWorldFile(url, {
        cacheDirectory,
        fetchImpl,
        ...options,
        ...overrides,
      }),
  };
}

function bodyResponse(body, headers = {}, status = 200) {
  return new Response(body, { status, headers: { ETag: etag, ...headers } });
}

test('bulk download stays alive while chunks arrive within the stall window', async (t) => {
  let sent = 0;
  const progress = [];
  const { download } = await downloadFixture(
    t,
    () =>
      bodyResponse(
        new ReadableStream({
          async pull(controller) {
            await delay(40);
            controller.enqueue(Buffer.from(String(++sent)));
            if (sent === 4) controller.close();
          },
        }),
        { 'Content-Length': '4' },
      ),
    { stallTimeoutMs: 130, onProgress: (event) => progress.push(event) },
  );

  const result = await download();
  assert.equal(await readFile(result.path, 'utf8'), '1234');
  assert.equal(result.bytes, 4);
  assert.deepEqual(
    progress.map(({ bytes }) => bytes),
    [1, 2, 3, 4],
  );
  assert.ok(progress.every(({ totalBytes }) => totalBytes === 4));
});

test('bulk download keeps a stalled prefix and resumes with an exact Range', async (t) => {
  let calls = 0;
  let canceled = false;
  const { download } = await downloadFixture(
    t,
    (_, { headers }) => {
      if (++calls === 1) {
        return bodyResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from('abc'));
            },
            cancel() {
              canceled = true;
            },
          }),
          { 'Content-Length': '6' },
        );
      }
      assert.equal(headers.get('Range'), 'bytes=3-');
      assert.equal(headers.get('If-Range'), etag);
      return bodyResponse('def', { 'Content-Range': 'bytes 3-5/6' }, 206);
    },
    { stallTimeoutMs: 200 },
  );

  await assert.rejects(download(), {
    code: 'DOWNLOAD_STALLED',
    message: /stalled.*200 ms/i,
  });
  assert.equal(canceled, true);
  const result = await download();
  assert.equal(await readFile(result.path, 'utf8'), 'abcdef');
  assert.equal(result.resumedFrom, 3);
});

test('bulk download enforces the overall cap while bytes keep arriving', async (t) => {
  let canceled = false;
  const { download } = await downloadFixture(
    t,
    () =>
      bodyResponse(
        new ReadableStream({
          async pull(controller) {
            await delay(15);
            if (!canceled) controller.enqueue(Buffer.from('x'));
          },
          cancel() {
            canceled = true;
          },
        }),
      ),
    { stallTimeoutMs: 200, overallTimeoutMs: 100 },
  );

  await assert.rejects(download(), {
    code: 'DOWNLOAD_TIMEOUT',
    message: /overall.*100 ms/i,
  });
  assert.equal(canceled, true);
});

test(
  'bulk download retries one interrupted connection and resumes its prefix',
  { timeout: 5_000 },
  async (t) => {
    let requests = 0;
    let sent = false;
    const { cacheDirectory, download } = await downloadFixture(
      t,
      (_, { headers, retryConnection }) => {
        assert.equal(retryConnection, false);
        if (++requests === 1) {
          return bodyResponse(
            new ReadableStream({
              async pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(Buffer.from('abc'));
                  return;
                }
                // Interrupt only after the fake prefix has reached disk.
                for (;;) {
                  const part = (await readdir(cacheDirectory)).find((name) =>
                    name.endsWith('.part'),
                  );
                  if (
                    part &&
                    (await stat(path.join(cacheDirectory, part))).size === 3
                  )
                    break;
                  await delay(10);
                }
                controller.error(
                  Object.assign(new Error('connection reset'), {
                    code: 'ECONNRESET',
                  }),
                );
              },
            }),
            { 'Content-Length': '6' },
          );
        }
        assert.equal(headers.get('Range'), 'bytes=3-');
        return bodyResponse('def', { 'Content-Range': 'bytes 3-5/6' }, 206);
      },
    );

    const result = await download();
    assert.equal(await readFile(result.path, 'utf8'), 'abcdef');
    assert.equal(requests, 2);
  },
);

test('bulk download shares its connection retry across headers and body', async (t) => {
  let requests = 0;
  const failure = Object.assign(new Error('connection reset'), {
    code: 'ECONNRESET',
  });
  const { download } = await downloadFixture(t, () => {
    if (++requests === 1) throw failure;
    return bodyResponse(
      new ReadableStream({ pull: (controller) => controller.error(failure) }),
    );
  });

  await assert.rejects(download(), { code: 'ECONNRESET' });
  assert.equal(requests, 2);
});

test('complete download uses validators until a new release replaces it', async (t) => {
  let calls = 0;
  const { download } = await downloadFixture(t, (_, { headers }) => {
    calls++;
    if (calls === 1) {
      return bodyResponse('first', {
        'Content-Length': '5',
        'Last-Modified': lastModified,
      });
    }
    assert.equal(headers.get('If-None-Match'), etag);
    assert.equal(headers.get('If-Modified-Since'), lastModified);
    return calls === 2
      ? new Response(null, { status: 304 })
      : bodyResponse('second', { ETag: '"version-2"', 'Content-Length': '6' });
  });

  const first = await download();
  assert.equal(first.etag, etag);
  assert.equal(first.lastModified, lastModified);
  const unchanged = await download();
  assert.equal(unchanged.reused, true);
  assert.equal(unchanged.path, first.path);
  assert.equal(await readFile(unchanged.path, 'utf8'), 'first');
  const updated = await download();
  assert.equal(updated.reused, false);
  assert.equal(updated.etag, '"version-2"');
  assert.equal(await readFile(updated.path, 'utf8'), 'second');
});

test('a 200 response to a Range replaces the partial prefix', async (t) => {
  let calls = 0;
  const { download } = await downloadFixture(t, (_, { headers }) => {
    if (++calls === 1) return bodyResponse('abc', { 'Content-Length': '6' });
    assert.equal(headers.get('Range'), 'bytes=3-');
    return bodyResponse('uvwxyz', {
      ETag: '"version-2"',
      'Content-Length': '6',
    });
  });

  await assert.rejects(download(), /incomplete/i);
  const result = await download();
  assert.equal(result.resumedFrom, 0);
  assert.equal(await readFile(result.path, 'utf8'), 'uvwxyz');
});

test('an invalid Range response forces a fresh request', async (t) => {
  let calls = 0;
  const { download } = await downloadFixture(t, (_, { headers }) => {
    if (++calls === 1) return bodyResponse('abc', { 'Content-Length': '6' });
    if (calls === 2) {
      assert.equal(headers.get('Range'), 'bytes=3-');
      return bodyResponse('xyz', { 'Content-Range': 'bytes 2-4/6' }, 206);
    }
    assert.equal(headers.get('Range'), null);
    return bodyResponse('uvwxyz');
  });

  await assert.rejects(download(), /incomplete/i);
  const result = await download();
  assert.equal(result.resumedFrom, 0);
  assert.equal(await readFile(result.path, 'utf8'), 'uvwxyz');
});

test('immutable releases reuse complete files without another request', async (t) => {
  let calls = 0;
  const { download } = await downloadFixture(
    t,
    () => {
      calls++;
      return new Response('versioned');
    },
    { immutable: true },
  );

  await download();
  assert.equal((await download()).reused, true);
  assert.equal(calls, 1);
});

test('download size cap catches a body without Content-Length before publication', async (t) => {
  const { cacheDirectory, download } = await downloadFixture(
    t,
    () => bodyResponse('abcdef'),
    {
      maxBytes: 5,
    },
  );

  await assert.rejects(download(), { code: 'RESPONSE_TOO_LARGE' });
  assert.deepEqual(await readdir(cacheDirectory), []);
});

test('bulk download rejects HTML served as a ZIP before publishing', async (t) => {
  const { download, cacheDirectory } = await downloadFixture(
    t,
    () => bodyResponse('<!DOCTYPE html><title>Login required</title>'),
    { immutable: true, format: 'zip' },
  );
  await assert.rejects(download(), { code: 'DOWNLOAD_SIGNATURE' });
  assert.deepEqual(await readdir(cacheDirectory), []);
  await assert.rejects(download({ format: undefined }), {
    code: 'DOWNLOAD_SIGNATURE',
  });
  assert.deepEqual(await readdir(cacheDirectory), []);
});

test('bulk download checks expected CSV columns and the gzip header', async (t) => {
  const { download, cacheDirectory } = await downloadFixture(t, () =>
    bodyResponse('id,unexpected\n1,2'),
  );
  await assert.rejects(
    download({ format: 'csv', csvColumns: ['id', 'country'] }),
    {
      code: 'DOWNLOAD_SIGNATURE',
    },
  );
  await assert.rejects(download({ format: 'gzip' }), {
    code: 'DOWNLOAD_SIGNATURE',
  });
  assert.deepEqual(await readdir(cacheDirectory), []);
});

test('bulk download stall window starts when its host lane is granted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { promise: granted, resolve } = Promise.withResolvers();
  const fetchImpl = createWorldFetch((requestUrl) => {
    if (requestUrl.endsWith('/hold')) {
      resolve();
      return bodyResponse('first request');
    }
    return bodyResponse('archive');
  });
  const first = fetchImpl('https://source.test/hold');
  await granted;
  const { download } = await downloadFixture(t, fetchImpl, {
    stallTimeoutMs: 150,
  });
  const result = download();
  result.catch(() => {});
  await new Promise((resolve) => realSetTimeout(resolve, 220));
  t.mock.timers.tick(220);
  await (await first).text();
  assert.equal(await readFile((await result).path, 'utf8'), 'archive');
});

test('bulk download removes partial files older than a day', async (t) => {
  const { cacheDirectory, download } = await downloadFixture(t, () =>
    bodyResponse('new archive'),
  );
  const stale = 'a'.repeat(64) + '.part';
  const fresh = 'b'.repeat(64) + '.part';
  const orphan = 'c'.repeat(64) + '.part.json';
  const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
  for (const name of [stale, fresh]) {
    await writeFile(path.join(cacheDirectory, name), 'prefix');
    await writeFile(path.join(cacheDirectory, name + '.json'), '{}');
  }
  await writeFile(path.join(cacheDirectory, orphan), '{}');
  await utimes(path.join(cacheDirectory, orphan), staleTime, staleTime);
  await utimes(path.join(cacheDirectory, stale), staleTime, staleTime);
  await download();
  const files = await readdir(cacheDirectory);
  assert.ok(files.includes(fresh));
  assert.ok(!files.includes(stale) && !files.includes(stale + '.json'));
  assert.ok(!files.includes(orphan));
});
