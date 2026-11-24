// headlight-test.mjs — the headlight pixel test, written in-session.
// Renders the night preset twice (headlights on, headlights off) from the
// same camera over the player car, then measures, with pixels.py:
//   * lit patch (asphalt ahead of the car, headlights on) vs the unlit
//     control patch (same frame): mean lift >= +20, >= 90% of pixels > +10.
//   * the control patch with headlights on vs the same patch with
//     headlights off: must stay within 1 level (proves the lift is the
//     headlight, not a global brightness change).
//   * bonus honesty check: the lit patch on vs the same patch off.
// Usage: node checks/headlight-test.mjs  (dev server must be up on port 8128)
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const chrome = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const dir = join(repo, 'checks', 'headlight');
mkdirSync(dir, { recursive: true });

// Camera centred on the player car (1928, 1900), zoom 1.2, night, t=1200.
// Screen centre (640, 400) is the car; the beam runs north (up the screen).
// Lit patch: x 615..665, y 170..230 — on the beam axis, between lamp pools.
// Control patch: x 90..190, y 600..700 — far from the beam, same lighting.
const base = '?cx=1928&cy=1900&preset=night&zoom=1.2&t=1200';
const shots = [
  { file: 'on.png', query: base },
  { file: 'off.png', query: base + '&headlights=off' },
];
for (const s of shots) {
  const run = spawnSync(
    chrome,
    [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--window-size=1280,800', '--virtual-time-budget=4000',
      '--enable-logging=stderr', `--screenshot=${join(dir, s.file)}`,
      `http://localhost:8128/${s.query}`,
    ],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (run.status !== 0) {
    console.log(`HEADLIGHT: chrome exit ${run.status} for ${s.file}`);
    process.exit(1);
  }
  console.log(`HEADLIGHT: rendered ${s.file}`);
}

const px = spawnSync(
  'python3',
  [join(dir, '..', 'pixels.py'), join(dir, 'on.png'), join(dir, 'off.png')],
  { encoding: 'utf8' },
);
console.log(px.stdout);
if (px.stderr) console.log(px.stderr);
process.exit(px.status ?? 1);
