import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createProcessRunner } from '../../common/claude-process.js';
import {
  claudeProcessEnv,
  claudeStatus,
  parseClaudeStructured,
  structuredClaudeArgs,
} from '../../common/claude.js';
import { DIGEST_MAX_OUTPUT_TOKENS } from './runner.js';

const MODEL_ERRORS = Object.freeze({
  SEARCH_AGENT_UNAVAILABLE: [
    'agent_unavailable',
    'Claude Code is unavailable.',
  ],
  SEARCH_AGENT_FAILED: [
    'model_error',
    'Claude Code did not complete this run.',
  ],
  SEARCH_AGENT_TIMEOUT: ['timeout', 'Claude Code exceeded the time limit.'],
  SEARCH_AGENT_CANCELED: ['cancelled', 'The Claude run was canceled.'],
  SEARCH_MAP_INVALID: [
    'malformed_output',
    'Claude Code returned invalid structured output.',
  ],
});

export const newsDigestAgent = (env = process.env) =>
  env.NEWS_DIGEST_AGENT?.trim().toLowerCase() === 'perplexity'
    ? 'perplexity'
    : 'claude';

export function createClaudeNewsModel({
  env = process.env,
  executable = 'claude',
  executableArgs = [],
  timeoutMs = 20 * 60_000,
} = {}) {
  const model = env.NEWS_CLAUDE_MODEL?.trim() || 'sonnet';
  const cliEnv = claudeProcessEnv(env, { useProfileOverride: false });
  const run = createProcessRunner({
    executable,
    executableArgs,
    env: {
      ...cliEnv,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(DIGEST_MAX_OUTPUT_TOKENS),
    },
    maxOutputBytes: 8 * 1024 * 1024,
  });
  let cached;
  let expiresAt = 0;
  let pending;
  return {
    model,
    async status({ fresh = false } = {}) {
      if (!fresh && cached && Date.now() < expiresAt) return cached;
      pending ??= claudeStatus(run, { restricted: true })
        .then((status) => {
          cached = status;
          expiresAt = Date.now() + 5_000;
          return status;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
    async callModel({ body, signal }) {
      try {
        const stdout = await run(
          async (cwd) => {
            const systemPromptPath = path.join(cwd, 'instructions.txt');
            await writeFile(systemPromptPath, body.instructions, {
              mode: 0o600,
              flag: 'wx',
            });
            return structuredClaudeArgs({
              model,
              schema: body.response_format.json_schema.schema,
              systemPromptPath,
            });
          },
          {
            prompt: body.input[0].content,
            signal,
            timeoutMs,
            privateScratch: true,
            acceptExitFailure: true,
          },
        );
        const result = parseClaudeStructured(stdout);
        return {
          text: JSON.stringify(result.json),
          model: result.agentModel ?? model,
          responseId: result.responseId,
          reasoningTokens: null,
          cost: {
            costUsd: 0,
            estimated: false,
            inputTokens: null,
            outputTokens: null,
          },
          planUsage: result.usage,
        };
      } catch (error) {
        const [code, message] =
          MODEL_ERRORS[error.code] ?? MODEL_ERRORS.SEARCH_AGENT_FAILED;
        throw Object.assign(new Error(message), {
          code,
          ...(error.usage && { planUsage: error.usage }),
        });
      }
    },
  };
}
