// A phase's UI descriptor supplies tabs, cards, lenses, or overlay factories.
export const worldPhases = Object.values(
  import.meta.env
    ? import.meta.glob('./phase-*.js', { eager: true, import: 'default' })
    : {},
);

if (import.meta.env) {
  import.meta.glob('../../ui/styles/world-phase-*.css', { eager: true });
}

export function worldCardPick(id) {
  const match =
    typeof id === 'string' && /^world-card:([a-z][a-z-]*):(.+)$/.exec(id);
  return match ? { type: match[1], id: match[2] } : null;
}
