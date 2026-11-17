import sharp from 'sharp';

export const WEATHER_LOOK_IDS = ['weather-radar', 'weather-satellite', 'wind'];
export const WEATHER_LOOK_REFERENCE = Date.parse('2026-11-18T00:00:00Z');
const time = (minutes) =>
  new Date(WEATHER_LOOK_REFERENCE + minutes * 60000).toISOString();
const radarTimes = [-15, -10, -5].map(time);
const satelliteTimes = [-13, -8, -3].map(time);
export const WEATHER_LOOK_TIMES = {
  latest: {
    'weather-radar': radarTimes.at(-1),
    'weather-satellite': satelliteTimes.at(-1),
  },
  history: {
    'weather-radar': radarTimes.at(-1),
    'weather-satellite': satelliteTimes.at(-2),
  },
  forecast: { validIso: time(60), runIso: time(-60) },
};

export function createWeatherLookFixture(state) {
  const products = {
    radar: { times: radarTimes, color: '#23c282' },
    'clouds-regional': { times: satelliteTimes, color: '#becde2' },
  };
  const images = new Map();
  const grid = { nx: 360, ny: 181, lo1: 0, la1: 90, dx: 1, dy: 1 };
  const count = grid.nx * grid.ny;
  const cycle = WEATHER_LOOK_TIMES.forecast;
  const runGrid = (temperature) => {
    const values = new Float32Array(count * (temperature ? 3 : 2));
    values.fill(7, 0, count);
    values.fill(2, count, count * 2);
    if (temperature) values.fill(16, count * 2);
    return Buffer.from(values.buffer);
  };
  const grids = { base: runGrid(false), temperature: runGrid(true) };
  const findWind = (url) => {
    const model = url.searchParams.get('model');
    const overlay = url.searchParams.get('overlay') ?? 'none';
    if (model !== 'gfs' || !['none', 'temperature'].includes(overlay))
      return null;
    const temperature = overlay === 'temperature';
    const gridUrl =
      '/api/wind/grid/gfs-look.bin?model=gfs' +
      (temperature ? '&overlay=temperature' : '');
    if (url.pathname === '/api/wind/manifest') {
      if (state === 'empty')
        return {
          value: { unavailable: true, reason: 'Wind source unavailable' },
        };
      const scalar = temperature
        ? { kind: 'temperature', units: '°C', level: '2 m above ground' }
        : undefined;
      return { value: { model, overlay, grid, gridUrl, scalar, cycle } };
    }
    if (state === 'filled' && url.pathname + url.search === gridUrl)
      return {
        value: grids[temperature ? 'temperature' : 'base'],
        contentType: 'application/octet-stream',
      };
    return null;
  };

  return async (url) => {
    if (url.pathname.startsWith('/api/wind/')) return findWind(url);
    const product = url.searchParams.get('product');
    const definition = Object.hasOwn(products, product) && products[product];
    if (!definition) return null;
    const { times, color } = definition;
    if (url.pathname === '/api/weather/manifest') {
      return {
        value: {
          schemaVersion: 1,
          product,
          source: 'NOAA nowCOAST',
          attribution: 'NOAA/NWS/NESDIS nowCOAST',
          ...(state === 'empty'
            ? { unavailable: true, reason: 'Weather source unavailable' }
            : {
                // Put synthetic observations over the captured globe position.
                bounds: { west: 18, south: -12, east: 146, north: 52 },
                times,
                latest: times.at(-1),
                tileSize: 256,
                maxLevel: 6,
                tilingScheme: 'geographic',
                stale: false,
              }),
        },
      };
    }
    const tile = url.pathname === '/api/weather/tile';
    if (
      state !== 'filled' ||
      !(tile || url.pathname === '/api/weather/image') ||
      !times.includes(url.searchParams.get('time'))
    )
      return null;
    const size = url.searchParams.get('size');
    const width = tile
      ? Number(size ?? 256)
      : Number(size?.split('x')[0] ?? 4096);
    const height = tile ? width : width / 2;
    if (!(tile ? [256, 512, 1024] : [1024, 2048, 4096]).includes(width))
      return null;
    const key = `${product}:${width}x${height}`;
    if (!images.has(key)) {
      const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 200 100" preserveAspectRatio="none"><ellipse cx="105" cy="53" rx="67" ry="32" fill="${color}" opacity=".24"/></svg>`;
      images.set(key, sharp(Buffer.from(artwork)).png().toBuffer());
    }
    return { value: await images.get(key), contentType: 'image/png' };
  };
}
