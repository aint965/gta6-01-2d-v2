// shoot.mjs — headless screenshot driver for the 2D Stage A shots.
// Reads shots.json, renders each query in the headless shell at 1280x800,
// captures Chromium's stderr console log, and converts the PNGs to JPEGs
// (quality 82) in screenshots/. Fails on any console error, any uncaught
// exception, any failed request, or any JPEG over 256 KiB.
// Usage: node checks/shoot.mjs  (dev server must be up on port 8128)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const chrome = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const pngDir = join(repo, 'checks', 'shots-png');
const shots = JSON.parse(readFileSync(join(repo, 'shots.json'), 'utf8'));

mkdirSync(pngDir, { recursive: true });
mkdirSync(join(repo, 'screenshots'), { recursive: true });

let failures = 0;
const consoleLines = [];
for (const shot of shots) {
  const png = join(pngDir, shot.name.replace(/\.jpg$/, '.png'));
  const url = `http://localhost:8128/${shot.query}`;
  const run = spawnSync(
    chrome,
    [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--window-size=1280,800', '--virtual-time-budget=4000',
      '--enable-logging=stderr', `--screenshot=${png}`, url,
    ],
    { encoding: 'utf8', timeout: 60000 },
  );
  const stderr = (run.stderr || '') + (run.stdout || '');
  const lines = stderr.split('\n').filter((l) => l.includes('CONSOLE'));
  for (const l of lines) consoleLines.push(`${shot.name}: ${l.trim()}`);
  const bad = lines.filter((l) => /Uncaught|Failed to load resource|ERROR/.test(l));
  if (run.status !== 0) {
    console.log(`SHOT ${shot.name}: chrome exit ${run.status}`);
    failures++;
    continue;
  }
  if (!existsSync(png)) {
    console.log(`SHOT ${shot.name}: no PNG written`);
    failures++;
    continue;
  }
  if (bad.length > 0) {
    console.log(`SHOT ${shot.name}: console errors:`);
    for (const l of bad) console.log('  ' + l.trim());
    failures++;
  } else {
    console.log(`SHOT ${shot.name}: OK (${statSync(png).size} B png, ${lines.length} console lines)`);
  }
}

if (consoleLines.length > 0) {
  console.log('--- console lines ---');
  for (const l of consoleLines) console.log(l);
}
if (failures > 0) {
  console.log(`SHOOT: ${failures} failures`);
  process.exit(1);
}

// Convert PNG -> JPEG (quality 82) with PIL; enforce the 256 KiB cap.
const convert = spawnSync(
  'python3',
  ['-c', `
import json, os
from PIL import Image
repo = ${JSON.stringify(repo)}
shots = json.load(open(os.path.join(repo, 'shots.json')))
for s in shots:
    png = os.path.join(repo, 'checks', 'shots-png', s['name'].replace('.jpg', '.png'))
    jpg = os.path.join(repo, 'screenshots', s['name'])
    im = Image.open(png).convert('RGB')
    im.save(jpg, 'JPEG', quality=82)
    print(f"{s['name']}: {im.size[0]}x{im.size[1]} {os.path.getsize(jpg)} B")
`],
  { encoding: 'utf8' },
);
console.log(convert.stdout);
if (convert.status !== 0) {
  console.log(convert.stderr);
  process.exit(1);
}
let over = 0;
for (const shot of shots) {
  const jpg = join(repo, 'screenshots', shot.name);
  const size = statSync(jpg).size;
  if (size > 262144) {
    console.log(`SHOT ${shot.name}: ${size} B OVER 256 KiB`);
    over++;
  }
}
rmSync(pngDir, { recursive: true, force: true });
if (over > 0) process.exit(1);
console.log('SHOOT: all 4 shots OK, all under 256 KiB');
