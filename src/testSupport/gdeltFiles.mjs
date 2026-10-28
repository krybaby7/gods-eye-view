/** Doubles for GDELT's 15-minute GKG files on data.gdeltproject.org. */
import { zipOneEntry } from './zipFixture.mjs';

/**
 * A GKG 2.1 file of synthetic rows: 27 tab-separated columns, the title in
 * the extras XML. A `null` title leaves the extras empty.
 * @param {string} stamp
 * @param {Array<[string, ?string]>} rows `[url, title]`
 */
export function gkgFile(stamp, rows) {
  return rows
    .map(([url, title], index) =>
      [
        `${stamp}-${index}`,
        stamp,
        '1',
        new URL(url).hostname.replace(/^www\./, ''),
        url,
        ...Array(21).fill(''),
        title === null ? '' : `<PAGE_TITLE>${title}</PAGE_TITLE>`,
      ].join('\t'),
    )
    .join('\n')
    .concat('\n');
}

/** The zipped GKG file as GDELT serves it. */
export function gkgZip(stamp, rows) {
  return zipOneEntry(`${stamp}.gkg.csv`, gkgFile(stamp, rows));
}

/** lastupdate.txt naming `stamp`, in GDELT's three-line layout. */
export function gdeltLastUpdate(stamp, gkgBytes = 6_957_885) {
  return [
    `82044 a2a3fc8e6acd5e128b281991fa69cfdd http://data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip`,
    `123746 a2a1d6e18f3a5b17d7657334b53b23a2 http://data.gdeltproject.org/gdeltv2/${stamp}.mentions.CSV.zip`,
    `${gkgBytes} 76ec9e7870e21c98a4f1d6ec3e2451c9 http://data.gdeltproject.org/gdeltv2/${stamp}.gkg.csv.zip`,
    '',
  ].join('\n');
}

/**
 * Answer a data.gdeltproject.org request: lastupdate.txt names
 * `state.latest`, and `state.files` maps stamps to zip bytes; anything else
 * is a 404. Every path read is pushed to `state.calls`.
 * @param {URL} url
 * @param {{latest: string, files: Record<string, Uint8Array>, declared?: number, lastUpdateStatus?: number, calls?: string[]}} state
 */
export function gdeltDataResponse(url, state) {
  state.calls ??= [];
  state.calls.push(url.pathname.replace('/gdeltv2/', ''));
  if (url.pathname === '/gdeltv2/lastupdate.txt')
    return state.lastUpdateStatus
      ? new Response('', { status: state.lastUpdateStatus })
      : new Response(gdeltLastUpdate(state.latest, state.declared));
  const stamp = /^\/gdeltv2\/(\d{14})\.gkg\.csv\.zip$/.exec(url.pathname)?.[1];
  const body = stamp && state.files[stamp];
  if (!body) return new Response('', { status: 404 });
  return new Response(body, { headers: { 'content-type': 'application/zip' } });
}
