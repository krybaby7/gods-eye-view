import http from 'node:http';

export function proxyAllowed(origin, method, target) {
  try {
    const url = new URL(target);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !['GET', 'HEAD'].includes(method)
    )
      return false;
    let pathname = url.pathname;
    for (let i = 0; i < 4; i++) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
    pathname = pathname.replaceAll('\\', '/');
    const canonical = new URL(pathname, origin).pathname;
    return !/^\/+api(?:\/|$)/i.test(canonical) && !pathname.includes('%');
  } catch {
    return false;
  }
}

export async function createDenyProxy(origin) {
  const totals = {
    allowed: 0,
    denied: 0,
    deniedApi: 0,
    deniedOrigin: 0,
    deniedTargets: {},
    tunnels: 0,
    upgrades: 0,
  };
  const server = http.createServer((request, response) => {
    if (!proxyAllowed(origin, request.method, request.url)) {
      totals.denied++;
      totals.deniedTargets[request.url] =
        (totals.deniedTargets[request.url] ?? 0) + 1;
      try {
        const url = new URL(request.url);
        if (
          url.origin === origin &&
          /^\/+api(?:\/|$)/i.test(decodeURIComponent(url.pathname))
        )
          totals.deniedApi++;
        else totals.deniedOrigin++;
      } catch {
        totals.deniedOrigin++;
      }
      response.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
      response.end('Blocked by fixture proxy');
      return;
    }
    totals.allowed++;
    const url = new URL(request.url);
    const headers = { ...request.headers, host: url.host };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = http.request(
      url,
      { method: request.method, headers },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.on('aborted', () => upstream.destroy());
    upstream.end();
  });
  for (const event of ['connect', 'upgrade'])
    server.on(event, (_request, socket) => {
      totals[event === 'connect' ? 'tunnels' : 'upgrades']++;
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    address: `http://127.0.0.1:${server.address().port}`,
    totals,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
