import {
  dependencyRows,
  energyGates,
  gateReferences,
  netEnergyImports,
} from '../layers/world/energy.js';

const percent = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
});
const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const series = [
  ['MCOILBRENTEU', 'Brent crude', 'USD/barrel'],
  ['MCOILWTICO', 'WTI crude', 'USD/barrel'],
  ['PNGASEUUSDM', 'Europe natural gas', 'USD/MMBtu'],
];
const vesselTypes = [
  ['total', 'All vessels'],
  ['tanker', 'Tankers'],
  ['container', 'Containers'],
  ['dryBulk', 'Dry bulk'],
  ['generalCargo', 'General cargo'],
  ['roro', 'Roll-on/roll-off'],
  ['cargo', 'Cargo subtotal'],
];

function node(document, type, text, className) {
  const result = document.createElement(type);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function source(document, url, text) {
  const link = node(document, 'a', text);
  if (typeof url === 'string' && /^https:\/\//.test(url)) link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function numeric(value) {
  return Number.isFinite(value) ? amount.format(value) : 'Unknown';
}

function pct(value) {
  return Number.isFinite(value) ? percent.format(value) : 'Unknown';
}

function countryName(snapshot, iso3) {
  return snapshot.countries?.[iso3]?.name ?? iso3;
}

function details(document, pairs) {
  const list = node(document, 'dl', undefined, 'world-energy-details');
  for (const [term, value] of pairs) {
    list.append(node(document, 'dt', term), node(document, 'dd', value));
  }
  return list;
}

function dependencyNotice({ document, snapshot }) {
  const model = snapshot.features?.['energy-dependencies'];
  return node(
    document,
    'p',
    model?.mode === 'fixture'
      ? 'Synthetic fixture data for checking the interface.'
      : (model?.reason ?? 'Calibrated route shares are unavailable.'),
    'world-energy-note',
  );
}

function dependencyItem({ document, snapshot, openCard }, row, title) {
  const item = node(document, 'li');
  item.append(node(document, 'h4', title));
  item.append(
    details(document, [
      ['Share of seaborne imports', pct(row.shares.seaborne)],
      ['Share of all imports', pct(row.shares.all)],
      [
        'Stock cover',
        row.bufferDays == null ? 'Unknown' : `${numeric(row.bufferDays)} days`,
      ],
      ['Trade period', row.period ?? 'Unknown'],
    ]),
  );
  const gates = new Map(
    energyGates(snapshot).map((gate) => [gate.id, gate.name]),
  );
  for (const id of row.route) {
    if (!gates.has(id)) continue;
    const button = node(
      document,
      'button',
      gates.get(id),
      'world-energy-route',
    );
    button.type = 'button';
    button.addEventListener('click', () => openCard('chokepoint', id));
    item.append(button);
  }
  return item;
}

function dependencyList(context, rows, actor) {
  const { document, snapshot } = context;
  const list = node(document, 'ol', undefined, 'world-energy-list');
  for (const row of rows.slice(0, 12)) {
    list.append(
      dependencyItem(
        context,
        row,
        `${countryName(snapshot, row[actor])} · ${row.item}`,
      ),
    );
  }
  return list;
}

function priceList(document, snapshot) {
  const area = node(document, 'section', undefined, 'world-energy-section');
  area.append(node(document, 'h3', 'Monthly energy prices'));
  const list = node(document, 'ul', undefined, 'world-energy-prices');
  for (const [id, label, unit] of series) {
    const price = snapshot.features?.fred?.series?.[id]?.at(-1);
    const item = node(document, 'li');
    item.append(
      source(document, 'https://fred.stlouisfed.org/series/' + id, label),
      node(
        document,
        'span',
        price ? `${numeric(price.value)} ${unit} · ${price.month}` : 'Unknown',
      ),
    );
    list.append(item);
  }
  area.append(list);
  return area;
}

export function renderExposure(context) {
  const { document, snapshot, sheetModel } = context;
  const area = node(document, 'section', undefined, 'world-energy-section');
  const iso3 = sheetModel.iso3;
  const energy = netEnergyImports(snapshot, iso3);
  area.append(node(document, 'h3', 'Exposure'));
  area.append(dependencyNotice(context));
  const rows = dependencyRows(snapshot, { dependent: iso3 });
  if (rows.length) area.append(dependencyList(context, rows, 'provider'));
  area.append(
    details(document, [
      [
        'Net energy imports (% of energy use)',
        energy ? `${numeric(energy.value)}% · ${energy.period}` : 'Unknown',
      ],
      ['Stock cover', 'Unknown'],
    ]),
  );
  area.append(
    source(
      document,
      'https://data.worldbank.org/indicator/EG.IMP.CONS.ZS',
      'World Bank energy import series',
    ),
  );
  area.append(priceList(document, snapshot));
  return area;
}

export function renderLeverage(context) {
  const { document, snapshot, sheetModel } = context;
  const area = node(document, 'section', undefined, 'world-energy-section');
  area.append(node(document, 'h3', 'Leverage'), dependencyNotice(context));
  const rows = dependencyRows(snapshot, { provider: sheetModel.iso3 });
  if (rows.length) area.append(dependencyList(context, rows, 'dependent'));
  return area;
}

function plotTraffic(document, days) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 260 72');
  svg.setAttribute('class', 'world-energy-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Daily transit calls during the last 90 days');
  const end = Date.parse(days.at(-1)?.date);
  const visible = days.filter(
    ({ date }) => end - Date.parse(date) < 90 * 86_400_000,
  );
  const max = Math.max(1, ...visible.map(({ counts }) => counts.total ?? 0));
  const first = Date.parse(visible[0]?.date);
  let last;
  let commands = '';
  for (const { date, counts } of visible) {
    const at = Date.parse(date);
    const x = 2 + (256 * (at - first)) / Math.max(86_400_000, end - first);
    const y = 69 - (66 * counts.total) / max;
    commands += `${at - last === 86_400_000 ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    last = at;
  }
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', commands.trim());
  svg.append(path);
  return svg;
}

export function renderChokepoint(context) {
  const { document, snapshot, id } = context;
  const area = node(document, 'section', undefined, 'world-energy-section');
  const gate = energyGates(snapshot).find((item) => item.id === id);
  if (!gate) return node(document, 'p', 'Chokepoint unavailable.');
  area.dataset.worldChokepoint = gate.id;
  const latest = gate.days.at(-1);
  const traffic = snapshot.features?.portwatch;
  const mode = traffic?.mode;
  area.append(node(document, 'h3', gate.name));
  const status = node(document, 'p', gate.status, 'world-energy-status');
  status.dataset.status = gate.status;
  area.append(status);
  if (gate.proxy)
    area.append(node(document, 'p', gate.proxy, 'world-energy-note'));
  if (latest) {
    const coverage =
      traffic.dataTo === latest.date
        ? `Data to ${latest.date}`
        : `Gate data to ${latest.date} · feed data to ${traffic.dataTo}`;
    area.append(
      node(document, 'p', coverage),
      plotTraffic(document, gate.days),
      details(document, [
        [
          'Latest day / matched baseline',
          latest.date === traffic.dataTo
            ? numeric(latest.counts.total) +
              ' / ' +
              numeric(gate.baseline7) +
              ' calls/day'
            : 'Unknown',
        ],
        [
          '7-day mean / prior baseline',
          `${numeric(gate.mean7)} / ${numeric(gate.baseline7)} calls/day (${pct(gate.ratio7)})`,
        ],
        [
          '28-day mean / prior baseline',
          `${numeric(gate.mean28)} / ${numeric(gate.baseline28)} calls/day (${pct(gate.ratio28)})`,
        ],
        ...vesselTypes.map(([key, label]) => [
          label,
          numeric(latest.counts[key]),
        ]),
      ]),
    );
    area.append(
      node(
        document,
        'p',
        mode === 'fixture'
          ? 'Synthetic transit calls'
          : 'Transformed from IMF PortWatch vessel calls. Baseline uses the same weekdays 52 weeks earlier.',
        'world-energy-note',
      ),
    );
    if (mode !== 'fixture')
      area.append(
        source(document, 'https://portwatch.imf.org/', 'IMF PortWatch'),
      );
  } else {
    area.append(
      node(
        document,
        'p',
        mode === 'permission-required'
          ? 'Live traffic is unknown. Automated PortWatch extraction requires permission.'
          : 'Live traffic is unknown for this marker.',
        'world-energy-note',
      ),
    );
  }
  if (gate.events.length) {
    const active = node(document, 'ul', undefined, 'world-energy-history');
    for (const event of gate.events.slice(0, 5)) {
      active.append(
        node(
          document,
          'li',
          (event.name ?? event.id) + ' · from ' + event.from,
        ),
      );
    }
    area.append(node(document, 'h3', 'Open corroboration'), active);
  }
  const history = node(document, 'ul', undefined, 'world-energy-history');
  for (const change of gate.history.slice(-10).reverse()) {
    history.append(node(document, 'li', `${change.date} · ${change.status}`));
  }
  area.append(
    node(document, 'h3', 'Status history'),
    history.childElementCount ? history : node(document, 'p', 'Unknown'),
  );
  const refs = gateReferences(snapshot, gate);
  if (refs.length) {
    area.append(node(document, 'h3', 'EIA structural flows'));
    for (const row of refs) {
      area.append(
        node(
          document,
          'p',
          `${row.scope} · ${row.period} · ${numeric(row.value)} ${row.unit}`,
        ),
      );
    }
    area.append(
      source(
        document,
        refs[0].sourceUrl,
        'U.S. Energy Information Administration',
      ),
    );
    if (refs.some(({ reviewed }) => !reviewed))
      area.append(
        node(document, 'p', 'Draft, not yet reviewed.', 'world-energy-note'),
      );
  }
  if (gate.alternative && refs.length) {
    area.append(
      node(document, 'h3', 'EIA route alternatives'),
      node(document, 'p', gate.alternative),
    );
  }
  area.append(node(document, 'h3', 'Ranked dependents'));
  const dependents = dependencyRows(snapshot, { gate: gate.id }).filter(
    (row, index, all) =>
      all.findIndex(({ dependent }) => dependent === row.dependent) === index,
  );
  area.append(
    dependents.length
      ? dependencyList(context, dependents, 'dependent')
      : dependencyNotice(context),
  );
  return area;
}
