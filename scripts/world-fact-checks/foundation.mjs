const source = 'https://github.com/krybaby7/gods-eye-view/pull/17';
const checkedOn = '2026-11-09';

export default async function checkFoundation({
  board,
  initial,
  measure,
  trace,
}) {
  const compressed = await measure('/api/world', 'gzip');
  const progress = await measure('/api/world/progress');
  const refreshRequests = trace?.refresh?.requests;
  const boardRequests = refreshRequests?.filter(
    ({ path }) => path === '/api/world',
  );
  const largeRequests = refreshRequests?.filter(
    ({ path, bytes }) => path !== '/api/world' && bytes > 1_000_000,
  );
  const progressRequests = refreshRequests?.filter(
    ({ path }) => path === '/api/world/progress',
  );
  const progressBytes = Math.max(
    progress.bytes,
    ...(progressRequests ?? []).map(({ rawBytes, bytes }) => rawBytes ?? bytes),
  );
  const sourceCount = board?.sources?.length;
  const firstBoardMs = trace?.firstBoardMs;
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
      firstBoardMs ?? 'No first-request measurement',
      firstBoardMs < 1_000,
    ],
    [
      'refresh-board-fetches',
      `At most ${sourceCount + 1} GETs (${sourceCount} sources + end)`,
      boardRequests?.length ?? 'No browser Refresh trace',
      Boolean(
        boardRequests?.length &&
        progressRequests?.length &&
        boardRequests.length <= sourceCount + 1,
      ),
    ],
    [
      'refresh-large-requests',
      'No response over 1,000,000 bytes except the board',
      largeRequests ?? 'No browser Refresh trace',
      Boolean(progressRequests?.length && !largeRequests.length),
    ],
  ];
  return rows.map(([id, expected, found, pass]) => ({
    id,
    expected,
    found,
    pass,
    source,
    checkedOn,
  }));
}
