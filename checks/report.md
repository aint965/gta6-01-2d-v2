# Stage A report — "Palkon Auto" 2D (gta6-01-2d-v2)

## What was built
Hand-written Canvas 2D top-down renderer + the city of Solmar (3,840 x 3,456),
seed 20261123, deterministic in the seed and in the `?t=` clock.

- `game/city.js` — pure-data city generator (no browser APIs): 7 districts with
  their own roof/wall palettes, taglines and standing scores; road hierarchy
  (boulevard 64 + sidewalks 12, main 48/10, secondary 32/8, local 20/6);
  Old Solmar jogged streets; canal + 3 bridges, harbour, beach, park + pond,
  central plaza with a fountain roundabout; 447 buildings, 82 parked + 40
  moving traffic cars (yellow taxis among them), 110 pedestrians anchored to
  sidewalks, 5 traffic lights, 70 street lamps, 65 trees, 8 boats, 4 neon
  landmark signs, 19 boulevard shopfronts, 346 rooftop props.
- `game/game.js` — layered renderer (ground -> roads/sidewalks -> fountain ->
  shadows -> buildings -> cars -> pedestrians -> furniture -> lighting tint ->
  night extras -> HUD + minimap). Three presets (1/2/3 or T): scorching
  midday, sunset (golden-hour tint + long shadows), night (dark blue tint,
  lit windows, lamp pools, soft radial-gradient headlight pools — no rings,
  no bands, no hard edges). HUD: title + district/tagline/standing top-left,
  compass top-centre, preset top-right, big speedometer bottom-left, minimap
  bottom-right (buildings coloured by district, boulevard, plaza, viewport,
  player arrow), controls line bottom-centre. Camera pans with arrows/WASD;
  `?cx=&cy=&preset=&zoom=&t=&headlights=` position it exactly.
- `main.ts` — rewritten by hand (NOT the kit starter byte-for-byte): copies
  game/ + screenshots/ and writes dossier.json via the vendored library.
- `shots.json` — the 4 Stage A shots (boulevard day, sunset street, night
  headlight, plaza).

## Starter check (read-only, before any code)
Repo `main.ts`, `LICENSE`, `shots.json` were byte-identical to the kit
starter (read and compared). LICENSE carries `SPDX-License-Identifier: MIT`
on line 1. `main.ts` was rewritten by this session; `shots.json` replaced
with the 4 Stage A shots.

## Measured numbers
- Layout verifier (`node checks/verify-layout.mjs`): **0 problems**.
  Counts: 447 buildings, 82 parked cars, 40 traffic cars, 110 pedestrians,
  70 lamps, 65 trees, 8 boats, 5 traffic lights, 4 landmarks, 19 shopfronts,
  346 rooftop props, 48 sidewalk strips. Checks: boulevard sidewalks both
  sides every 32 units; no building corner on a road; no car inside a
  building; every pedestrian on a sidewalk; no building overlaps.
- Headless drive (`node checks/shoot.mjs`): **4/4 shots OK, 0 console
  errors, 0 page errors, 0 failed requests** (index/game.js/city.js all
  HTTP 200). JPEGs: 1-boulevard-day 153,470 B; 2-sunset-street 121,506 B;
  3-night-headlight 125,377 B; 4-plaza 155,751 B — all 1280x800, all under
  256 KiB.
- Headlight pixel test (`node checks/headlight-test.mjs`): **PASS**.
  Lit patch mean 184.8 vs control 75.4 → lift **+109.4** (need >= +20);
  100.0% of lit pixels > +10 (need >= 90%); control drift **0.0**
  (need <= 1); headlight-only delta (lit on vs lit off) **+76.0**.
- Packaging (`MAKEFUN_OUTPUT_DIR=checks/outN node main.ts`, twice):
  **byte-identical** — dossier 788,101 bytes, sha256
  `2cdc328e13750c157f8aabe4270d84604cb22fb1f6528a83de4b1320da457986`.

## Bugs found and fixed (all in-session, after the first run)
1. City too sparse: district-grid placement yielded 125 buildings (floor
   400), 0 shopfronts, 3 landmarks. Fixed by block-based placement (3x3
   buildings per street block) + road no-build pad = sidewalk width only.
   Now 447 buildings, 19 shopfronts, 4 landmarks.
2. 4 pedestrians off sidewalks: walk sway could push them past a sidewalk
   end. Fixed by clamping the sway inside the pedestrian's own sidewalk rect.
3. Boulevard sidewalk "missing" at 1 sample point each side: verifier
   sampled y=3456, the exclusive end of the rect. Fixed the sampler bound.
4. Plaza fountain invisible: drawn before the roads, the boulevard + main
   street painted over it. Fixed by drawing the fountain after the roads
   (a roundabout) and swinging traffic around it in `trafficPos`.
5. Traffic cars bunching and overlapping near the player. Fixed by
   staggering each lane's cars evenly (172.8 units apart) at spawn.
6. Compass "N" overlapped by a triangle glyph drawn at the same spot;
   preset box clipped "press 1/2/3" at the right edge. Fixed: triangle
   removed, box widened to 200 px.
7. Sunset shadows read as hard second slabs. Softened alpha 0.20 -> 0.15.

## Screenshots (viewed by this session)
- `screenshots/1-boulevard-day.jpg` — boulevard drive: cars on the road,
  sidewalks + curbs both sides, roofs with parapets/window grids/shopfronts,
  NERI'S sign, minimap with district colours.
- `screenshots/2-sunset-street.jpg` — sunset street-level: warm tint, long
  shadows, player car YOU on the boulevard, park + pond.
- `screenshots/3-night-headlight.jpg` — night: soft headlight pool ahead of
  the car, lit windows, lamp pools, fountain visible at the plaza.
- `screenshots/4-plaza.jpg` — plaza + fountain landmark in frame, traffic
  curving around the roundabout, park + pond at the edge.

## Honest notes
- The headlight is a soft radial pool of light, not a wedge beam: it reads
  as a beam pool and passes the pixel test with a large margin, but a
  directional cone shape could be added in a later stage if the parent
  wants a more beam-like look.
- Trees are flat green circles (cheap, readable at this scale); the night
  scene's upper area is washed grey where lamp pools overlap the headlight
  pool. Both are within the Stage A brief.
- No README.md written (later stage's job). Nothing submitted or bundled.
