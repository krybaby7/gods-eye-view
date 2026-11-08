/** Keep provider request URLs and credentials out of logs and UI diagnostics. */
export function describeMapError(error) {
  const message =
    typeof error === 'string'
      ? error
      : typeof error?.message === 'string'
        ? error.message
        : 'Map provider request failed';
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[provider URL]')
    .replace(/Bearer\s+[\w.~+/%=-]+/gi, 'Bearer [redacted]')
    .replace(
      /((?:["']?(?:key|api[_-]?key|access[_-]?token|session|token|authorization)["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      '$1[redacted]',
    )
    .replace(/AIza[\w-]+/g, '[redacted]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]')
    .slice(0, 500);
}

/** A listener prevents Cesium's default tile failure logging of secret URLs. */
export function protectGoogleTilesetDiagnostics(tileset) {
  tileset?.tileFailed?.addEventListener(() => {
    console.warn(
      '[Google 3D] A tile request failed; check API access, quota, coverage or network.',
    );
  });
  return tileset;
}
