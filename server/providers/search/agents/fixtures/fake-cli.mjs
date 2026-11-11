import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
const [configuration, ...args] = process.argv.slice(2);
const {
  authMethod,
  log,
  mode,
  reply,
  briefReply,
  version,
  loggedIn,
  exitCode,
} = JSON.parse(configuration);
if (args[0] === '--version') {
  if (log) appendFileSync(log, 'version\n');
  console.log(version || '2.1.302 (Claude Code)');
} else if (args.includes('auth')) {
  if (log) appendFileSync(log, 'auth\n');
  console.log(
    JSON.stringify({
      loggedIn: loggedIn ?? true,
      authMethod: authMethod || 'claude.ai',
      email: 'private@example.com',
    }),
  );
} else {
  const prompt = readFileSync(0, 'utf8');
  const configArg = args[args.indexOf('--mcp-config') + 1];
  const mcpConfig = configArg.startsWith('{')
    ? JSON.parse(configArg)
    : JSON.parse(readFileSync(configArg, 'utf8'));
  if (log)
    writeFileSync(
      log,
      JSON.stringify({
        args,
        systemPrompt: args.includes('--system-prompt-file')
          ? readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf8')
          : undefined,
        maxOutputTokens: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
        mcpConfig,
        appname: process.env.SEARCH_RELIEFWEB_APPNAME,
        prompt,
        cwd: process.cwd(),
        files: readdirSync(process.cwd()),
        apiKey: process.env.ANTHROPIC_API_KEY,
      }),
    );
  if (mode === 'tree') {
    spawn(
      process.execPath,
      [
        '-e',
        'const fs = require("node:fs"); const net = require("node:net"); const server = net.createServer(socket => socket.end()); server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[1], String(server.address().port))); setTimeout(() => server.close(), 20_000).unref();',
        log + '.child',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    setInterval(() => {}, 500);
  } else if (mode === 'hang') setInterval(() => {}, 500);
  else if (mode === 'overflow')
    process.stdout.write('x'.repeat(10 * 1024 * 1024));
  else if (mode === 'fail') {
    console.error('private model response');
    process.exitCode = 1;
  } else if (reply) {
    const isBrief = JSON.parse(
      args[args.indexOf('--json-schema') + 1],
    ).required.includes('headline');
    process.stdout.write(
      readFileSync(isBrief && briefReply ? briefReply : reply),
    );
    process.exitCode = exitCode ?? 0;
  } else
    console.log(
      readFileSync(
        new URL(
          args.includes('stream-json') ? 'research.jsonl' : 'map.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
}
