// Synthetic responses with two independent citations and a third available
// in toolkit mode. Each case exercises placement, list-only and source checks.
const PLACES = {
  crypto: ['New York', 40.7128, -74.006, 'London', 51.5072, -0.1276],
  sudan: ['Khartoum', 15.5007, 32.5599, 'Port Sudan', 19.6158, 37.2164],
  shipping: ['Suez', 29.9668, 32.5498, 'Djibouti', 11.588, 43.145],
  climate: ['Bonn', 50.7374, 7.0982, 'Geneva', 46.2044, 6.1432],
  ai: ['Brussels', 50.8503, 4.3517, 'Washington', 38.9072, -77.0369],
  ceasefire: ['Cairo', 30.0444, 31.2357, 'Doha', 25.2854, 51.531],
  lithium: ['Silver Peak', 37.7558, -117.637, 'Kalgoorlie', -30.7489, 121.4658],
  cables: ['Marseille', 43.2965, 5.3698, 'Singapore', 1.3521, 103.8198],
};

const FINDING_TYPES = {
  news: ['event', 'happened-here', 'Reported development'],
  statements: ['statement', 'said-here', 'Reported remarks'],
  places: ['place', 'located-here', 'Reported site'],
};

export function fixtureDependencies({ id, category }, toolkit) {
  const [name, lat, lon, extraName, extraLat, extraLon] = PLACES[id];
  const [kind, basis, title] = FINDING_TYPES[category];
  const domains = ['example.com', 'example.org', 'example.net'];
  const sources = domains.slice(0, toolkit ? 3 : 2).map((domain, index) => ({
    url: 'https://' + domain + '/' + id,
    title: 'Fixture publication ' + (index + 1),
  }));
  const finding = {
    kind,
    title,
    summary: 'Synthetic report used to verify benchmark counts.',
    sourceIds: ['s1'],
  };
  const findings = [
    { ...finding, title: title + ' in ' + name, place: { name, basis } },
    { ...finding, title: 'Related report with no location', sourceIds: ['s2'] },
    { ...finding, title: 'Unsupported claim', sourceIds: ['s99'] },
  ];
  if (toolkit) {
    findings.push({
      ...finding,
      title: title + ' in ' + extraName,
      place: { name: extraName, basis },
      sourceIds: ['s3'],
    });
  }
  const adapter = {
    async research() {
      return {
        notes: 'fixture research notes',
        sources,
        usage: {
          inputTokens: toolkit ? 1_500 : 1_250,
          outputTokens: 280,
          costUsd: 0.01,
        },
        agentModel: 'fixture-claude',
      };
    },
    async mapFindings() {
      return {
        json: { label: 'Synthetic reports', summary: [], groups: [], findings },
        usage: {
          inputTokens: 470,
          outputTokens: toolkit ? 300 : 240,
          costUsd: 0.004,
        },
        agentModel: 'fixture-claude',
      };
    },
  };
  return {
    agents: {
      get: (agent) => (agent === 'claude' ? adapter : null),
      status: async () => ({
        claude: { installed: true, signedIn: true, disabledReason: null },
      }),
    },
    geocode: async (place) => {
      if (place === name) return { name, lat, lon, precision: 'city' };
      if (place === extraName)
        return {
          name: extraName,
          lat: extraLat,
          lon: extraLon,
          precision: 'city',
        };
      return null;
    },
  };
}
