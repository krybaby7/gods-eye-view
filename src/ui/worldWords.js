// Words for the board's numbers. Code writes every sentence from stored
// values; nothing here guesses a value, a direction or a cause.

export const BANDS = [
  [80, 'Strong'],
  [60, 'Solid'],
  [40, 'Midrange'],
  [20, 'Weak'],
  [0, 'Very weak'],
];

// How one country compares with another on each figure, said in its own
// terms. The higher score is always the first phrase.
const COMPARISONS = {
  'economy.gdp_ppp': ['A larger economy', 'A smaller economy'],
  'fiscal.reserves': ['Larger reserves', 'Smaller reserves'],
  'government.effectiveness': [
    'More effective government',
    'Less effective government',
  ],
  'people.life_expectancy': [
    'Longer life expectancy',
    'Shorter life expectancy',
  ],
  'society.rule_of_law': ['Stronger rule of law', 'Weaker rule of law'],
  'military.expenditure': [
    'Higher military spending',
    'Lower military spending',
  ],
  'energy.net_imports_pct': [
    'Less reliant on energy imports',
    'More reliant on energy imports',
  ],
  'food.undernourishment': ['Less undernourishment', 'More undernourishment'],
  'infrastructure.logistics': ['Better logistics', 'Weaker logistics'],
  'technology.internet_use': ['Wider internet use', 'Narrower internet use'],
  'diplomacy.trade_pct': ['More open to trade', 'Less open to trade'],
  'culture.ip_receipts': [
    'Higher earnings from intellectual property',
    'Lower earnings from intellectual property',
  ],
  'condition.stability': ['More politically stable', 'Less politically stable'],
  'condition.conflict_deaths': [
    'Fewer conflict deaths for its population',
    'More conflict deaths for its population',
  ],
  'condition.immunisation': ['Higher immunisation', 'Lower immunisation'],
  'condition.inflation': ['Lower inflation', 'Higher inflation'],
  'condition.debt': ['Lower public debt', 'Higher public debt'],
  'condition.polarisation': ['Less polarised', 'More polarised'],
};

const BARE_UNITS = new Set(['score (0–100)', 'index', 'interval score']);
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const YEAR_MS = 365.25 * 86_400_000;
const plain = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const large = new Intl.NumberFormat('en-GB', {
  notation: 'compact',
  compactDisplay: 'long',
  maximumFractionDigits: 1,
});

// The band of the score as shown: a score is shown rounded, so it is banded
// rounded too, and 19.6 shown as 20 reads Weak, never Very weak.
export function bandWord(score) {
  if (!Number.isFinite(score)) return 'Unknown';
  const shown = Math.round(score);
  return BANDS.find(([floor]) => shown >= floor)?.[1] ?? 'Very weak';
}

export function periodText(period) {
  if (typeof period !== 'string') return null;
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (day) return `${Number(day[3])} ${MONTHS[Number(day[2]) - 1]} ${day[1]}`;
  return period;
}

function periodEnd(period) {
  if (/^\d{4}$/.test(period)) return Date.UTC(Number(period), 11, 31);
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) return Date.UTC(Number(month[1]), Number(month[2]), 0);
  return Date.parse(`${period}T00:00:00Z`);
}

export function figureText(value, unit) {
  if (!Number.isFinite(value)) return null;
  const number =
    Math.abs(value) >= 1e6 ? large.format(value) : plain.format(value);
  const signed = number.replace(/^-/, '−');
  if (!unit || BARE_UNITS.has(unit)) return signed;
  if (unit.startsWith('%')) return signed + unit;
  return `${signed} ${unit}`;
}

// The kind of claim a value is: a measurement, the source's own estimate or
// a forecast (Appendix D, three edges for a claim).
export function claimKind({ score, method, stale } = {}) {
  if (!Number.isFinite(score))
    return { kind: 'unknown', label: 'unknown', stale: false };
  const kind =
    method === 'source-forecast'
      ? 'forecast'
      : method === 'source-estimate'
        ? 'estimate'
        : 'measured';
  const label = {
    measured: null,
    estimate: "the source's own estimate",
    forecast: 'forecast',
  }[kind];
  return { kind, label, stale: Boolean(stale) };
}

export function rowCaption({ period, source, score, method, stale }) {
  const kind = claimKind({ score, method, stale });
  if (kind.kind === 'unknown')
    return [periodText(period) ?? 'No published period', source, 'unknown']
      .filter(Boolean)
      .join(' · ');
  return [
    periodText(period) ?? 'No published period',
    source,
    kind.label,
    kind.stale && 'stale',
  ]
    .filter(Boolean)
    .join(' · ');
}

function anchorValue(indicator, anchor) {
  if (indicator.transform === 'log10') return 10 ** anchor;
  if (indicator.transform === 'log10p1') return 10 ** anchor - 1;
  return anchor;
}

// One sentence on what the number means, built from the stored value and the
// indicator's published scale.
export function meaningSentence(indicator, entry = {}) {
  const label = indicator.label;
  const value = entry.observation?.value;
  if (!Number.isFinite(entry.score)) {
    return Number.isFinite(value)
      ? `Too few of this area's figures are published to score it, so it is shown as unknown, never as low.`
      : `No published value is held for ${label.toLowerCase()}, so the bar is hatched and is not counted as low.`;
  }
  const kind = claimKind({
    score: entry.score,
    method: entry.observation?.method,
    stale: entry.stale,
  });
  const period = periodText(entry.period);
  const figure = figureText(value, indicator.unit);
  const a = anchorValue(indicator, indicator.anchors.a);
  const b = anchorValue(indicator, indicator.anchors.b);
  const worse = indicator.direction === 'higher-is-worse';
  const [zero, hundred] = worse ? [b, a] : [a, b];
  const scale =
    `on the board's scale ${figureText(zero, indicator.unit)} or ` +
    `${worse ? 'more' : 'less'} scores 0 and ` +
    `${figureText(hundred, indicator.unit)} or ${worse ? 'less' : 'more'} scores 100`;
  // A forecast and a source's own estimate never read as a measurement.
  const kindWords = {
    forecast: ' on a forecast by the source',
    estimate: " on the source's own estimate",
  };
  let reading;
  if (figure === null)
    reading = `${label} scores ${Math.round(entry.score)} of 100${kindWords[kind.kind] ?? ''}`;
  else if (kind.kind === 'forecast')
    reading = `${label} is forecast by the source at ${figure}${period ? ` for ${period}` : ''}`;
  else if (kind.kind === 'estimate')
    reading = `${label} is estimated by the source at ${figure}${period ? ` for ${period}` : ''}`;
  else reading = `${label} was ${figure}${period ? ` in ${period}` : ''}`;
  return `${reading}${kind.stale ? ', now stale' : ''}; ${scale}.`;
}

function slotScore(country, slot) {
  const score = country?.slots?.[slot]?.score;
  return Number.isFinite(score) ? score : null;
}

// Rank against every other state with a score for the same slot.
export function worldComparison(snapshot, indicator, iso3) {
  const countries = snapshot.countries ?? {};
  const score = slotScore(countries[iso3], indicator.slot);
  if (score === null)
    return {
      sentence: 'Unknown here, so it is not ranked against other countries.',
      position: null,
    };
  const others = Object.entries(countries)
    .filter(
      ([id, country]) =>
        id !== iso3 &&
        country?.kind === 'state' &&
        slotScore(country, indicator.slot) !== null,
    )
    .map(([, country]) => slotScore(country, indicator.slot));
  if (!others.length)
    return {
      sentence: 'No other country has a figure to compare with.',
      position: null,
    };
  const below = others.filter((other) => other < score).length;
  const above = others.filter((other) => other > score).length;
  const [better, worse] = COMPARISONS[indicator.id] ?? [
    'Scores higher',
    'Scores lower',
  ];
  const total = `of the ${others.length} other ${others.length === 1 ? 'country' : 'countries'} with a figure`;
  const level = others.length - below - above;
  const sentence =
    below === 0 && above === 0
      ? `Level with all ${others.length} other ${others.length === 1 ? 'country' : 'countries'} with a figure.`
      : (below >= above
          ? `${better} than ${below} ${total}`
          : `${worse} than ${above} ${total}`) +
        (level ? `, and level with ${level}.` : '.');
  return { sentence, position: below / others.length };
}

const NO_HISTORY = 'Earlier years are not stored yet, so no trend is drawn.';

// A trend only from stored periods. Without two of them, it says so.
export function trendReading(entry = {}, figures = 1) {
  if (!Number.isFinite(entry.score))
    return { sentence: 'Unknown now, so no trend is drawn.', change: null };
  const history = Array.isArray(entry.history)
    ? entry.history.filter(
        ({ period, score }) =>
          Number.isFinite(score) && Number.isFinite(periodEnd(period)),
      )
    : [];
  if (history.length < 2) {
    return {
      sentence:
        figures > 1
          ? 'This area combines several figures, so no trend is drawn.'
          : NO_HISTORY,
      change: null,
    };
  }
  const first = history[0];
  const last = history.at(-1);
  // The change is worked out from the two numbers the sentence shows.
  const then = Math.round(first.score);
  const now = Math.round(last.score);
  const points = now - then;
  const rounded = Math.abs(points);
  const years = (periodEnd(last.period) - periodEnd(first.period)) / YEAR_MS;
  const since = periodText(first.period);
  const span = `(${then} then, ${now} now), across ${history.length} stored periods.`;
  let sentence =
    rounded < 1
      ? `About level since ${since} ${span}`
      : `${rounded} ${rounded === 1 ? 'point' : 'points'} ${points > 0 ? 'better' : 'worse'} than in ${since} ${span}`;
  if (last.method === 'source-forecast')
    sentence += ' The latest figure is a forecast by the source.';
  else if (last.method === 'source-estimate')
    sentence += " The latest figure is the source's own estimate.";
  if (
    history
      .slice(0, -1)
      .some(({ method }) =>
        ['source-forecast', 'source-estimate'].includes(method),
      )
  )
    sentence += ' Some earlier figures are estimates or forecasts.';
  return {
    sentence,
    change: {
      points,
      since: first.period,
      perYear: years > 0 ? points / years : null,
    },
  };
}

// Every word for one score.
export function scoreWords(snapshot, indicator, iso3) {
  const entry = snapshot.countries?.[iso3]?.slots?.[indicator.slot] ?? {};
  const figures = (snapshot.indicators ?? []).filter(
    ({ slot }) => slot === indicator.slot,
  ).length;
  const score = Number.isFinite(entry.score) ? entry.score : null;
  return {
    band: bandWord(score),
    kind: claimKind({
      score,
      method: entry.observation?.method,
      stale: entry.stale,
    }),
    meaning: meaningSentence(indicator, { ...entry, score }),
    world: worldComparison(snapshot, indicator, iso3),
    trend: trendReading({ ...entry, score }, figures),
  };
}

function claimOf(row) {
  return row.words?.kind?.kind ?? 'measured';
}

// Says in words when a named score is a forecast or the source's estimate.
function claimNote(rows) {
  const kinds = new Set(rows.map(claimOf));
  const notes = [
    kinds.has('forecast') && 'a forecast',
    kinds.has('estimate') && "the source's own estimate",
  ].filter(Boolean);
  if (!notes.length) return '';
  return rows.length === 1
    ? ` (${notes[0]})`
    : ` (${notes.join(' and ')} among them)`;
}

function names(rows) {
  const list = rows.map(({ area }) => area.toLowerCase());
  return list.length < 3
    ? list.join(' and ')
    : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

// The three things that stand out: strongest, weakest and moving fastest.
export function standouts(rows) {
  const known = rows.filter((row) => Number.isFinite(row.score));
  if (!known.length)
    return {
      sentence: 'No area has a published score yet, so nothing stands out.',
      target: null,
    };
  const top = Math.max(...known.map(({ score }) => Math.round(score)));
  const bottom = Math.min(...known.map(({ score }) => Math.round(score)));
  const strongest = known.filter(({ score }) => Math.round(score) === top);
  const weakest = known.filter(({ score }) => Math.round(score) === bottom);
  const parts = [
    `Strongest: ${names(strongest)}, ${bandWord(top).toLowerCase()} at ${top}${claimNote(strongest)}.`,
    top === bottom
      ? 'Every published score is the same, so none is weakest.'
      : `Weakest: ${names(weakest)}, ${bandWord(bottom).toLowerCase()} at ${bottom}${claimNote(weakest)}.`,
  ];
  const named = top === bottom ? strongest : [...strongest, ...weakest];
  const withTrend = known.filter(({ words }) =>
    Number.isFinite(words?.trend?.change?.points),
  );
  // Only an area that moved a whole point or more can be the fastest.
  const moved = withTrend
    .filter(
      ({ words }) =>
        Math.abs(words.trend.change.points) >= 1 &&
        Number.isFinite(words.trend.change.perYear),
    )
    .sort(
      (a, b) =>
        Math.abs(b.words.trend.change.perYear) -
        Math.abs(a.words.trend.change.perYear),
    );
  const fastest = moved[0];
  if (!fastest) {
    parts.push(
      withTrend.length
        ? 'No area has moved by a point or more across its stored periods.'
        : 'No area has two stored periods yet, so none is picked as moving fastest.',
    );
  } else {
    const { points, since } = fastest.words.trend.change;
    const rounded = Math.round(Math.abs(points));
    parts.push(
      `Moving fastest: ${fastest.area.toLowerCase()}, ${rounded} ${rounded === 1 ? 'point' : 'points'} ${points > 0 ? 'better' : 'worse'} than in ${periodText(since)}.`,
    );
  }
  return {
    sentence: parts.join(' '),
    target: weakest[0].section,
    kind: named.some((row) => claimOf(row) !== 'measured')
      ? 'estimate'
      : 'measured',
  };
}
