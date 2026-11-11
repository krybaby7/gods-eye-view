import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildResearchPrompt } from '../research.js';
import {
  agentError,
  createProcessRunner,
} from '../../common/claude-process.js';
import {
  baseClaudeArgs,
  claudeProcessEnv,
  claudeStatus,
  parseClaudeStructured,
  parseJson,
  resultOk,
  structuredClaudeArgs,
  usageOf,
} from '../../common/claude.js';
import { createSearchToolkit, toolkitSources } from './toolkit.js';

const WEB_TOOLS = 'WebSearch,WebFetch';
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;

export function buildClaudeArgs({
  step,
  schema,
  model,
  mcpConfigPath,
  mcpTools = [],
}) {
  if (step !== 'research') return structuredClaudeArgs({ model, schema });
  const useToolkit = mcpConfigPath && mcpTools.length > 0;
  return [
    ...baseClaudeArgs({
      model,
      mcpConfigPath: useToolkit ? mcpConfigPath : undefined,
    }),
    '--output-format',
    'stream-json',
    '--verbose',
    '--tools',
    WEB_TOOLS,
    '--allowedTools',
    (useToolkit ? [WEB_TOOLS, ...mcpTools] : [WEB_TOOLS]).join(','),
  ];
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

export function parseClaudeResearch(stdout, mcpTools = []) {
  const enabled = new Set(mcpTools);
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
        } else if (enabled.has(call.name)) {
          sources.push(...toolkitSources(call.name, block.content, output));
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
  const { json, usage, agentModel } = parseClaudeStructured(stdout);
  return { json, usage, agentModel };
}

export function createClaudeAdapter({
  cacheDir = '.gev-cache',
  env = process.env,
  executable = 'claude',
  executableArgs = [],
  timeoutMs = Number(env.SEARCH_RUN_TIMEOUT_MS),
  statusTimeoutMs = 5_000,
  maxOutputBytes = 8 * 1024 * 1024,
  getToolkitOrigin,
} = {}) {
  const run = createProcessRunner({
    cacheDir,
    executable,
    executableArgs,
    env: claudeProcessEnv(env),
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
    status: ({ signal } = {}) =>
      claudeStatus(run, { signal, timeoutMs: statusTimeoutMs }),
    async research({ question, since, previousFindings, signal }) {
      const toolkit = createSearchToolkit(env, getToolkitOrigin?.());
      const prompt = buildResearchPrompt({
        question,
        since,
        previousFindings,
        toolkit: toolkit && {
          reliefWeb: toolkit.reliefWeb,
          live: Boolean(toolkit.apiBase),
        },
      });
      const args = { step: 'research', model };
      const stdout = await run(
        toolkit
          ? async (cwd) => {
              const mcpConfigPath = path.join(cwd, 'search-mcp.json');
              await writeFile(mcpConfigPath, JSON.stringify(toolkit.config), {
                mode: 0o600,
                flag: 'wx',
              });
              return buildClaudeArgs({
                ...args,
                mcpConfigPath,
                mcpTools: toolkit.tools,
              });
            }
          : buildClaudeArgs(args),
        { prompt, signal, timeoutMs: runTimeout, privateScratch: !!toolkit },
      );
      return parseClaudeResearch(stdout, toolkit?.tools);
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
