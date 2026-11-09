const MAX_PARALLEL_SOURCES = 4;

export async function runWorldSources(
  sources,
  { adapters, dependencies, completed, run },
) {
  const queue = sources
    .map(({ id }) => id)
    .sort(
      (a, b) =>
        (adapters[a]?.estimatedBytes ?? 0) - (adapters[b]?.estimatedBytes ?? 0),
    );
  const inFlight = new Map();
  while (queue.length || inFlight.size) {
    while (inFlight.size < MAX_PARALLEL_SOURCES) {
      const index = queue.findIndex((id) => {
        const dependency = dependencies[id];
        return !inFlight.has(dependency) && !queue.includes(dependency);
      });
      if (index < 0) break;
      const [id] = queue.splice(index, 1);
      const task = Promise.resolve().then(async () => {
        const result = await run(id, completed.get(dependencies[id]));
        completed.set(id, result);
        inFlight.delete(id);
      });
      inFlight.set(id, task);
    }
    if (!inFlight.size)
      throw new Error('World Board source dependencies contain a cycle');
    await Promise.race(inFlight.values());
  }
}
