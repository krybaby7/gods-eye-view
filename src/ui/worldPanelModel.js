export { worldLegend } from '../layers/world/lensRegistry.js';
import { rowCaption, scoreWords } from './worldWords.js';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function safeSourceUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function countryAt(snapshot, iso3) {
  return (
    snapshot.countries?.[iso3] ??
    snapshot.countryIndex?.find((country) => country.iso3 === iso3)
  );
}

function scoreOrUnknown(value) {
  return Number.isFinite(value) ? value : null;
}

function displayScore(score) {
  return `${Math.round(score)} / 100`;
}

function formatValue(value, unit) {
  const formatted = number.format(value);
  if (!unit || unit.startsWith('%')) return formatted + (unit ?? '');
  return `${formatted} ${unit}`;
}

function scoreFormula({ transform, direction, anchors: { a, b } }) {
  const input =
    { log10: 'log₁₀(x)', log10p1: 'log₁₀(1 + x)' }[transform] ?? 'x';
  const fraction = `clip((${input} − ${a}) ÷ (${b} − ${a}), 0, 1)`;
  const formula =
    direction === 'higher-is-worse'
      ? `100 × (1 − ${fraction})`
      : `100 × ${fraction}`;
  return transform === 'log10'
    ? `${formula}. Measured zero uses the lower log anchor (${a}), a draft rule.`
    : formula;
}

function rowFor(snapshot, country, indicator, source) {
  const entry = country.slots?.[indicator.slot];
  const observation = entry?.observation;
  const score = scoreOrUnknown(entry?.score);
  const flags = [];
  if (score === null) flags.push('Unknown');
  if (country.condition?.slot === indicator.slot) flags.push('Weakest');
  if (entry?.stale) flags.push('Stale');
  if (indicator.lowConfidence) flags.push('Low conf.');
  if (observation?.method === 'source-forecast') flags.push('Source forecast');
  const sourceName = source?.name ?? indicator.source;
  return {
    slot: indicator.slot,
    indicator: indicator.id,
    section: indicator.section,
    area: indicator.area,
    score,
    flags,
    measure: indicator.label,
    value: Number.isFinite(observation?.value)
      ? formatValue(observation.value, indicator.unit)
      : null,
    rawValue: observation?.value ?? null,
    period: entry?.period ?? null,
    retrievedAt: observation?.retrievedAt ?? null,
    sourceVersion: observation?.sourceVersion ?? null,
    source: sourceName,
    caption: rowCaption({
      period: entry?.period ?? null,
      source: sourceName,
      score,
      method: observation?.method,
      stale: entry?.stale,
    }),
    words: scoreWords(snapshot, indicator, country.iso3),
    sourceUrl: safeSourceUrl(observation?.url) ?? safeSourceUrl(source?.url),
    sourceCode: indicator.sourceCode,
    formula: scoreFormula(indicator),
    draft: indicator.draft === true,
  };
}

export function countrySheet(snapshot, iso3) {
  const country = countryAt(snapshot, iso3);
  if (!country) return null;
  const indicators = snapshot.indicators ?? [];
  const sources = new Map(
    (snapshot.sources ?? []).map((source) => [source.id, source]),
  );
  const coverage = country.coverage ?? { known: 0, total: indicators.length };
  return {
    iso3,
    name: country.name ?? iso3,
    disputed: country.kind === 'disputed',
    condition: {
      score: scoreOrUnknown(country.condition?.score),
      label:
        indicators.find(({ slot }) => slot === country.condition?.slot)
          ?.shortLabel ?? 'Condition',
    },
    coverage:
      `${coverage.known} of ${coverage.total} indicators have a published value` +
      (country.retrievedAt
        ? ` · fetched ${country.retrievedAt.slice(0, 10)}`
        : ''),
    hasData: coverage.known > 0,
    rows: indicators.map((indicator) =>
      rowFor(
        snapshot,
        { ...country, iso3 },
        indicator,
        sources.get(indicator.source),
      ),
    ),
  };
}

export function describeWorldHover(snapshot, iso3) {
  const country = countryAt(snapshot, iso3);
  if (!country) return null;
  const name = country.name ?? iso3;
  if (country.kind === 'disputed')
    return { name, value: 'Unknown · disputed territory' };
  if (snapshot.lens === 'data-age') {
    if (!Number.isFinite(country.dataAge))
      return { name, value: 'Unknown · no annual observations' };
    const year = Number(snapshot.asOf?.slice(0, 4));
    const age = Math.max(0, year - country.dataAge);
    return {
      name,
      value:
        `Typical data year ${country.dataAge}` +
        (Number.isFinite(age)
          ? ` (${age} ${age === 1 ? 'year' : 'years'} old)`
          : ''),
    };
  }
  const strength = snapshot.lens === 'strength';
  const slot = strength ? snapshot.area : country.condition?.slot;
  const indicator = snapshot.indicators?.find(
    (indicator) => indicator.slot === slot,
  );
  const reading = country.slots?.[slot];
  const result = strength ? reading : country.condition;
  const label = indicator?.shortLabel ?? (strength ? 'Strength' : 'Condition');
  if (!Number.isFinite(result?.score))
    return { name, value: `${label} · Unknown` };
  const period = result.period
    ? ` (${result.period}${reading?.observation?.method === 'source-forecast' ? ', source forecast' : ''})`
    : '';
  return {
    name,
    value: `${strength ? '' : 'Weakest bar · '}${label} ${displayScore(result.score)}${period}`,
  };
}

export function worldTurn(turn, iso3) {
  if (!turn) return null;
  const changes = turn.changes ?? [];
  const countryCount = changes.filter((change) => change.iso3).length;
  const sources = changes.filter(
    (change) => !change.iso3 && change.text !== 'No country changes.',
  ).length;
  const summary =
    turn.number === 1
      ? `${turn.newObservations} observations loaded`
      : [
          `${countryCount} ${countryCount === 1 ? 'country' : 'countries'} changed`,
          sources
            ? `${sources} source ${sources === 1 ? 'notice' : 'notices'}`
            : '',
        ]
          .filter(Boolean)
          .join(' · ');
  return {
    label: `Turn ${turn.number}`,
    summary,
    changes: changes
      .filter((change) => !iso3 || !change.iso3 || change.iso3 === iso3)
      .map(({ text }) => text),
  };
}
