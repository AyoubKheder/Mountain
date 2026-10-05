/**
 * Loads `.env` into `process.env` before any module reads configuration.
 *
 * `loadConfig()` is called at import time by the route modules
 * (`authenticate(loadConfig().jwt.accessSecret)`), so the file must be read
 * before they evaluate. ES modules evaluate their imports depth-first in
 * declaration order, so importing this module first in `index.ts` is enough —
 * no `dotenv` dependency and no call-site changes.
 *
 * Uses Node's built-in loader (20.12+). Variables already present in the real
 * environment are never overwritten, so a shell export or a container secret
 * always wins over a developer's local file.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const candidates = [
  // The working directory first: how `npm run dev -w services/api` is invoked.
  resolve(process.cwd(), '.env'),
  // Then the repository root, three levels up from services/api/src.
  fileURLToPath(new URL('../../../.env', import.meta.url)),
];

for (const path of candidates) {
  if (!existsSync(path)) continue;

  try {
    process.loadEnvFile(path);
    console.log(`[mountain-api] loaded environment from ${path}`);
  } catch (err) {
    console.warn(`[mountain-api] could not read ${path}: ${(err as Error).message}`);
  }
  break;
}
