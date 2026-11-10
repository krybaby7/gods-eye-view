import { readResponseTextCapped } from '../../common/http.js';
import { fetchResponse } from './common.js';
import { columnIndices, csvRows } from './csv.js';

export const FRED_SERIES = ['MCOILBRENTEU', 'MCOILWTICO', 'PNGASEUUSDM'];
const URL =
  'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + FRED_SERIES.join(',');

export function parseFred(csv) {
  const rows = csvRows(csv);
  const indices = columnIndices(rows.next().value, [
    'observation_date',
    ...FRED_SERIES,
  ]);
  const result = Object.fromEntries(FRED_SERIES.map((id) => [id, new Map()]));
  for (const row of rows) {
    const date = row[indices[0]];
    if (!/^\d{4}-\d{2}-01$/.test(date ?? '')) continue;
    for (const [index, id] of FRED_SERIES.entries()) {
      const text = row[indices[index + 1]];
      const value = Number(text);
      if (text?.trim() && Number.isFinite(value))
        result[id].set(date.slice(0, 7), value);
    }
  }
  return Object.fromEntries(
    FRED_SERIES.map((id) => [
      id,
      [...result[id]]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-24)
        .map(([month, value]) => ({ month, value })),
    ]),
  );
}

export function shouldCheck({ lastCheckedAt, now }) {
  const last = Date.parse(lastCheckedAt);
  return (
    !Number.isFinite(last) ||
    Math.floor(last / 86_400_000) < Math.floor(+now / 86_400_000)
  );
}

export async function fetchObservations({ fetchImpl, now }) {
  const signal = AbortSignal.timeout(25_000);
  const response = await fetchResponse(fetchImpl, URL, signal);
  const series = parseFred(
    await readResponseTextCapped(response, 250_000, signal),
  );
  const count = Object.values(series).reduce(
    (total, values) => total + values.length,
    0,
  );
  if (!count) throw new Error('FRED returned no monthly energy prices');
  return {
    data: { series, checkedAt: now.toISOString() },
    count,
    unit: 'monthly price',
  };
}
