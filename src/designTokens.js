// Colours shared by foundation.css and the globe. This module is also used in Node.
export const DESIGN_COLORS = Object.freeze({
  '--accent': '#00d4ff',
  '--rel-war': '#db474f',
  '--rel-armed': '#f4525d',
  '--rel-sanctions': '#e8933f',
  '--rel-ally': '#3da1ea',
  '--rel-rival': '#b25ec5',
  '--rel-partner': '#3eaf97',
  '--rel-neutral': '#949faf',
  '--ramp-0': '#c2410c',
  '--ramp-25': '#f08c3a',
  '--ramp-50': '#d9c58f',
  '--ramp-75': '#4aa8d8',
  '--ramp-100': '#1d6fd1',
  '--live-civil': '#22e0ff',
  '--live-military': '#ffb347',
  '--live-sea': '#3fe0c8',
  '--live-space': '#bda4ff',
  '--ownership-documented': '#519bd4',
  '--cat-all': '#b9fbff',
  '--cat-news': '#44adff',
  '--cat-talk': '#f2b84b',
  '--cat-weather': '#ff5c78',
  '--cat-public-safety': '#ff8b4a',
  '--cat-aviation-marine': '#a87cff',
  '--cat-traffic-transit': '#ffd166',
  '--cat-music': '#54d17a',
  '--cat-other': '#9aa7b3',
});

export const RADIO_CATEGORY_COLORS = Object.freeze({
  all: DESIGN_COLORS['--cat-all'],
  news: DESIGN_COLORS['--cat-news'],
  talk: DESIGN_COLORS['--cat-talk'],
  weather: DESIGN_COLORS['--cat-weather'],
  'public-safety': DESIGN_COLORS['--cat-public-safety'],
  'aviation-marine': DESIGN_COLORS['--cat-aviation-marine'],
  'traffic-transit': DESIGN_COLORS['--cat-traffic-transit'],
  music: DESIGN_COLORS['--cat-music'],
  other: DESIGN_COLORS['--cat-other'],
});

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

export const RELATION_RGB = {
  war: rgb(DESIGN_COLORS['--rel-war']),
  sanctions: rgb(DESIGN_COLORS['--rel-sanctions']),
  ally: rgb(DESIGN_COLORS['--rel-ally']),
  rival: rgb(DESIGN_COLORS['--rel-rival']),
  partner: rgb(DESIGN_COLORS['--rel-partner']),
  neutral: rgb(DESIGN_COLORS['--rel-neutral']),
};

export const SCORE_RAMP_RGB = [0, 25, 50, 75, 100].map((stop) =>
  rgb(DESIGN_COLORS[`--ramp-${stop}`]),
);

export const OWNERSHIP_DOCUMENTED_RGB = rgb(
  DESIGN_COLORS['--ownership-documented'],
);
