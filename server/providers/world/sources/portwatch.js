import { readResponseJsonCapped } from '../../common/http.js';
import { fetchResponse } from './common.js';

const BASE =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/';
const METADATA = 'PortWatch_chokepoints_database';
const TRAFFIC = 'Daily_Chokepoints_Data';
const DISRUPTIONS = 'portwatch_disruptions_database';
const MAX_PAGE = 1000;
const HISTORY_DAYS = 400;
const REVISION_DAYS = 14;
const PRIOR_WEEK_OFFSET = 364;
const WEEK = 7;
const LOW_STREAK = 7;
const TYPES = {
  total: 'n_total',
  tanker: 'n_tanker',
  container: 'n_container',
  dryBulk: 'n_dry_bulk',
  generalCargo: 'n_general_cargo',
  roro: 'n_roro',
  cargo: 'n_cargo',
};

export function shiftDay(day, days) {
  return new Date(Date.parse(day) + 86_400_000 * days)
    .toISOString()
    .slice(0, 10);
}

function dayFrom(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date.toISOString().slice(0, 10) : null;
}

function windowSum(dayCounts, end, length) {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const value = dayCounts.get(shiftDay(end, -i));
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  return sum;
}

function eventOpenOn(event, date) {
  return event.from <= date && (!event.to || event.to >= date);
}

function trafficStats(dayCounts, end, length) {
  const sum = windowSum(dayCounts, end, length);
  // 52 weeks preserves weekdays in both windows.
  const baseline = windowSum(
    dayCounts,
    shiftDay(end, -PRIOR_WEEK_OFFSET),
    length,
  );
  return {
    mean: sum === null ? null : sum / length,
    baseline: baseline === null ? null : baseline / length,
    ratio: sum !== null && baseline > 0 ? sum / baseline : null,
  };
}

function revisedHistory(previous, current, dataTo) {
  if (!previous?.length || !current.length) return current;
  // Replacing an older status requires a full baseline window and low streak.
  const oldest = shiftDay(dataTo, 1 - HISTORY_DAYS);
  const cutoff = shiftDay(
    oldest,
    PRIOR_WEEK_OFFSET + WEEK - 1 + LOW_STREAK - 1,
  );
  const retained = previous.filter(
    ({ date }) => date >= oldest && date < cutoff,
  );
  if (!retained.length) return current;
  const recalculated = current.filter(({ date }) => date >= cutoff);
  const before = current.findLast(({ date }) => date < cutoff);
  if (before && recalculated[0]?.date !== cutoff) {
    recalculated.unshift({ date: cutoff, status: before.status });
  }
  return [...retained, ...recalculated].filter(
    (item, i, all) => !i || item.status !== all[i - 1].status,
  );
}

export function buildPortWatch({
  metadata,
  days,
  events,
  dataTo,
  previousGates = [],
}) {
  const earlier = new Map(previousGates.map((gate) => [gate.id, gate.history]));
  const byGate = new Map(metadata.map(({ id }) => [id, []]));
  for (const row of days) byGate.get(row.id)?.push(row);
  const gates = metadata.map((gate) => {
    const series = byGate
      .get(gate.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    const counts = new Map(
      series.map(({ date, counts }) => [date, counts.total]),
    );
    const gateEvents = events.filter((event) => event.gates.includes(gate.id));
    let lowStreak = 0;
    let previous;
    let stats7 = { mean: null, baseline: null, ratio: null };
    const history = [];
    for (
      let date = series[0]?.date;
      date && date <= dataTo;
      date = shiftDay(date, 1)
    ) {
      stats7 = trafficStats(counts, date, WEEK);
      const { ratio } = stats7;
      lowStreak = ratio !== null && ratio < 0.5 ? lowStreak + 1 : 0;
      const open = gateEvents.some((event) => eventOpenOn(event, date));
      const status =
        ratio === null
          ? 'unknown'
          : lowStreak < LOW_STREAK
            ? 'normal'
            : open
              ? 'disrupted'
              : 'reduced';
      if (status !== previous) history.push({ date, status });
      previous = status;
    }
    const stats28 = dataTo
      ? trafficStats(counts, dataTo, 28)
      : { mean: null, baseline: null, ratio: null };
    return {
      ...gate,
      days: series,
      status: previous ?? 'unknown',
      history: revisedHistory(earlier.get(gate.id), history, dataTo),
      mean7: stats7.mean,
      baseline7: stats7.baseline,
      ratio7: stats7.ratio,
      mean28: stats28.mean,
      baseline28: stats28.baseline,
      ratio28: stats28.ratio,
      events: gateEvents.filter((event) => eventOpenOn(event, dataTo)),
    };
  });
  return { mode: 'live', dataTo, gates };
}

async function query(fetchImpl, layer, parameters) {
  const url = new URL(BASE + layer + '/FeatureServer/0/query');
  url.search = new URLSearchParams({
    ...parameters,
    f: 'json',
    returnGeometry: 'false',
  });
  const signal = AbortSignal.timeout(25_000);
  const response = await fetchResponse(fetchImpl, url, signal);
  const result = await readResponseJsonCapped(response, 2_000_000, signal);
  if (!Array.isArray(result?.features) || result.error) {
    throw new Error(
      `Unexpected PortWatch response for ${layer}: ${result?.error?.message ?? 'missing features'}`,
    );
  }
  return result;
}

async function paged(fetchImpl, layer, parameters) {
  const rows = [];
  let offset = 0;
  do {
    const result = await query(fetchImpl, layer, {
      ...parameters,
      resultRecordCount: MAX_PAGE,
      resultOffset: offset,
    });
    for (const { attributes } of result.features) rows.push(attributes);
    if (!result.exceededTransferLimit) return rows;
    offset += result.features.length;
    if (!result.features.length || offset > 15_000)
      throw new Error(`Unexpected PortWatch pagination for ${layer}`);
  } while (true);
}

function trafficRow(row) {
  return {
    id: row.portid,
    date: dayFrom(row.date),
    counts: Object.fromEntries(
      Object.entries(TYPES).map(([label, field]) => [
        label,
        Number.isInteger(row[field]) && row[field] >= 0 ? row[field] : null,
      ]),
    ),
  };
}

function eventRow(row) {
  return {
    id: String(row.eventid),
    name: row.eventname,
    from: dayFrom(row.fromdate),
    to: dayFrom(row.todate),
    gates: (
      String(row.affectedports ?? '').match(/\bchokepoint\d+\b/gi) ?? []
    ).map((id) => id.toLowerCase()),
  };
}

export function createPortWatchAdapter(
  hasPermission = () => process.env.GEV_WORLD_PORTWATCH_BULK_OK === '1',
) {
  return {
    shouldCheck: () => true,
    async fetchObservations({ fetchImpl, data }) {
      if (!hasPermission()) {
        return {
          count: 0,
          unit: 'transit day',
          detail: 'PortWatch automated extraction requires owner permission',
          ...(data?.mode === 'live'
            ? {}
            : {
                data: { mode: 'permission-required', gates: [], dataTo: null },
              }),
        };
      }
      const metadata = data?.gates?.length
        ? data.gates.map(({ id, name, coordinates }) => ({
            id,
            name,
            coordinates,
          }))
        : (
            await paged(fetchImpl, METADATA, {
              where: '1=1',
              orderByFields: 'portid ASC',
              outFields: 'portid,portname,lon,lat',
            })
          )
            .filter(
              ({ portid, portname, lon, lat }) =>
                /^chokepoint\d+$/.test(portid) &&
                portname &&
                Number.isFinite(lon) &&
                Number.isFinite(lat),
            )
            .map(({ portid, portname, lon, lat }) => ({
              id: portid,
              name: portname,
              coordinates: [lon, lat],
            }));
      if (!metadata.length)
        throw new Error('PortWatch returned no chokepoint metadata');

      const latest = await query(fetchImpl, TRAFFIC, {
        where: '1=1',
        outStatistics: JSON.stringify([
          {
            statisticType: 'max',
            onStatisticField: 'date',
            outStatisticFieldName: 'maxd',
          },
        ]),
      });
      const dataTo = dayFrom(latest.features[0]?.attributes?.maxd);
      if (!dataTo || (data?.dataTo && dataTo < data.dataTo))
        throw new Error(
          'PortWatch latest transit date is unavailable or older than cache',
        );
      const oldest = shiftDay(dataTo, 1 - HISTORY_DAYS);
      const revision = data?.dataTo && shiftDay(data.dataTo, 1 - REVISION_DAYS);
      const start = revision && revision > oldest ? revision : oldest;
      const received = (
        await paged(fetchImpl, TRAFFIC, {
          where: `date >= DATE '${start}' AND date <= DATE '${dataTo}'`,
          orderByFields: 'date ASC, portid ASC',
          outFields: ['date', 'portid', ...Object.values(TYPES)].join(','),
        })
      )
        .map(trafficRow)
        .filter(
          (row) =>
            row.date >= start &&
            row.date <= dataTo &&
            row.counts.total !== null,
        );
      if (!received.some((row) => row.date === dataTo))
        throw new Error(
          'PortWatch traffic did not include the latest reported day',
        );
      const days = new Map();
      for (const gate of data?.gates ?? []) {
        for (const row of gate.days ?? []) {
          if (row.date >= oldest && row.date < start)
            days.set(row.id + row.date, row);
        }
      }
      for (const row of received) days.set(row.id + row.date, row);
      const events = (
        await paged(fetchImpl, DISRUPTIONS, {
          where: '1=1',
          outFields: 'eventid,eventname,fromdate,todate,affectedports',
          orderByFields: 'eventid ASC',
        })
      )
        .map(eventRow)
        .filter(({ from, gates }) => from && gates.length);
      const next = buildPortWatch({
        metadata,
        days: [...days.values()],
        events,
        dataTo,
        previousGates: data?.gates,
      });
      const previous = new Map(
        data?.gates?.map(({ id, status }) => [id, status]),
      );
      return {
        data: next,
        count: received.length,
        unit: 'transit day',
        detail: `Data to ${dataTo} · transformed from IMF PortWatch transit calls`,
        changes: next.gates
          .filter(
            ({ id, status }) => previous.has(id) && previous.get(id) !== status,
          )
          .map(({ name, status }) => ({
            iso3: null,
            text: `${name} · ${status}`,
          })),
      };
    },
  };
}

export const portwatch = createPortWatchAdapter();
