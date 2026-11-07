import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MAX_STDERR_BYTES = 64 * 1024;
const WINDOWS = process.platform === 'win32';

const messages = {
  SEARCH_AGENT_UNAVAILABLE: 'Claude Code is unavailable.',
  SEARCH_AGENT_FAILED: 'Claude Code did not complete this step.',
  SEARCH_AGENT_TIMEOUT: 'Claude Code exceeded the time limit.',
  SEARCH_AGENT_CANCELED: 'Search was canceled.',
  SEARCH_MAP_INVALID: 'Claude Code returned invalid map data.',
};

export function agentError(code) {
  return Object.assign(new Error(messages[code]), { code });
}

function killTree(child) {
  if (!child.pid) return;
  if (!WINDOWS) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const killer = spawn(
    path.join(systemRoot, 'System32', 'taskkill.exe'),
    ['/PID', String(child.pid), '/T', '/F'],
    { stdio: 'ignore', windowsHide: true },
  );
  killer.on('error', () => child.kill());
  killer.on('exit', (code) => {
    if (code !== 0) child.kill();
  });
}

function capture(executable, args, options) {
  const {
    cwd,
    env,
    prompt,
    signal,
    timeoutMs,
    maxOutputBytes,
    acceptExitFailure,
  } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(agentError('SEARCH_AGENT_CANCELED'));
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: !WINDOWS,
      });
    } catch {
      return reject(agentError('SEARCH_AGENT_UNAVAILABLE'));
    }
    const chunks = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let failure;
    const stop = (code) => {
      if (failure) return;
      failure = agentError(code);
      killTree(child);
    };
    const abort = () => stop('SEARCH_AGENT_CANCELED');
    const timer = setTimeout(() => stop('SEARCH_AGENT_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) stop('SEARCH_AGENT_FAILED');
      else if (!failure) chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) stop('SEARCH_AGENT_FAILED');
    });
    child.stdin.on('error', () => {});
    child.on('error', () => {
      failure ??= agentError('SEARCH_AGENT_UNAVAILABLE');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0 && !(acceptExitFailure && code === 1))
        reject(agentError('SEARCH_AGENT_FAILED'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(prompt);
  });
}

export function createProcessRunner({
  cacheDir,
  executable,
  executableArgs,
  env,
  maxOutputBytes,
}) {
  return async (
    args,
    { prompt, signal, timeoutMs, acceptExitFailure, privateScratch } = {},
  ) => {
    let cwd;
    try {
      if (signal?.aborted) throw agentError('SEARCH_AGENT_CANCELED');
      if (privateScratch) {
        cwd = await mkdtemp(path.join(tmpdir(), 'gev-claude-'));
      } else {
        const root = path.resolve(cacheDir, 'search-runs');
        await mkdir(root, { recursive: true, mode: 0o700 });
        cwd = await mkdtemp(path.join(root, 'claude-'));
      }
      const invocationArgs =
        typeof args === 'function' ? await args(cwd) : args;
      return await capture(executable, [...executableArgs, ...invocationArgs], {
        cwd,
        env,
        prompt,
        signal,
        timeoutMs,
        maxOutputBytes,
        acceptExitFailure,
      });
    } catch (error) {
      if (Object.hasOwn(messages, error.code)) throw error;
      throw agentError('SEARCH_AGENT_FAILED');
    } finally {
      if (cwd)
        await rm(cwd, { recursive: true, force: true, maxRetries: 3 }).catch(
          () => {},
        );
    }
  };
}
