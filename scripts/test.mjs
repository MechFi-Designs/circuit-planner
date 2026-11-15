// Runs Vitest from a working directory with an uppercase drive letter.
//
// On Windows, VS Code often starts terminals in `c:\...` (lowercase). Vitest
// then loads two copies of itself (one per drive-letter spelling) and every
// test file fails with "Cannot read properties of undefined (reading 'config')".
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase());
const bin = join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
const { status } = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
  cwd,
  stdio: 'inherit',
});
process.exit(status ?? 1);
