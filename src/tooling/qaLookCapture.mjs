/** Capture only pixels bracketed by unchanged measured state. */
export async function captureStable({
  settle,
  read,
  capture,
  discard,
  key,
  maxAttempts = 3,
}) {
  const attempts = [];
  for (let i = 1; i <= maxAttempts; i++) {
    const before = await settle();
    const value = await capture(before, i);
    const after = await read();
    const accepted = JSON.stringify(key(before)) === JSON.stringify(key(after));
    attempts.push({ before, after, accepted });
    if (accepted) return { value, before, after, attempts };
    await discard(value, i);
  }
  const error = new Error(
    `Panel moved during all ${maxAttempts} capture attempts`,
  );
  error.attempts = attempts;
  throw error;
}
