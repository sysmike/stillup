// Re-applies this run's check results to whatever is in history/ right now.
//
// Two runs that overlap both write history from the same starting files, so
// their commits conflict line for line and a rebase cannot settle it: today's
// row in history/daily/<slug>.csv is a counter, and both runs wrote the same
// number into it. Neither side of that conflict is right — the answer is the
// other run's row with this run's results added on top.
//
// scripts/.results.json is not committed, so it survives resetting the working
// tree to what the other run pushed. Appending it again is exactly that answer.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendResult } from './lib/history.mjs';

const RESULTS_FILE = fileURLToPath(new URL('.results.json', import.meta.url));

if (!existsSync(RESULTS_FILE)) {
  console.error('scripts/.results.json is missing; nothing to re-apply.');
  process.exit(1);
}

const results = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
for (const result of results) appendResult(result.slug, result);

console.log(`re-applied ${results.length} result(s) on top of the history that landed first`);
