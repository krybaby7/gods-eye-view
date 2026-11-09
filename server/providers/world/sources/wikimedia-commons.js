import { readResponseJsonCapped } from '../../../../src/sources/httpBody.js';
import { feedFieldText } from '../../common/rss.js';
import { actorSourceDue, fetchActorSource, safeHttps } from './actor-fetch.js';

const ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const BATCH_SIZE = 35;
const FREE_LICENCE =
  /^(?:CC (?:BY(?:-SA)?|0)(?: \d+(?:\.\d+)?(?: [a-z]+)?)?|public domain|PDM(?: 1\.0)?)$/i;

export const shouldCheck = (context) => actorSourceDue(context, 7 * 24);

export function commonsMetadataUrl(files) {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '120',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
    redirects: '1',
    titles: files.map((file) => 'File:' + file).join('|'),
  });
  return url.href;
}

function portraitAt(info) {
  const thumbnail = safeHttps(info?.thumburl);
  const file = safeHttps(info?.descriptionurl);
  const metadata = info?.extmetadata;
  const author = feedFieldText(metadata?.Artist?.value).slice(0, 360);
  const licence = feedFieldText(metadata?.LicenseShortName?.value);
  if (!thumbnail || !file || !author || !FREE_LICENCE.test(licence))
    return null;
  const image = new URL(thumbnail);
  const page = new URL(file);
  if (
    !['https://upload.wikimedia.org', 'https://thumb.wikimedia.org'].includes(
      image.origin,
    ) ||
    !image.pathname.startsWith('/wikipedia/commons/thumb/') ||
    page.hostname !== 'commons.wikimedia.org' ||
    !page.pathname.startsWith('/wiki/File:')
  )
    return null;
  return {
    thumbnail,
    file,
    licence,
    licenceUrl: safeHttps(metadata?.LicenseUrl?.value),
    author,
  };
}

export async function fetchObservations({ fetchImpl, features, now, data }) {
  const actors = features.wikidata?.actors;
  if (!actors) return { count: 0, unit: 'portrait' };
  const files = [
    ...new Set(
      actors
        .map(({ imageFile }) => imageFile)
        .filter((file) => file && !file.includes('|')),
    ),
  ];
  const portraits = Object.fromEntries(
    files
      .filter((file) => Object.hasOwn(data?.portraits ?? {}, file))
      .map((file) => [file, data.portraits[file]]),
  );
  let count = 0;
  let error;
  let retryAt;
  for (let offset = 0; offset < files.length; offset += BATCH_SIZE) {
    const batch = files.slice(offset, offset + BATCH_SIZE);
    try {
      const response = await fetchActorSource(
        fetchImpl,
        commonsMetadataUrl(batch),
        now,
      );
      const payload = await readResponseJsonCapped(response, 3_000_000);
      if (!Array.isArray(payload.query?.pages))
        throw new Error('Invalid Commons image metadata');
      const pages = new Map(
        payload.query.pages.map((page) => [page.title, page]),
      );
      const aliases = new Map(
        [
          ...(payload.query.normalized ?? []),
          ...(payload.query.redirects ?? []),
        ].map(({ from, to }) => [from, to]),
      );
      for (const file of batch) {
        const original = 'File:' + file;
        const normalized = aliases.get(original) ?? original;
        const page = pages.get(aliases.get(normalized) ?? normalized);
        const portrait = portraitAt(page?.imageinfo?.[0]);
        delete portraits[file];
        if (portrait) {
          Object.defineProperty(portraits, file, {
            value: portrait,
            enumerable: true,
            configurable: true,
          });
          count += 1;
        }
      }
    } catch (failure) {
      error = failure.cause?.code ?? failure.message;
      retryAt = failure.retryAt;
      break;
    }
  }
  return { data: { portraits, retryAt }, count, unit: 'portrait', error };
}
