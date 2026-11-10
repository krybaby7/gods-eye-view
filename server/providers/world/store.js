import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createWorldStore({ cacheDir = '.gev-cache' } = {}) {
  const directory = path.resolve(cacheDir, 'world');
  const file = path.join(directory, 'state.json');

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

  async function write(state) {
    const temp = file + '.' + randomUUID() + '.tmp';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temp, JSON.stringify({ ...state, version: 1 }) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
  }

  return { read, write };
}
