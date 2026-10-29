import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Outlets a test registry keeps on the `gdelt-domain` transport. Since
 * 2026-10-29 the live registry reaches no outlet through GDELT (GDELT
 * indexes none of them), so GDELT tests use this copy instead of depending
 * on which outlets the live registry routes there.
 */
export const TEST_GDELT_DOMAINS = Object.freeze({
  reuters: 'reuters.com',
  apnews: 'apnews.com',
  timesofisrael: 'timesofisrael.com',
  centcom: 'centcom.mil',
});

/** Live sources with the test GDELT outlets switched to `gdelt-domain`. */
export function withTestGdeltSources(sources) {
  return sources.map((source) =>
    TEST_GDELT_DOMAINS[source.id]
      ? {
          ...source,
          transport: {
            type: 'gdelt-domain',
            domain: TEST_GDELT_DOMAINS[source.id],
          },
        }
      : source,
  );
}

/**
 * A temporary app root holding a copy of `public/news` whose registry keeps
 * the test GDELT outlets; removed when the test ends.
 * @param {import('node:test').TestContext} t
 */
export async function newsRootWithGdelt(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'gev-news-root-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const live = fileURLToPath(new URL('../../public/news/', import.meta.url));
  const target = path.join(root, 'public', 'news');
  await mkdir(target, { recursive: true });
  await cp(path.join(live, 'theaters'), path.join(target, 'theaters'), {
    recursive: true,
  });
  const doc = JSON.parse(
    await readFile(path.join(live, 'sources.json'), 'utf8'),
  );
  doc.sources = withTestGdeltSources(doc.sources);
  await writeFile(path.join(target, 'sources.json'), JSON.stringify(doc));
  return root;
}
