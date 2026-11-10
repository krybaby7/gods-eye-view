const source = 'https://github.com/krybaby7/gods-eye-view/pull/17';
const checkedOn = '2026-11-09';
const measured = (value) => Number.isFinite(value) && value >= 0;

export default async function checkFoundation({
  board,
  initial,
  measure,
  trace,
  traceReason,
}) {
  const compressed = await measure('/api/world', 'gzip');
  const progress = await measure('/api/world/progress');
  const requests = trace?.refresh?.requests;
  const refreshRequests =
    Array.isArray(requests) &&
    requests.every((request) => typeof request?.path === 'string')
      ? requests
      : null;
  const boardRequests = refreshRequests?.filter(
    ({ path, method = 'GET' }) => path === '/api/world' && method === 'GET',
  );
  const largeRequests = refreshRequests?.filter(
    ({ path, bytes }) => path !== '/api/world' && bytes > 1_000_000,
  );
  const progressRequests = refreshRequests?.filter(
    ({ path }) => path === '/api/world/progress',
  );
  const progressBytes = Math.max(
    progress.bytes,
    ...(progressRequests ?? [])
      .map(({ rawBytes, bytes }) => rawBytes ?? bytes)
      .filter(measured),
  );
  const sourceCount = board?.sources?.length;
  const firstBoardMs = trace?.firstBoardMs;
  const firstBoardReason =
    traceReason ?? 'Browser trace has no first cached board timing';
  const refreshReason =
    traceReason ?? 'Browser trace has no Refresh progress polls';
  const requestCountReason = !progressRequests?.length
    ? refreshReason
    : !measured(sourceCount)
      ? 'World Board API did not provide a source count'
      : null;
  const requestSizeReason = !progressRequests?.length
    ? refreshReason
    : refreshRequests.some(
          ({ path, bytes }) => path !== '/api/world' && !measured(bytes),
        )
      ? 'Browser Refresh trace is missing response sizes'
      : null;
  const rows = [
    [
      'board-raw-size',
      '< 4,000,000 bytes',
      initial?.rawBytes,
      initial?.rawBytes < 4_000_000,
    ],
    [
      'board-compressed-size',
      'gzip < 1,000,000 bytes',
      { encoding: compressed.encoding, bytes: compressed.bytes },
      compressed.encoding === 'gzip' && compressed.bytes < 1_000_000,
    ],
    ['progress-size', '< 20,000 bytes', progressBytes, progressBytes < 20_000],
    [
      'first-cached-board',
      '< 1,000 ms',
      measured(firstBoardMs) ? firstBoardMs : null,
      measured(firstBoardMs) ? firstBoardMs < 1_000 : null,
      firstBoardReason,
    ],
    [
      'refresh-board-fetches',
      measured(sourceCount)
        ? `At most ${sourceCount + 1} GETs (${sourceCount} sources + end)`
        : 'At most one GET per source plus one at the end',
      boardRequests?.length ?? null,
      requestCountReason
        ? null
        : boardRequests.length > 0 && boardRequests.length <= sourceCount + 1,
      requestCountReason,
    ],
    [
      'refresh-large-requests',
      'No response over 1,000,000 bytes except the board',
      largeRequests ?? null,
      requestSizeReason ? null : !largeRequests.length,
      requestSizeReason,
    ],
  ];
  return rows.map(([id, expected, found, pass, reason]) => ({
    id,
    expected,
    found,
    pass,
    ...(pass === null && { reason }),
    source,
    checkedOn,
  }));
}
