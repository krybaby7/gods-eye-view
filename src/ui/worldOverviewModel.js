// The six lines of the Overview tab. Each line is written by code from what
// the board already holds and names the tab that carries its detail.
import {
  countryExposure,
  dependencyRows,
  energyGates,
  isMinorImporter,
} from '../layers/world/energy.js';
import { liveFlags, liveFlagStatus } from '../layers/world/events.js';
import { countryPeople } from '../layers/world/peopleModel.js';
import {
  classifyDiplomacy,
  currentRelations,
  relationPeers,
} from '../layers/world/relations.js';
import { bandWord, periodText, standouts } from './worldWords.js';

const percent = new Intl.NumberFormat('en-GB', {
  style: 'percent',
  maximumFractionDigits: 0,
});
const peopleSources = {
  wikidata: 'Wikidata',
  'cia-world-leaders': 'CIA World Leaders',
  official: 'Official office source',
};

function list(items) {
  if (items.length < 3) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function shortList(items, limit = 4) {
  if (items.length <= limit) return list(items);
  return `${items.slice(0, limit).join(', ')} and ${items.length - limit} more`;
}

export function conditionLine(sheetModel) {
  const bars = sheetModel.rows
    .filter(({ section }) => section === 'condition')
    .map((row) => ({
      slot: row.slot,
      name: row.area,
      score: row.score,
      band: bandWord(row.score),
      kind:
        row.words?.kind.kind ?? (row.score === null ? 'unknown' : 'measured'),
    }));
  const known = bars.filter(({ score }) => score !== null);
  const { score, label } = sheetModel.condition;
  const text =
    score === null
      ? `${known.length} of ${bars.length} bars have a figure, too few to name a weakest bar.`
      : `Weakest bar: ${label}, ${bandWord(score).toLowerCase()} at ${Math.round(score)}. ${known.length} of ${bars.length} bars have a figure.`;
  return {
    id: 'condition',
    title: 'Condition',
    text,
    target: 'condition',
    bars,
  };
}

function holderText(holders, role) {
  return holders
    .map(
      (actor) =>
        `${actor.name}, ${role}` +
        (actor.since ? ` since ${periodText(actor.since)}` : '') +
        (actor.acting ? ', acting' : ''),
    )
    .join('; ');
}

export function leadershipLine(snapshot, sheetModel) {
  const base = { id: 'leadership', title: 'Who runs it', target: 'people' };
  if (sheetModel.disputed)
    return {
      ...base,
      text: 'No government is recorded for a disputed territory.',
      target: null,
    };
  if (!snapshot.features?.wikidata?.actors)
    return { ...base, text: 'Officeholders are not loaded yet.' };
  const actors = countryPeople(snapshot, sheetModel.iso3);
  const state = actors.filter(({ role }) => role === 'head-of-state');
  const executive = actors.filter(({ role }) => role === 'head-of-government');
  if (!state.length && !executive.length)
    return {
      ...base,
      text: 'No head of state or government is recorded in the loaded sources.',
    };
  const shared =
    state.length === 1 &&
    executive.length === 1 &&
    state[0].id === executive[0].id;
  const parts = shared
    ? [holderText(state, 'head of state and government')]
    : [
        executive.length
          ? holderText(executive, 'head of government')
          : 'Head of government not recorded',
        state.length
          ? holderText(state, 'head of state')
          : 'Head of state not recorded',
      ];
  const first = executive[0] ?? state[0];
  const caption = [
    first.asOf ? `as of ${periodText(first.asOf)}` : null,
    peopleSources[first.source] ?? first.source,
    [...state, ...executive].some(({ stale }) => stale) && 'may be out of date',
  ]
    .filter(Boolean)
    .join(' · ');
  return { ...base, text: parts.join('. ') + '.', caption: caption || null };
}

export function standoutLine(sheetModel) {
  const { sentence, target } = standouts(sheetModel.rows);
  return { id: 'standouts', title: 'What stands out', text: sentence, target };
}

export function alertLine(snapshot, sheetModel) {
  const flags = liveFlags(snapshot, sheetModel.iso3).filter(
    ({ status }) => status !== 'cleared',
  );
  const base = { id: 'alerts', title: 'Alerts', target: 'condition' };
  if (!flags.length)
    return {
      ...base,
      text: 'No live alerts for this country in the loaded sources.',
      count: 0,
    };
  const described = flags.map((flag) =>
    [flag.label, flag.sourceName, flag.date, liveFlagStatus(flag)]
      .filter(Boolean)
      .join(' · '),
  );
  const shown = described.slice(0, 2).join('. ');
  const rest = described.length - 2;
  return {
    ...base,
    title: flags.length === 1 ? '1 alert' : `${flags.length} alerts`,
    text: shown + (rest > 0 ? `. And ${rest} more.` : '.'),
    count: flags.length,
  };
}

export function relationsLine(snapshot, sheetModel, now = Date.now()) {
  const base = {
    id: 'relations',
    title: 'Allies and rivals',
    target: 'relations',
  };
  const selected = sheetModel.iso3;
  const rows = currentRelations(snapshot, now).filter(
    (row) => !row.end && relationPeers(row, selected).length,
  );
  const names = new Map(
    (snapshot.countryIndex ?? []).map(({ iso3, name }) => [iso3, name]),
  );
  const alliances = [
    ...new Set(
      rows
        .filter(({ type }) => ['alliance', 'defence_pact'].includes(type))
        .map(
          (row) =>
            row.instrument ??
            row.title ??
            names.get(relationPeers(row, selected)[0]) ??
            relationPeers(row, selected)[0],
        ),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const peers = [
    ...new Set(rows.flatMap((row) => relationPeers(row, selected))),
  ].filter((id) => names.has(id));
  const byClass = (kind) =>
    peers
      .filter((id) => classifyDiplomacy(selected, id, rows, now) === kind)
      .map((id) => names.get(id))
      .sort((a, b) => a.localeCompare(b));
  const war = byClass('at-war');
  const rivals = byClass('rival');
  const parts = [
    war.length && `Armed conflict in the past 90 days with ${list(war)}.`,
    alliances.length && `Allied through ${shortList(alliances)}.`,
    rivals.length && `Rivals: ${shortList(rivals)}.`,
  ].filter(Boolean);
  return {
    ...base,
    text: parts.length
      ? parts.join(' ')
      : 'No alliance, rivalry or armed conflict is documented in the loaded sources.',
  };
}

export function dependencyLine(snapshot, sheetModel) {
  const base = {
    id: 'dependency',
    title: 'Largest dependency',
    target: 'exposure',
  };
  const iso3 = sheetModel.iso3;
  const model = snapshot.features?.['energy-dependencies'];
  if (!model)
    return { ...base, text: 'Energy trade routes are not loaded yet.' };
  if (isMinorImporter(snapshot, iso3))
    return {
      ...base,
      text: `${sheetModel.name} imports too little energy for the route model to name a dependency.`,
      caption: 'Draft floor',
      kind: 'estimate',
    };
  const caption =
    model.mode === 'fixture' ? 'Synthetic fixture data' : model.label;
  const exposure = countryExposure(snapshot, iso3);
  if (exposure?.length) {
    const top = [...exposure].sort(
      (a, b) => (b.shares?.all ?? -1) - (a.shares?.all ?? -1),
    )[0];
    const gate =
      energyGates(snapshot).find(({ id }) => id === top.gate)?.name ?? top.gate;
    if (Number.isFinite(top.shares?.all))
      return {
        ...base,
        text:
          `About ${percent.format(top.shares.all)} of ${sheetModel.name}'s energy imports pass ${gate}` +
          (top.item ? `, mostly ${top.item}.` : '.'),
        caption: caption ?? null,
        kind: 'estimate',
      };
  }
  const supplier = dependencyRows(snapshot, { dependent: iso3 })[0];
  if (supplier && Number.isFinite(supplier.shares?.all)) {
    const names = new Map(
      (snapshot.countryIndex ?? []).map(({ iso3: id, name }) => [id, name]),
    );
    return {
      ...base,
      text: `About ${percent.format(supplier.shares.all)} of ${sheetModel.name}'s energy imports come from ${names.get(supplier.provider) ?? supplier.provider}.`,
      caption: caption ?? null,
      kind: 'estimate',
    };
  }
  return {
    ...base,
    text: exposure
      ? 'The route model assigns no energy imports through the monitored chokepoints.'
      : 'No energy dependency is recorded for this country in the loaded sources.',
    caption: caption ?? null,
  };
}

export function overviewLines(snapshot, sheetModel, now = Date.now()) {
  return [
    conditionLine(sheetModel),
    leadershipLine(snapshot, sheetModel),
    standoutLine(sheetModel),
    alertLine(snapshot, sheetModel),
    relationsLine(snapshot, sheetModel, now),
    dependencyLine(snapshot, sheetModel),
  ];
}
