// Palkon Auto 2D — the entrypoint that hands the game in.
//
// The playable game is the static files under game/ (game/index.html plus
// its ES modules, no library, no network request at all), and the four
// screenshots under screenshots/. This program copies both into the output
// directory and writes /output/dossier.json with the vendored make.fun
// library, so the judge can read exactly what was handed in.
//
// Run it outside the grader's container with MAKEFUN_OUTPUT_DIR standing
// in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The caps come from the bounty's own gate: 4 screenshots at most, each at
// most 256 KiB, game/ at most 993 entries / 48 MiB / 1000-byte paths, and the
// dossier text at most 160 KiB. Passing them here makes this program fail
// exactly where the scorer would refuse the entry.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
console.log(`dossier written: ${dossier.length} bytes -> ${join(outputDir, 'dossier.json')}`);
