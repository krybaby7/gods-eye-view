import { conditionFlag, conditionResult } from '../conditionEvents.js';
import {
  countryIds,
  dateOf,
  DAY,
  download,
  due,
  HOUR,
} from './liveFeedCommon.js';

const SOURCE = 'https://www.gdacs.org/xml/rss.xml';
const HAZARDS = {
  EQ: 'earthquake',
  TC: 'cyclone',
  FL: 'flood',
  VO: 'volcano',
  DR: 'drought',
  WF: 'wildfire',
  TS: 'tsunami',
};
const TAGS = {
  level: /<gdacs:alertlevel>\s*([^<]+)\s*<\/gdacs:alertlevel>/i,
  type: /<gdacs:eventtype>\s*([A-Z]+)\s*<\/gdacs:eventtype>/,
  id: /<gdacs:eventid>\s*(\d+)\s*<\/gdacs:eventid>/,
  date: /<pubDate>\s*([^<]+)\s*<\/pubDate>/i,
  modified: /<gdacs:datemodified>\s*([^<]+)\s*<\/gdacs:datemodified>/i,
};

export function gdacsFlags(xml, now, supported) {
  if (!/<rss(?:\s|>)/i.test(xml) || !/<\/rss>\s*$/i.test(xml))
    throw new Error('Unexpected GDACS RSS format');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  if (items.length !== [...xml.matchAll(/<item>/gi)].length)
    throw new Error('Incomplete GDACS RSS');
  const flags = new Map();
  for (const [, item] of items) {
    if (
      item.match(TAGS.level)?.[1]?.trim().toLowerCase() !== 'red' ||
      /<gdacs:iscurrent>\s*false\s*<\/gdacs:iscurrent>/i.test(item)
    )
      continue;
    const type = item.match(TAGS.type)?.[1];
    const eventId = item.match(TAGS.id)?.[1];
    const published = item.match(TAGS.date)?.[1];
    const date = dateOf(published);
    const modified = Date.parse(item.match(TAGS.modified)?.[1] ?? published);
    if (
      !type ||
      !eventId ||
      !date ||
      !Number.isFinite(modified) ||
      modified > +now ||
      +now - modified > 7 * DAY
    )
      continue;
    const codes =
      item.match(/<gdacs:iso3>\s*([^<]+)\s*<\/gdacs:iso3>/i)?.[1] ??
      item.match(/<gdacs:country[^>]*\biso3=["']([^"']+)["']/i)?.[1] ??
      '';
    const population = Number(
      item.match(/<gdacs:population[^>]*\bvalue=["'](\d+(?:\.\d+)?)["']/)?.[1],
    );
    for (const iso3 of codes
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter((id) => supported.has(id))) {
      const label =
        'Red GDACS ' +
        (HAZARDS[type] ?? 'disaster') +
        ' alert' +
        (population > 0
          ? ', ' +
            Math.round(population).toLocaleString('en-US') +
            ' people exposed'
          : '');
      const flag = conditionFlag('live-gdacs', {
        iso3,
        slot: 'C3',
        key: type + ':' + eventId,
        label,
        date,
        source:
          'https://www.gdacs.org/report.aspx?eventtype=' +
          type +
          '&eventid=' +
          eventId,
        sourceName: 'GDACS',
      });
      flags.set(flag.id, flag);
    }
  }
  return [...flags.values()];
}

export const gdacs = {
  live: true,
  shouldCheck: (context) => due(context, HOUR),
  async fetchObservations({ fetchImpl, now, data, registry }) {
    const xml = await download(fetchImpl, SOURCE, 'text');
    return conditionResult(
      gdacsFlags(xml, now, countryIds(registry)),
      data,
      now,
    );
  },
};
