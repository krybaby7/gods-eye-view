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
  const busyHosts = new Set();
  while (queue.length || inFlight.size) {
    while (inFlight.size < MAX_PARALLEL_SOURCES) {
      const index = queue.findIndex((id) => {
        const dependency = dependencies[id];
        return (
          !busyHosts.has(adapters[id]?.requestHost) &&
          !inFlight.has(dependency) &&
          !queue.includes(dependency)
        );
      });
      if (index < 0) break;
      const [id] = queue.splice(index, 1);
      const host = adapters[id]?.requestHost;
      if (host) busyHosts.add(host);
      const task = Promise.resolve().then(async () => {
        const result = await run(id, completed.get(dependencies[id]));
        completed.set(id, result);
        inFlight.delete(id);
        if (host) busyHosts.delete(host);
      });
      inFlight.set(id, task);
    }
    if (!inFlight.size)
      throw new Error('World Board source dependencies contain a cycle');
    await Promise.race(inFlight.values());
  }
}
