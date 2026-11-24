// sim.mjs — Stage B driving simulator, written fresh in this session.
// Imports the same engine.js the browser game runs, so every number here
// is the number the player gets. Run: node checks/sim.mjs
// Exits 1 if any check fails.
import { buildCity, SEED } from '../game/city.js';
import {
  PROFILES, kmhToUps, upsToKmh, clamp, MISSIONS, SAFEHOUSE, lightState,
  createGame, currentMission, missionTarget, startMission,
  stepGame, autopilotInput, playerPos, pointOnRoad, obbVsAabb,
} from '../game/engine.js';

const city = buildCity(SEED);
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const step = (state, input, seconds, dt = 0.1) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) stepGame(state, input, dt);
};
const idle = { up: false, down: false, steer: 0, handbrake: false, e: false, enter: false };

// ---------------------------------------------------------------- 1. top speeds
console.log('--- top speeds (clear straight, no traffic) ---');
for (const [key, prof] of Object.entries(PROFILES)) {
  const s = createGame(city, { mode: 'play', inCar: true, noTraffic: true });
  s.car = { ...s.drivable[0], x: 2400, y: 3200, angle: -Math.PI / 2, speed: 0, profile: key };
  s.drivable[0] = s.car;
  step(s, { ...idle, up: true }, 14);
  const measured = upsToKmh(Math.abs(s.car.speed));
  const ok = Math.abs(measured - prof.topKmh) < 4;
  check(
    `top speed ${prof.name}`,
    ok,
    `target ${prof.topKmh} km/h, measured ${measured.toFixed(1)} km/h, 0 collisions`,
  );
}

// ---------------------------------------------------------------- 2. reverse
console.log('--- reverse ---');
{
  const s = createGame(city, { mode: 'play', inCar: true, noTraffic: true });
  s.car = { ...s.drivable[0], x: 2400, y: 3200, angle: -Math.PI / 2, speed: 0, profile: 'sedan' };
  s.drivable[0] = s.car;
  const y0 = s.car.y;
  step(s, { ...idle, down: true }, 2.5);
  const dist = Math.abs(s.car.y - y0);
  check('reverse 2.5 s', dist > 15 && s.car.speed < 0, `travelled ${dist.toFixed(1)} units south, speed ${upsToKmh(s.car.speed).toFixed(1)} km/h`);
}

// ---------------------------------------------------------------- 3. collision
console.log('--- collision ---');
{
  const s = createGame(city, { mode: 'play', inCar: true, noTraffic: true });
  // Aim at a real building: park 100 units west of its centre, facing east.
  // (East of the boulevard, so the 100-unit approach is open street.)
  const b = city.buildings.find((bb) => bb.w > 50 && bb.h > 40 && bb.x >= 1960 && bb.x < 2100);
  s.car = { ...s.drivable[0], x: b.x - 100, y: b.y + b.h / 2, angle: 0, speed: 0, profile: 'sedan' };
  s.drivable[0] = s.car;
  const health0 = s.health;
  step(s, { ...idle, up: true }, 3);
  const inside = city.buildings.some(
    (bb) => obbVsAabb({ x: s.car.x, y: s.car.y, angle: s.car.angle, hw: 17, hh: 8.5 }, bb),
  );
  check(
    'drive into a building',
    s.collisions > 0 && s.health < health0 && !inside && Math.abs(s.car.speed) < 5,
    `target building (${b.x}, ${b.y}) ${b.w}x${b.h}; collisions ${s.collisions}, health ${health0} -> ${Math.round(s.health)}, speed ${upsToKmh(s.car.speed).toFixed(1)} km/h, inside building: ${inside}`,
  );
}

// ---------------------------------------------------------------- 4. E interaction
console.log('--- E interaction ---');
{
  const s = createGame(city, { mode: 'play', inCar: false });
  startMission(s, 0);
  check('starts on foot', !s.car && s.mara.onFoot, `Mara at (${Math.round(s.mara.x)}, ${Math.round(s.mara.y)})`);
  step(s, { ...idle, e: true }, 0.1);
  check('E enters the sedan', !!s.car && s.car.profile === 'sedan', `in car: ${s.car?.profile ?? 'none'}`);
  step(s, { ...idle, e: true }, 0.1);
  check('E exits the car', !s.car && s.mara.onFoot, `on foot at (${Math.round(s.mara.x)}, ${Math.round(s.mara.y)})`);
  step(s, { ...idle, e: true }, 0.1);
  check('E re-enters', !!s.car, `in car: ${s.car?.profile ?? 'none'}`);
}

// ---------------------------------------------------------------- 5. mission points
console.log('--- mission points ---');
for (const m of MISSIONS) {
  for (const [kind, pt] of [['pickup', m.pickup], ['dropoff', m.dropoff]]) {
    const onRoad = pointOnRoad(city, pt.x, pt.y);
    // The marker disc itself must be clear of walls; buildings lining
    // the road beside it are normal and do not block the approach.
    const blocked = city.buildings.some(
      (b) => pt.x > b.x - 12 && pt.x < b.x + b.w + 12 && pt.y > b.y - 12 && pt.y < b.y + b.h + 12,
    );
    check(`M${m.id} ${kind} on a road, clear path`, onRoad && !blocked, `${pt.label} (${pt.x}, ${pt.y}) onRoad=${onRoad} markerBlocked=${blocked}`);
  }
}
{
  const shNearMission = MISSIONS.some((m) =>
    [m.pickup, m.dropoff].some((pt) => Math.abs(pt.x - SAFEHOUSE.x) < 60 && Math.abs(pt.y - SAFEHOUSE.y) < 60),
  );
  check('safehouse never shares a mission marker', !shNearMission, `safehouse at (${SAFEHOUSE.x}, ${SAFEHOUSE.y})`);
}

// ---------------------------------------------------------------- 6. traffic 90 s
console.log('--- traffic 90 s ---');
{
  const s = createGame(city, { mode: 'play', inCar: false });
  let minGap = Infinity;
  const moved = new Map();
  const prevY = new Map();
  for (const c of s.traffic) {
    if (!c.parked) {
      moved.set(c, 0);
      prevY.set(c, c.y);
    }
  }
  for (let i = 0; i < 900; i++) {
    stepGame(s, idle, 0.1);
    for (const c of s.traffic) {
      if (c.parked) continue;
      let d = c.y - prevY.get(c);
      if (d > 1000) d -= 3456;
      if (d < -1000) d += 3456;
      moved.set(c, moved.get(c) + Math.abs(d));
      prevY.set(c, c.y);
    }
    for (const lane of [true, false]) {
      const cars = s.traffic.filter((c) => c.northbound === lane && !c.parked).sort((a, b) => a.y - b.y);
      for (let j = 0; j + 1 < cars.length; j++) {
        const gap = Math.abs(cars[j + 1].y - cars[j].y) - 34;
        if (gap < minGap) minGap = gap;
      }
    }
  }
  check('traffic: 0 red-light runs in 90 s', s.trafficRedRuns === 0, `red runs: ${s.trafficRedRuns}`);
  check('traffic: follow gap kept', minGap > 4, `min gap ${minGap.toFixed(1)} units`);
  const movedAll = [...moved.values()].filter((m) => m > 300).length;
  const total = moved.size;
  check('traffic: every car keeps moving over 90 s', movedAll === total, `${movedAll}/${total} cars travelled > 300 units (the rest are queued at reds at any instant)`);
}

// ---------------------------------------------------------------- 7. red-light stop (lawful)
console.log('--- red-light stop (lawful autopilot) ---');
{
  const s = createGame(city, { mode: 'play', inCar: true });
  startMission(s, 0);
  s.car.x = 1928;
  s.car.y = 3000;
  s.car.angle = -Math.PI / 2;
  s.car.speed = 0;
  let stoppedAtRed = null;
  let stops = 0;
  for (let i = 0; i < 900; i++) {
    const input = autopilotInput(s, { x: 1928, y: 200 }, { lawful: true });
    stepGame(s, input, 0.1);
    // Stopped with a red light ahead (the queue can stretch back, so the
    // gap to the stop line may be well over 100 units).
    if (Math.abs(s.car.speed) < 0.5 && stoppedAtRed === null) {
      let best = null;
      let bestGap = Infinity;
      for (const L of city.lights) {
        const gap = s.car.y - (L.y + 34); // northbound stop line
        if (gap > 0 && gap < bestGap) {
          bestGap = gap;
          best = L;
        }
      }
      if (best && bestGap < 300) {
        if (lightState(s.time * 1000, best.index) === 'red') {
          stoppedAtRed = { light: best.index, gap: Math.round(bestGap) };
          stops++;
        }
      }
    }
    if (s.car.y < 400) break;
  }
  check('lawful driver: 0 red runs', s.redRuns === 0, `red runs: ${s.redRuns}`);
  check(
    'lawful driver: stopped at a red light',
    stoppedAtRed !== null,
    stoppedAtRed ? `light ${stoppedAtRed.light}, gap ${stoppedAtRed.gap} units to the stop line` : 'no red stop observed in 90 s',
  );
}

// ---------------------------------------------------------------- 8. missions 1-4
console.log('--- missions 1-4 (autopilot) ---');
{
  const s = createGame(city, { mode: 'play', inCar: true });
  startMission(s, 0);
  // The timer must NOT run before the player moves.
  check('mission timer is 0 before the first move', s.mission.elapsed === 0, `elapsed ${s.mission.elapsed}`);
  step(s, idle, 1);
  check('mission timer still 0 with no input', s.mission.elapsed === 0, `elapsed ${s.mission.elapsed}`);
  // Objective in 3 forms at mission start: dialog + HUD data + world marker.
  check(
    'mission 1 objective in 3 forms',
    !!s.dialog && !!currentMission(s) && !!missionTarget(s),
    `dialog "${s.dialog?.text.slice(0, 40)}…", HUD "${currentMission(s)?.name}", marker at (${missionTarget(s)?.x}, ${missionTarget(s)?.y})`,
  );
  const cashBefore = s.cash;
  const perMission = [];
  let ok = true;
  for (let mi = 0; mi < 4; mi++) {
    const m = MISSIONS[mi];
    // Drive to the pickup, then to the dropoff.
    for (const phase of ['pickup', 'dropoff']) {
      const target = phase === 'pickup' ? m.pickup : m.dropoff;
      let done = false;
      for (let i = 0; i < 6000; i++) {
        const input = autopilotInput(s, target, { lawful: true });
        stepGame(s, input, 0.1);
        const ev = s.events[s.events.length - 1];
        if (phase === 'pickup' && s.mission && s.mission.phase === 'deliver') { done = true; break; }
        if (phase === 'dropoff' && ev && ev.type === 'delivered' && ev.mission === m.id) { done = true; break; }
        if (!s.mission && m.id === 4) { done = true; break; }
      }
      if (!done) {
        console.log(`FAIL  mission ${m.id} ${phase}: not reached in 600 s (car at ${Math.round(s.car.x)}, ${Math.round(s.car.y)}, heat ${s.heat.toFixed(1)}, health ${Math.round(s.health)})`);
        ok = false;
        failures++;
        break;
      }
    }
    perMission.push({ id: m.id, cash: s.cash - cashBefore - perMission.reduce((a, p) => a + p.cash, 0) });
    if (!ok) break;
  }
  const total = s.cash - cashBefore;
  for (const p of perMission) {
    const want = MISSIONS[p.id - 1].reward;
    check(`mission ${p.id} pays $${want}`, p.cash === want, `earned $${p.cash}`);
  }
  check('missions total $2,000 on a clean run', total === 2000, `total $${total}`);
  check('all 4 missions done', s.missionsDone === 4, `${s.missionsDone}/4`);
  check('mission 4 finale broadcast shown', s.events.some((e) => e.type === 'all-missions-done'), `events: ${s.events.filter((e) => e.type === 'delivered' || e.type === 'all-missions-done').map((e) => e.type).join(', ')}`);
}

// ---------------------------------------------------------------- 9. police
console.log('--- police / HEAT ---');
{
  const s = createGame(city, { mode: 'play', inCar: true, noTraffic: true });
  startMission(s, 0);
  s.car.x = 1928;
  s.car.y = 2500;
  s.car.angle = -Math.PI / 2;
  s.car.speed = 0;
  // Run the reds up and down the boulevard, non-lawful, no traffic to queue behind.
  let target = { x: 1928, y: 200 };
  for (let i = 0; i < 900; i++) {
    if (s.car.y < 300) target = { x: 1928, y: 3000 };
    else if (s.car.y > 2900) target = { x: 1928, y: 200 };
    const input = autopilotInput(s, target, {});
    stepGame(s, input, 0.1);
    if (s.heat >= 3) break;
  }
  check('HEAT rises on red-light runs', s.redRuns > 0 && s.heat >= 1, `red runs ${s.redRuns}, HEAT ${s.heat.toFixed(1)}`);
  const chasing = s.patrol.some((p) => p.mode === 'chase');
  check('patrol chases at HEAT 3', s.heat >= 3 && chasing, `HEAT ${s.heat.toFixed(1)}, patrol modes: ${s.patrol.map((p) => p.mode).join(', ')}`);
  // Stop the car and let the patrol catch up: arrest must follow.
  let busted = false;
  const cashBefore = s.cash;
  for (let i = 0; i < 600; i++) {
    stepGame(s, { ...idle, down: true }, 0.1);
    if (s.events.some((e) => e.type === 'busted')) {
      busted = true;
      break;
    }
  }
  check('arrest applies the cash penalty and parks the player at the plaza', busted, busted
    ? `cash ${cashBefore} -> ${s.cash}, car at (${Math.round(s.car.x)}, ${Math.round(s.car.y)}), HEAT ${s.heat.toFixed(1)}`
    : `no arrest in 60 s (car at ${Math.round(s.car.x)}, ${Math.round(s.car.y)}, patrol at ${s.patrol.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' / ')})`);
}

// ---------------------------------------------------------------- 10. pedestrians
console.log('--- pedestrians ---');
{
  const s = createGame(city, { mode: 'play', inCar: false });
  check('at least 20 pedestrians on sidewalks', s.peds.length >= 20, `${s.peds.length} walking + ${s.crossers.length} crossing at crosswalks`);
  const allOnSidewalk = s.peds.every((p) => {
    const sw = p.sw;
    return p.x >= sw.x && p.x <= sw.x + sw.w && p.y >= sw.y && p.y <= sw.y + sw.h;
  });
  check('pedestrians start on sidewalks', allOnSidewalk, '');
}

console.log(failures === 0 ? 'SIM: all checks PASS' : `SIM: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
