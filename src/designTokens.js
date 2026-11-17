// Colours shared by foundation.css and the globe. This module is also used in Node.
export const DESIGN_COLORS = Object.freeze({
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
