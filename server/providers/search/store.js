import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export const SEARCH_ID = /^sr_[a-zA-Z0-9_-]{1,96}$/;

export function failSearch(
  search,
  error,
  finishedAt,
  makeRunId = () => 'run_' + randomUUID(),
) {
  const { running, ...record } = search;
  const { stage, ...run } = running ?? {};
  return {
    ...record,
    status: 'failed',
    error,
    runs: [
      ...(record.runs ?? []),
      {
        id: run.id ?? makeRunId(),
        kind: record.runs?.some(({ status }) => status === 'ok')
          ? 'update'
          : 'ask',
        agent: record.agent,
        startedAt: record.createdAt,
        ...run,
        finishedAt,
        status: 'failed',
        error,
      },
    ],
  };
}

async function writeAtomic(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(value) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

function indexEntry(search) {
  const { id, label, status, createdAt, colorIndex, visible, pinned } = search;
  return {
    id,
    label,
    status,
    createdAt,
    colorIndex,
    visible,
    pinned,
    finishedAt: search.runs?.at(-1)?.finishedAt ?? null,
  };
}

export function createSearchStore({
  cacheDir = '.gev-cache',
  now = Date.now,
  logger = console,
} = {}) {
  const directory = path.resolve(cacheDir, 'searches');
  const records = new Map();
  const recordFile = (id) => path.join(directory, id + '.json');
  const writeIndex = () =>
    writeAtomic(path.join(directory, 'index.json'), {
      searches: [...records.values()].map(indexEntry),
    });

  let initialized;
  async function initialize() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      if (!SEARCH_ID.test(id)) continue;
      let search = JSON.parse(await readFile(recordFile(id), 'utf8'));
      if (search.id !== id)
        throw new Error('Search record ID does not match its file');
      if (search.status === 'running' || search.running) {
        search = failSearch(
          search,
          {
            reason: 'interrupted',
            message: 'The server stopped before the search finished.',
          },
          new Date(now()).toISOString(),
        );
        await writeAtomic(recordFile(id), search);
      }
      records.set(id, search);
    }
    await writeIndex();
  }

  let tail = Promise.resolve();
  function serialize(operation) {
    const result = tail.then(async () => {
      initialized ??= initialize();
      await initialized;
      return operation();
    });
    tail = result.catch(() => {});
    return result;
  }

  return {
    ready: () => serialize(() => {}),
    list: () =>
      serialize(() =>
        [...records.values()].map((search) => structuredClone(search)),
      ),
    get: (id) => serialize(() => structuredClone(records.get(id))),
    transact: (change) =>
      serialize(async () => {
        const next = await change(structuredClone(records));
        if (!next) return null;
        if (!SEARCH_ID.test(next.id)) throw new TypeError('Invalid search ID');
        if (next.deleted) {
          await rm(recordFile(next.id), { force: true });
          records.delete(next.id);
        } else {
          await writeAtomic(recordFile(next.id), next);
          records.set(next.id, structuredClone(next));
        }
        // The records are authoritative. If this write fails, the next change
        // or server startup rebuilds the derived index from those records.
        await writeIndex().catch((error) =>
          logger.warn?.('[searches] Could not write index', error),
        );
        return next;
      }),
  };
}
