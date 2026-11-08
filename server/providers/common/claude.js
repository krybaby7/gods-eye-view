import { agentError } from './claude-process.js';

const MIN_VERSION = [2, 1, 248];
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
  if (shape.anyOf) shape.anyOf = shape.anyOf.map(claudeSchema);
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

export function baseClaudeArgs({ model, mcpConfigPath } = {}) {
  const args = [
    '-p',
    '--restricted',
    '--no-chrome',
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfigPath || '{"mcpServers":{}}',
    '--disallowedTools',
    mcpConfigPath ? 'ListMcpResourcesTool,ReadMcpResourceTool' : 'mcp__*',
  ];
  if (model) args.push('--model', model);
  return args;
}

export function structuredClaudeArgs({ model, schema, systemPromptPath }) {
  const args = baseClaudeArgs({ model });
  if (systemPromptPath) args.push('--system-prompt-file', systemPromptPath);
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

export function parseJson(text, code = 'SEARCH_AGENT_FAILED') {
  try {
    return JSON.parse(text);
  } catch {
    throw agentError(code);
  }
}

export function usageOf(result) {
  const measured = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
  return {
    durationMs: measured(result.duration_ms),
    inputTokens: measured(result.usage?.input_tokens),
    outputTokens: measured(result.usage?.output_tokens),
    costUsd: measured(result.total_cost_usd),
  };
}

export function resultOk(result) {
  if (
    result?.type !== 'result' ||
    result.subtype !== 'success' ||
    result.is_error
  ) {
    throw agentError('SEARCH_AGENT_FAILED');
  }
}

export function parseClaudeStructured(stdout) {
  let result;
  try {
    result = parseJson(stdout, 'SEARCH_MAP_INVALID');
  } catch (error) {
    error.mapIssue = 'The Claude Code response was not valid JSON.';
    throw error;
  }
  const usage = result?.type === 'result' ? usageOf(result) : null;
  const agentModel = Object.keys(result?.modelUsage || {})[0] || null;
  try {
    resultOk(result);
    if (
      !result.structured_output ||
      typeof result.structured_output !== 'object' ||
      Array.isArray(result.structured_output)
    ) {
      throw Object.assign(agentError('SEARCH_MAP_INVALID'), {
        mapIssue: 'Claude Code returned no structured map object.',
      });
    }
  } catch (error) {
    if (usage) Object.assign(error, { usage, agentModel });
    throw error;
  }
  return {
    json: result.structured_output,
    usage,
    responseId:
      typeof result.session_id === 'string' ? result.session_id : null,
    agentModel,
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

export function claudeProcessEnv(env, { useProfileOverride = true } = {}) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        OS_ENV.test(key) &&
        (useProfileOverride || key.toLowerCase() !== 'claude_config_dir'),
    ),
  );
}

export async function claudeStatus(
  run,
  { signal, timeoutMs = 5_000, restricted = false } = {},
) {
  let installed = false;
  try {
    const options = { signal, timeoutMs, privateScratch: restricted };
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
      await run(
        [...(restricted ? ['--restricted'] : []), 'auth', 'status', '--json'],
        {
          ...options,
          acceptExitFailure: true,
        },
      ),
    );
    const signedIn = auth?.loggedIn === true && auth.authMethod === 'claude.ai';
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
}
