import { buildResearchPrompt } from '../research.js';
import { agentError, createProcessRunner } from './process.js';

const WEB_TOOLS = 'WebSearch,WebFetch';
const MIN_VERSION = [2, 1, 248];
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;
const OS_ENV =
  /^(path|pathext|systemroot|windir|comspec|home|userprofile|homedrive|homepath|appdata|localappdata|tmpdir|tmp|temp|lang|lc_[a-z_]+|xdg_config_home|xdg_data_home|xdg_runtime_dir|dbus_session_bus_address|claude_config_dir)$/i;

// Claude's structured output accepts the schema shape. Local map validation
// enforces the bounds that its grammar cannot express.
function claudeSchema(schema) {
  const {
    description,
    properties,
    items,
    minLength,
    maxLength,
    maxItems,
    minimum,
    maximum,
    ...shape
  } = schema;
  if (properties) {
    shape.properties = Object.fromEntries(
      Object.entries(properties).map(([name, child]) => [
        name,
        claudeSchema(child),
      ]),
    );
  }
  if (items) shape.items = claudeSchema(items);
  const details = [description];
  if (minLength != null) details.push('At least ' + minLength + ' characters.');
  if (maxLength != null) details.push('At most ' + maxLength + ' characters.');
  if (maxItems != null) details.push('At most ' + maxItems + ' items.');
  if (minimum != null) details.push('Minimum ' + minimum + '.');
  if (maximum != null) details.push('Maximum ' + maximum + '.');
  const instruction = details.filter(Boolean).join(' ');
  if (instruction) shape.description = instruction;
  return shape;
}

export function buildClaudeArgs({ step, schema, model }) {
  const args = [
    '-p',
    '--restricted',
    '--no-chrome',
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--disallowedTools',
    'mcp__*',
  ];
  if (model) args.push('--model', model);
  if (step === 'research') {
    return [
      ...args,
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      WEB_TOOLS,
      '--allowedTools',
      WEB_TOOLS,
    ];
  }
  return [
    ...args,
    '--output-format',
    'json',
    '--tools',
    '',
    '--json-schema',
    JSON.stringify(claudeSchema(schema)),
  ];
}

function parseJson(text, code = 'SEARCH_AGENT_FAILED') {
  try {
    return JSON.parse(text);
  } catch {
    throw agentError(code);
  }
}

function usageOf(result) {
  const measured = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
  return {
    durationMs: measured(result.duration_ms),
    inputTokens: measured(result.usage?.input_tokens),
    outputTokens: measured(result.usage?.output_tokens),
    costUsd: measured(result.total_cost_usd),
  };
}

function resultOk(result) {
  if (
    result?.type !== 'result' ||
    result.subtype !== 'success' ||
    result.is_error
  ) {
    throw agentError('SEARCH_AGENT_FAILED');
  }
}

function searchLinks(content) {
  if (typeof content === 'string') {
    const links = /^Links:\s*(\[[^\n]*\])\s*$/m.exec(content);
    if (!links) return [];
    try {
      return searchLinks(JSON.parse(links[1]));
    } catch {
      return [];
    }
  }
  if (Array.isArray(content)) return content.flatMap(searchLinks);
  if (content?.type === 'text') return searchLinks(content.text);
  if (Array.isArray(content?.results)) return searchLinks(content.results);
  if (typeof content?.url !== 'string') return [];
  return [
    {
      url: content.url,
      title: content.title,
      date: content.date || content.page_age,
      snippet: content.snippet,
    },
  ];
}

function structuredSearchLinks(output) {
  if (!Array.isArray(output.results)) return [];
  return output.results.flatMap((result) =>
    Array.isArray(result?.content) ? result.content.flatMap(searchLinks) : [],
  );
}

function confirmsFetch(content) {
  if (Array.isArray(content)) return content.some(confirmsFetch);
  if (content?.type === 'text') return confirmsFetch(content.text);
  if (typeof content === 'object' && content) {
    if (content.error || content.error_code || content.is_error) return false;
    const status = content.statusCode ?? content.status;
    if (typeof status === 'number') return status >= 200 && status < 300;
    return content.type === 'web_fetch_result';
  }
  return (
    typeof content === 'string' &&
    content.trim().length > 0 &&
    !/^(?:error\b|failed\b|request failed\b|redirect(?:ed)?\b|unable\b|could not\b|cannot\b|[345]\d{2}\b)/i.test(
      content.trim(),
    )
  );
}

export function parseClaudeResearch(stdout) {
  const toolUses = new Map();
  const sources = [];
  let agentModel = null;
  let result;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseJson(line);
    if (event?.type === 'system' && event.subtype === 'init')
      agentModel = event.model ?? agentModel;
    if (event?.type === 'assistant') {
      agentModel = event.message?.model ?? agentModel;
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === 'tool_use' && typeof block.id === 'string')
          toolUses.set(block.id, block);
      }
    }
    if (event?.type === 'user') {
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;
      const results = content.filter((block) => block?.type === 'tool_result');
      const output = results.length === 1 ? event.tool_use_result : null;
      for (const block of results) {
        const call = toolUses.get(block.tool_use_id);
        toolUses.delete(block.tool_use_id);
        if (!call || block.is_error || output?.detachedToolCall) continue;
        if (call.name === 'WebSearch') {
          const links =
            output == null
              ? searchLinks(block.content)
              : structuredSearchLinks(output);
          for (const link of links) sources.push(link);
        } else if (call.name === 'WebFetch' && output != null) {
          if (
            typeof output.url === 'string' &&
            Number.isInteger(output.code) &&
            output.code >= 200 &&
            output.code < 300
          ) {
            sources.push({ url: output.url });
          }
        } else if (
          call.name === 'WebFetch' &&
          typeof call.input?.url === 'string' &&
          confirmsFetch(block.content)
        ) {
          sources.push({ url: call.input.url });
        }
      }
    }
    if (event?.type === 'result') result = event;
  }
  resultOk(result);
  if (typeof result.result !== 'string')
    throw agentError('SEARCH_AGENT_FAILED');
  return { notes: result.result, sources, usage: usageOf(result), agentModel };
}

export function parseClaudeMap(stdout) {
  const result = parseJson(stdout, 'SEARCH_MAP_INVALID');
  resultOk(result);
  if (
    !result.structured_output ||
    typeof result.structured_output !== 'object' ||
    Array.isArray(result.structured_output)
  ) {
    throw agentError('SEARCH_MAP_INVALID');
  }
  return {
    json: result.structured_output,
    usage: usageOf(result),
    agentModel: Object.keys(result.modelUsage || {})[0] || null,
  };
}

function versionSupported(stdout) {
  const version = /^\s*(\d+)\.(\d+)\.(\d+)\b/
    .exec(stdout)
    ?.slice(1)
    .map(Number);
  if (!version) return false;
  const difference = version.findIndex(
    (part, index) => part !== MIN_VERSION[index],
  );
  return difference < 0 || version[difference] > MIN_VERSION[difference];
}

export function createClaudeAdapter({
  cacheDir = '.gev-cache',
  env = process.env,
  executable = 'claude',
  executableArgs = [],
  timeoutMs = Number(env.SEARCH_RUN_TIMEOUT_MS),
  statusTimeoutMs = 5_000,
  maxOutputBytes = 8 * 1024 * 1024,
} = {}) {
  const cliEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => OS_ENV.test(key)),
  );
  const run = createProcessRunner({
    cacheDir,
    executable,
    executableArgs,
    env: cliEnv,
    maxOutputBytes,
  });
  const model = env.SEARCH_CLAUDE_MODEL || undefined;
  const runTimeout =
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs > 0 &&
    timeoutMs <= 2_147_483_647
      ? timeoutMs
      : DEFAULT_RUN_TIMEOUT_MS;
  return {
    async status({ signal } = {}) {
      let installed = false;
      try {
        const options = { signal, timeoutMs: statusTimeoutMs };
        const version = await run(['--version'], options);
        installed = true;
        if (!versionSupported(version)) {
          return {
            installed,
            signedIn: false,
            disabledReason: 'Update Claude Code to 2.1.248 or later.',
          };
        }
        const auth = parseJson(
          await run(['auth', 'status', '--json'], {
            ...options,
            acceptExitFailure: true,
          }),
        );
        const signedIn =
          auth?.loggedIn === true && auth.authMethod === 'claude.ai';
        return {
          installed,
          signedIn,
          disabledReason: signedIn
            ? null
            : 'Sign in with your Claude subscription using claude auth login.',
        };
      } catch (error) {
        if (signal?.aborted) throw agentError('SEARCH_AGENT_CANCELED');
        return {
          installed,
          signedIn: false,
          disabledReason: installed
            ? 'Could not check Claude sign-in.'
            : 'Install Claude Code and make it available on PATH.',
        };
      }
    },
    async research({ question, since, previousFindings, signal }) {
      const prompt = buildResearchPrompt({ question, since, previousFindings });
      const stdout = await run(buildClaudeArgs({ step: 'research', model }), {
        prompt,
        signal,
        timeoutMs: runTimeout,
      });
      return parseClaudeResearch(stdout);
    },
    async mapFindings({ prompt, schema, signal }) {
      const stdout = await run(
        buildClaudeArgs({ step: 'map', model, schema }),
        { prompt, signal, timeoutMs: runTimeout },
      );
      return parseClaudeMap(stdout);
    },
  };
}
