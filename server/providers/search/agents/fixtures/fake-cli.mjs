import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
const [configuration, ...args] = process.argv.slice(2);
const { authMethod, log, mode } = JSON.parse(configuration);
if (args[0] === '--version') {
  if (log) appendFileSync(log, 'version\n');
  console.log('2.1.302 (Claude Code)');
} else if (args[0] === 'auth') {
  if (log) appendFileSync(log, 'auth\n');
  console.log(
    JSON.stringify({
      loggedIn: true,
      authMethod: authMethod || 'claude.ai',
      email: 'private@example.com',
    }),
  );
} else {
  const prompt = readFileSync(0, 'utf8');
  if (log)
    writeFileSync(
      log,
      JSON.stringify({
        args,
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
        'const fs = require("node:fs"); const file = process.argv[1]; fs.writeFileSync(file, "started"); setTimeout(() => fs.writeFileSync(file, "survived"), 900);',
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
