import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

function liveBatches(state, restore) {
  const key = 'live-gdelt';
  const feed = state.features[key];
  if (!feed) return state;
  const { batches, compressedBatches, ...rest } = feed;
  if ((restore && !compressedBatches) || (!restore && !batches?.length))
    return state;
  const evidence = restore
    ? {
        batches: JSON.parse(
          gunzipSync(Buffer.from(compressedBatches, 'base64'), {
            maxOutputLength: 80_000_000,
          }),
        ),
      }
    : {
        compressedBatches: gzipSync(JSON.stringify(batches)).toString('base64'),
      };
  return {
    ...state,
    features: { ...state.features, [key]: { ...rest, ...evidence } },
  };
}

export function createWorldStore({ cacheDir = '.gev-cache' } = {}) {
  const directory = path.resolve(cacheDir, 'world');
  const file = path.join(directory, 'state.json');
  const liveFile = path.join(directory, 'live.json');

  async function read() {
    let state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { board: null, observations: [], turns: [], lastCheckedAt: {} };
    }
    if (
      state?.version !== 1 ||
      !state.board ||
      !Array.isArray(state.observations) ||
      !Array.isArray(state.turns) ||
      !state.lastCheckedAt
    ) {
      throw new Error('Unrecognized World Board state.');
    }
    return state;
  }

  async function readLive() {
    try {
      const live = JSON.parse(await readFile(liveFile, 'utf8'));
      if (live?.version !== 1 || !live.features || !live.sources)
        throw new Error('Unrecognized World Board live state.');
      return liveBatches(live, true);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function writeTo(destination, state) {
    const temp = destination + '.' + randomUUID() + '.tmp';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temp, JSON.stringify({ ...state, version: 1 }) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temp, destination);
    } finally {
      await rm(temp, { force: true });
    }
  }

  return {
    read,
    write: (state) => writeTo(file, state),
    readLive,
    writeLive: (state) => writeTo(liveFile, liveBatches(state, false)),
  };
}
