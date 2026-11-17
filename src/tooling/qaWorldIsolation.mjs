/** Keep background World loads off the server in QA for unrelated features. */
export function worldFixtureUnavailable(pathname, suite) {
  if (pathname !== '/api/world' && !pathname.startsWith('/api/world/')) return;

  return {
    status: 503,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify({
      error: 'world_disabled_in_fixture',
      message: `World API is unavailable during the ${suite} fixture run.`,
    }),
  };
}
