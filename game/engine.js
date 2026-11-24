// engine.js — "Palkon Auto" 2D, Stage B: pure game logic.
// No DOM, no browser APIs, no network: the browser renderer (game.js) and
// the Node verifier (checks/sim.mjs) both drive this same module, so a
// number measured in the test is the number the player gets.
// Units: world units; 1 unit = 0.5 m, so km/h -> units/s is kmh / 7.2.

import { WORLD_W, WORLD_H, SEED, buildCity, districtAt, lightState } from './city.js';

export { WORLD_W, WORLD_H, SEED, districtAt, lightState };

export const UNIT_PER_M = 2;
export const kmhToUps = (kmh) => (kmh * 1000) / 3600 / 0.5;
export const upsToKmh = (ups) => ups * 0.5 * 3.6;

// ---------------------------------------------------------------- profiles

// Four driving profiles with the exact top speeds from the brief (km/h).
export const PROFILES = {
  compact: { name: 'Compact', topKmh: 115, accel: 30, brake: 52, reverseKmh: 42, color: '#f1c40f' },
  sedan: { name: 'Sedan', topKmh: 130, accel: 28, brake: 50, reverseKmh: 45, color: '#d77f69' },
  van: { name: 'Van', topKmh: 108, accel: 24, brake: 46, reverseKmh: 40, color: '#7f8c8d' },
  coupe: { name: 'Coupe', topKmh: 158, accel: 34, brake: 56, reverseKmh: 48, color: '#c0392b' },
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

// ---------------------------------------------------------------- collision

// Rotated-rectangle (car) vs axis-aligned rectangle (building), SAT.
// Returns { overlap, nx, ny } (minimum push-out) or null.
export function obbVsAabb(car, b) {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const ux = c;
  const uy = s;
  const vx = -s;
  const vy = c;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const axes = [
    { x: ux, y: uy },
    { x: vx, y: vy },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  let minOverlap = Infinity;
  let minAxis = null;
  for (const ax of axes) {
    const rCar =
      car.hw * Math.abs(ux * ax.x + uy * ax.y) + car.hh * Math.abs(vx * ax.x + vy * ax.y);
    const rB = (b.w / 2) * Math.abs(ax.x) + (b.h / 2) * Math.abs(ax.y);
    const d = (car.x - bcx) * ax.x + (car.y - bcy) * ax.y;
    const overlap = rCar + rB - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sign = d < 0 ? -1 : 1;
      minAxis = { x: ax.x * sign, y: ax.y * sign };
    }
  }
  if (!minAxis) return null; // non-finite inputs: never crash the game loop
  return { overlap: minOverlap, nx: minAxis.x, ny: minAxis.y };
}

// Rotated-rectangle vs rotated-rectangle (car vs car), SAT.
export function obbVsObb(a, b) {
  const axesFor = (car) => {
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    return [
      { x: c, y: s },
      { x: -s, y: c },
    ];
  };
  const axes = [...axesFor(a), ...axesFor(b)];
  let minOverlap = Infinity;
  let minAxis = null;
  for (const ax of axes) {
    const rA =
      a.hw * Math.abs(Math.cos(a.angle) * ax.x + Math.sin(a.angle) * ax.y) +
      a.hh * Math.abs(-Math.sin(a.angle) * ax.x + Math.cos(a.angle) * ax.y);
    const rB =
      b.hw * Math.abs(Math.cos(b.angle) * ax.x + Math.sin(b.angle) * ax.y) +
      b.hh * Math.abs(-Math.sin(b.angle) * ax.x + Math.cos(b.angle) * ax.y);
    const d = (a.x - b.x) * ax.x + (a.y - b.y) * ax.y;
    const overlap = rA + rB - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sign = d < 0 ? -1 : 1;
      minAxis = { x: ax.x * sign, y: ax.y * sign };
    }
  }
  return { overlap: minOverlap, nx: minAxis.x, ny: minAxis.y };
}

// Circle (on-foot Mara, fountain) vs AABB.
export function circleVsAabb(cx, cy, r, b) {
  const nx = clamp(cx, b.x, b.x + b.w);
  const ny = clamp(cy, b.y, b.y + b.h);
  const dx = cx - nx;
  const dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    return { overlap: r - d, nx: dx / d, ny: dy / d };
  }
  // Centre inside the rect: push out along the smallest penetration.
  const left = cx - b.x;
  const right = b.x + b.w - cx;
  const top = cy - b.y;
  const bottom = b.y + b.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { overlap: r + left, nx: -1, ny: 0 };
  if (m === right) return { overlap: r + right, nx: 1, ny: 0 };
  if (m === top) return { overlap: r + top, nx: 0, ny: -1 };
  return { overlap: r + bottom, nx: 0, ny: 1 };
}

export function pointOnRoad(city, x, y) {
  for (const r of city.roads) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
  }
  const dx = x - city.plaza.cx;
  const dy = y - city.plaza.cy;
  return dx * dx + dy * dy < city.plaza.r * city.plaza.r;
}

// ---------------------------------------------------------------- road graph

// Nodes are the intersections of road centre-lines; edges run along the
// roads themselves, so a route never cuts through a block. The plaza
// intersection (1920, 1728) is the fountain, so it is replaced by a ring
// of four bypass nodes around the fountain.
export function buildRoadGraph(city) {
  const vLines = [];
  const hLines = [];
  for (const r of city.roads) {
    if (r.vertical) vLines.push({ x: r.x + r.w / 2, y0: r.y, y1: r.y + r.h });
    else hLines.push({ y: r.y + r.h / 2, x0: r.x, x1: r.x + r.w });
  }
  const nodes = [];
  const byKey = new Map();
  const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;
  const addNode = (x, y) => {
    const k = key(x, y);
    if (byKey.has(k)) return byKey.get(k);
    const n = { x, y, links: [] };
    nodes.push(n);
    byKey.set(k, n);
    return n;
  };
  const link = (a, b) => {
    if (a === b) return;
    if (!a.links.includes(b)) a.links.push(b);
    if (!b.links.includes(a)) b.links.push(a);
  };
  for (const v of vLines) {
    for (const h of hLines) {
      if (h.y >= v.y0 - 1 && h.y <= v.y1 + 1 && v.x >= h.x0 - 1 && v.x <= h.x1 + 1) {
        addNode(v.x, h.y);
      }
    }
  }
  for (const v of vLines) {
    const ns = nodes
      .filter((n) => Math.abs(n.x - v.x) < 1 && n.y >= v.y0 - 1 && n.y <= v.y1 + 1)
      .sort((a, b) => a.y - b.y);
    for (let i = 0; i + 1 < ns.length; i++) link(ns[i], ns[i + 1]);
  }
  for (const h of hLines) {
    const ns = nodes
      .filter((n) => Math.abs(n.y - h.y) < 1 && n.x >= h.x0 - 1 && n.x <= h.x1 + 1)
      .sort((a, b) => a.x - b.x);
    for (let i = 0; i + 1 < ns.length; i++) link(ns[i], ns[i + 1]);
  }
  // Plaza bypass: replace the fountain node with a ring around it. The
  // ring sits 95 units out — clear of the fountain's 56-unit collision
  // circle even when a car cuts the corner between two ring nodes.
  const centre = byKey.get(key(city.plaza.cx, city.plaza.cy));
  if (centre) {
    const ring = [
      addNode(city.plaza.cx - 95, city.plaza.cy), // west
      addNode(city.plaza.cx, city.plaza.cy - 95), // north
      addNode(city.plaza.cx + 95, city.plaza.cy), // east
      addNode(city.plaza.cx, city.plaza.cy + 95), // south
    ];
    for (let i = 0; i < 4; i++) link(ring[i], ring[(i + 1) % 4]);
    const neighbours = [...centre.links];
    for (const nb of neighbours) {
      nb.links = nb.links.filter((n) => n !== centre);
      let best = null;
      let bestD = Infinity;
      for (const rn of ring) {
        const d = dist2(nb.x, nb.y, rn.x, rn.y);
        if (d < bestD) {
          bestD = d;
          best = rn;
        }
      }
      if (best) link(nb, best);
    }
    const idx = nodes.indexOf(centre);
    if (idx >= 0) nodes.splice(idx, 1);
    byKey.delete(key(city.plaza.cx, city.plaza.cy));
  }
  return { nodes, byKey };
}

function nearestNode(graph, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const n of graph.nodes) {
    const d = dist2(x, y, n.x, n.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// Shortest route by distance (Dijkstra — the graph is small): [start,
// ...nodes, target]. Never cuts a block. Plain BFS ties on edge count
// and picked the longer 2400 road over the ring (both 7 edges), which
// also kept the car off the boulevard's traffic lights.
export function findRoute(graph, from, to) {
  const start = nearestNode(graph, from.x, from.y);
  const goal = nearestNode(graph, to.x, to.y);
  if (!start || !goal) return [from, to];
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const done = new Set();
  while (true) {
    let cur = null;
    let best = Infinity;
    for (const [n, d] of dist) {
      if (!done.has(n) && d < best) {
        best = d;
        cur = n;
      }
    }
    if (!cur) break;
    if (cur === goal) break;
    done.add(cur);
    for (const nb of cur.links) {
      const nd = best + Math.sqrt(dist2(cur.x, cur.y, nb.x, nb.y));
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd);
        prev.set(nb, cur);
      }
    }
  }
  if (!dist.has(goal) && goal !== start) return [from, to];
  const path = [];
  let cur = goal;
  while (cur && cur !== start) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  path.unshift(start);
  const out = [{ x: from.x, y: from.y }];
  for (const n of path) {
    const last = out[out.length - 1];
    if (dist2(last.x, last.y, n.x, n.y) > 400) out.push({ x: n.x, y: n.y });
  }
  const last = out[out.length - 1];
  if (dist2(last.x, last.y, to.x, to.y) > 400) out.push({ x: to.x, y: to.y });
  else out[out.length - 1] = { x: to.x, y: to.y };
  return out;
}

// ---------------------------------------------------------------- missions

// Missions 1-4. Clean-play total $2,000. Every pickup/dropoff sits ON a
// road (or the plaza paving), so a clear, collision-free path leads to it.
export const MISSIONS = [
  {
    id: 1,
    name: 'A Receipt for Sunshine',
    reward: 250,
    speaker: 'Neri',
    brief:
      "Mara — Bastion Civic seized my cafe's sunshine permit. The receipt is at my place, on the boulevard. Bring it to the Solmar Grand and we can prove the tax was paid.",
    pickup: { x: 1928, y: 1560, label: "NERI'S — pick up the receipt" },
    dropoff: { x: 1928, y: 700, label: 'SOLMAR GRAND — deliver the receipt' },
    pickupLine: 'Receipt in hand. The Grand is straight up the boulevard.',
    doneLine: 'Delivered. Neri owes you one — $250.',
  },
  {
    id: 2,
    name: 'Salt Ledger',
    reward: 500,
    speaker: 'Oren',
    brief:
      "Oren's waiting in his car by the harbour gate with the salt ledger — Silas Rook's men want it badly. Collect it from Oren himself, then bring it to my garage on the boulevard.",
    pickup: { x: 2880, y: 3024, label: 'HARBOUR GATE — Oren waits in his car' },
    dropoff: { x: 1928, y: 2400, label: "OREN'S GARAGE — deliver the ledger" },
    pickupLine: 'Ledger secured. Oren says drive like the tide is behind you.',
    doneLine: 'Ledger safe at the garage. $500, no questions asked.',
  },
  {
    id: 3,
    name: 'After the Shutters',
    reward: 450,
    speaker: 'Neri',
    brief:
      "The market stalls close at 18:00. After the shutters come down, collect the goods from South Market and run them up to Glasspoint — quietly.",
    pickup: { x: 960, y: 2592, label: 'SOUTH MARKET — collect the goods (after 18:00)' },
    dropoff: { x: 2880, y: 864, label: 'GLASSPOINT — deliver the goods' },
    pickupLine: 'Goods loaded. Glasspoint is waiting.',
    doneLine: 'Delivered after dark, no eyes on you. $450.',
    afterClose: true,
    closeMin: 18 * 60,
  },
  {
    id: 4,
    name: 'Glass Debt',
    reward: 800,
    speaker: 'Mara',
    brief:
      "The finale. Collect the glass debt from Citrus Quarter and settle it at the Glasspoint tower. When it's done, the whole city hears about it.",
    pickup: { x: 2400, y: 1728, label: 'CITRUS QUARTER — collect the glass debt' },
    dropoff: { x: 3360, y: 1296, label: 'GLASSPOINT TOWER — settle the debt' },
    pickupLine: 'Debt in hand. One last drive — make it count.',
    doneLine: 'The Glass Debt is settled. Solmar is yours tonight. $800.',
  },
];

export const RADIO_TRACKS = [
  'Midnight Mirage — The Velvet Static',
  'Boulevard Lights — Cassia Ray',
  'Salt Air — The Harbormen',
  'Neon Palms — DJ Coral',
];

// The safehouse: Mara's place by the park. Its marker is a house icon in
// pink — never the same marker, colour or icon as a mission target.
export const SAFEHOUSE = { x: 2050, y: 1990, label: 'SAFEHOUSE — Mara’s place' };

// ---------------------------------------------------------------- state

export function createGame(city, opts = {}) {
  const graph = buildRoadGraph(city);
  const rng = (() => {
    let a = (opts.seed ?? SEED) >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  // Drivable cars: Mara's sedan plus one of each other profile, parked
  // around the city and drawn with a green ring + key so they read as
  // drivable at a glance. Every other parked car stays locked.
  const drivable = [
    { x: 1928, y: 1900, angle: -Math.PI / 2, speed: 0, profile: 'sedan', color: PROFILES.sedan.color, id: 'mara' },
    { x: 1942, y: 768, angle: -Math.PI / 2, speed: 0, profile: 'compact', color: PROFILES.compact.color, id: 'taxi' },
    { x: 1898, y: 2280, angle: Math.PI / 2, speed: 0, profile: 'van', color: PROFILES.van.color, id: 'van' },
    { x: 2388, y: 1152, angle: Math.PI / 2, speed: 0, profile: 'coupe', color: PROFILES.coupe.color, id: 'coupe' },
  ];
  // Oren's car for mission 2: a person inside a parked car. Its marker
  // points at the car itself (pink, person icon), never at a building.
  const orenCar = { x: 2912, y: 3024, angle: Math.PI, speed: 0, profile: 'sedan', color: '#ecf0f1', id: 'oren', person: 'Oren' };

  const traffic = [];
  if (!opts.noTraffic) {
    for (const c of city.traffic) {
      // Never spawn a traffic car on top of Mara's car: the player starts
      // in the northbound lane at y=1900, and a car spawning there would
      // grind against the player from the first frame.
      let y0 = c.y0;
      if (Math.abs(y0 - 1900) < 160) y0 += c.northbound ? -250 : 250;
      y0 = (((y0 % WORLD_H) + WORLD_H) % WORLD_H);
      traffic.push({
        x: c.x,
        y: y0,
        angle: c.northbound ? -Math.PI / 2 : Math.PI / 2,
        baseSpeed: 28 + (c.speed / 140) * 22, // 28-50 u/s, city pace
        speed: 0,
        northbound: c.northbound,
        color: c.color,
        hw: 17,
        hh: 8.5,
      });
    }
  }
  if (opts.beamCar) {
    traffic.push({
      x: 1928,
      y: 1700,
      angle: -Math.PI / 2,
      baseSpeed: 0,
      speed: 0,
      northbound: true,
      color: '#ecf0f1',
      hw: 17,
      hh: 8.5,
      parked: true,
    });
  }

  const peds = city.pedestrians.slice(0, 110).map((p) => ({
    x: p.x,
    y: p.y,
    axis: p.axis,
    sw: p.sw,
    speed: 8 + rng() * 7,
    dir: rng() < 0.5 ? 1 : -1,
  }));
  // Crosswalk pedestrians: they cross the boulevard at the plaza
  // crosswalk, pausing at the curb — never jaywalking mid-block.
  const crossers = [];
  for (let i = 0; i < 8; i++) {
    crossers.push({
      x: 1892 + rng() * 56,
      y: 1700 + rng() * 56,
      dir: rng() < 0.5 ? 1 : -1,
      speed: 10 + rng() * 6,
      wait: rng() * 4,
    });
  }

  // Two patrol cars loop a big rectangle around the city and are visible
  // from the start; they only chase at HEAT 3 or higher.
  const patrol = [
    { x: 1928, y: 2600, angle: -Math.PI / 2, speed: 0, mode: 'loop', wp: 0, chaseT: 0, arrestT: 0 },
    { x: 1912, y: 1000, angle: Math.PI / 2, speed: 0, mode: 'loop', wp: 2, chaseT: 0, arrestT: 0 },
  ];
  const patrolLoop = [
    { x: 1928, y: 900 },
    { x: 2880, y: 864 },
    { x: 2880, y: 2592 },
    { x: 1928, y: 2592 },
  ];

  const state = {
    city,
    graph,
    time: (opts.t0 ?? 1200) / 1000,
    clockMin: 17 * 60 + 45, // 17:45 — mission 3 closes at 18:00
    mode: opts.mode ?? 'title',
    mara: { x: 1975, y: 1920, angle: -Math.PI / 2, onFoot: !(opts.inCar ?? false) },
    car: null,
    drivable,
    orenCar,
    traffic,
    peds,
    crossers,
    patrol,
    patrolLoop,
    heat: 0,
    cash: 0,
    health: 100,
    shake: 0,
    dust: [],
    missionIndex: 0,
    mission: null,
    missionsDone: 0,
    firstMove: false,
    dialog: null,
    broadcast: null,
    busted: null,
    wrecked: null,
    radioTrack: 0,
    radioT: 0,
    redRuns: 0,
    trafficRedRuns: 0,
    collisions: 0,
    events: [],
    lastLightPass: {},
    cleanT: 0,
    menuIndex: 0,
    showHelp: false,
  };

  if (opts.inCar ?? false) {
    state.car = drivable[0];
  }
  return state;
}

export function currentMission(state) {
  return MISSIONS[state.missionIndex] ?? null;
}

export function missionTarget(state) {
  const m = currentMission(state);
  if (!m || !state.mission) return null;
  if (state.mission.phase === 'pickup') return { ...m.pickup, kind: 'pickup', mission: m };
  return { ...m.dropoff, kind: 'dropoff', mission: m };
}

export function startMission(state, index) {
  const m = MISSIONS[index];
  if (!m) {
    state.mission = null;
    return;
  }
  state.missionIndex = index;
  state.mission = { phase: 'pickup', elapsed: 0, started: false };
  state.firstMove = false;
  state.dialog = { speaker: m.speaker, text: m.brief, until: state.time + 9 };
}

export function failMission(state, reason) {
  const m = currentMission(state);
  if (!m) return;
  state.cash = Math.max(0, state.cash - 150);
  state.events.push({ type: reason, t: state.time, cash: state.cash });
  startMission(state, state.missionIndex);
  state.health = 100;
  state.heat = 1;
  // Recovery: parked at the central plaza, off the traffic lanes, facing
  // north up the boulevard.
  if (state.car) {
    state.car.x = 1850;
    state.car.y = 1728;
    state.car.angle = -Math.PI / 2;
    state.car.speed = 0;
  } else {
    state.mara.x = 1850;
    state.mara.y = 1728;
    state.mara.onFoot = true;
  }
  state.dialog = {
    speaker: 'SOLMAR FM',
    text:
      reason === 'busted'
        ? 'BUSTED — the patrol caught up with you. $150 fine, mission restarted. Your car is back at the plaza.'
        : 'WRECKED — the car is a write-off. $150 in repairs, mission restarted. Your car is back at the plaza.',
    until: state.time + 8,
  };
}

// ---------------------------------------------------------------- stepping

export function playerPos(state) {
  return state.car ? { x: state.car.x, y: state.car.y } : { x: state.mara.x, y: state.mara.y };
}

function nearestDrivable(state, x, y, maxD) {
  let best = null;
  let bestD = maxD * maxD;
  for (const c of state.drivable) {
    if (state.car === c) continue;
    const d = dist2(x, y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function stepTraffic(state, dt) {
  const tMs = state.time * 1000;
  const cars = state.traffic;
  for (const c of cars) {
    if (c.parked) continue;
    const dir = c.northbound ? -1 : 1;
    // Next light ahead and its stop line.
    let targetSpeed = c.baseSpeed;
    let nearestStop = Infinity;
    let nearestLight = null;
    for (const L of state.city.lights) {
      const stopY = L.y - dir * 34; // northbound stops south of the light
      // Distance to the stop line, positive while the car is approaching it.
      const distToStop = dir * (stopY - c.y);
      if (distToStop > 0 && distToStop < nearestStop) {
        nearestStop = distToStop;
        nearestLight = L;
      }
    }
    if (nearestLight && nearestStop < 170) {
      const ls = lightState(tMs, nearestLight.index);
      if (ls !== 'green') {
        targetSpeed = Math.min(targetSpeed, clamp((nearestStop - 4) * 0.9, 0, c.baseSpeed));
      }
    }
    // Follow gap: the car ahead in the same lane.
    let ahead = null;
    let aheadGap = Infinity;
    for (const o of cars) {
      if (o === c || o.parked || o.northbound !== c.northbound || o.x !== c.x) continue;
      const gap = dir * (o.y - c.y);
      if (gap > 0 && gap < aheadGap) {
        aheadGap = gap;
        ahead = o;
      }
    }
    if (ahead && aheadGap < 95) {
      targetSpeed = Math.min(targetSpeed, Math.max(0, (aheadGap - 40) * 1.4), ahead.speed + 4);
    }
    // Yield to the player car when it is ahead in the same lane, going
    // the same way. A player in the opposite lane, or facing the other
    // way, is not in this car's path and must never stop it.
    if (state.car) {
      const sameWay = Math.cos(state.car.angle - c.angle) > 0.5;
      if (sameWay && Math.abs(state.car.x - c.x) < 14) {
        const gap = dir * (state.car.y - c.y);
        if (gap > 0 && gap < 95) {
          targetSpeed = Math.min(targetSpeed, Math.max(0, (gap - 40) * 1.4), Math.max(0, state.car.speed) + 4);
        }
      }
    }
    // Ease toward the target speed.
    if (c.speed < targetSpeed) c.speed = Math.min(targetSpeed, c.speed + 25 * dt);
    else c.speed = Math.max(targetSpeed, c.speed - 45 * dt);
    const prevY = c.y;
    c.y += dir * c.speed * dt;
    const wrapped = Math.abs(c.y - prevY) > 100;
    if (c.y < 0) c.y += WORLD_H;
    if (c.y >= WORLD_H) c.y -= WORLD_H;
    // Red-run detection: crossing a stop line while the light is red.
    // A wrap-around step teleports the car across the map, so it must not
    // count as a crossing; and the previous distance must be small, so a
    // stale value can never fake a crossing.
    if (nearestLight && !wrapped) {
      const stopY = nearestLight.y - dir * 34;
      const wasBefore = dir * (stopY - prevY);
      const nowPast = dir * (stopY - c.y) <= 0;
      if (wasBefore > 0 && wasBefore < 12 && nowPast) {
        const ls = lightState(tMs, nearestLight.index);
        const last = c.lastRedPass ?? -100;
        if (ls === 'red' && state.time - last > 10) {
          state.trafficRedRuns++;
          c.lastRedPass = state.time;
          state.events.push({ type: 'traffic-red-run', t: state.time, light: nearestLight.index });
        }
      }
    }
  }
}

function stepPeds(state, dt) {
  for (const p of state.peds) {
    if (p.axis === 'v') {
      p.y += p.dir * p.speed * dt;
      if (p.y <= p.sw.y + 2) {
        p.y = p.sw.y + 2;
        p.dir = 1;
      } else if (p.y >= p.sw.y + p.sw.h - 2) {
        p.y = p.sw.y + p.sw.h - 2;
        p.dir = -1;
      }
    } else {
      p.x += p.dir * p.speed * dt;
      if (p.x <= p.sw.x + 2) {
        p.x = p.sw.x + 2;
        p.dir = 1;
      } else if (p.x >= p.sw.x + p.sw.w - 2) {
        p.x = p.sw.x + p.sw.w - 2;
        p.dir = -1;
      }
    }
  }
  for (const c of state.crossers) {
    if (c.wait > 0) {
      c.wait -= dt;
      continue;
    }
    c.x += c.dir * c.speed * dt;
    if (c.x <= 1892) {
      c.x = 1892;
      c.dir = 1;
      c.wait = 2 + Math.random() * 3;
    } else if (c.x >= 1948) {
      c.x = 1948;
      c.dir = -1;
      c.wait = 2 + Math.random() * 3;
    }
  }
}

function stepPatrol(state, dt) {
  const player = state.car ? { x: state.car.x, y: state.car.y, speed: state.car.speed } : null;
  for (const p of state.patrol) {
    if (state.heat >= 3 && player) {
      p.mode = 'chase';
    } else if (state.heat < 2.5) {
      if (p.mode === 'chase') p.mode = 'loop';
    }
    if (p.mode === 'chase' && player) {
      const d = Math.sqrt(dist2(p.x, p.y, player.x, player.y));
      const desired = Math.atan2(player.y - p.y, player.x - p.x);
      p.angle += clamp(angleDiff(desired, p.angle), -2.4 * dt, 2.4 * dt);
      // Close in fast from afar, then pull up alongside and stop — a
      // patrol that blows past at 40 u/s can never make the arrest.
      // It stops inside the 34-unit arrest radius, not outside it.
      const targetSpeed = d < 30 ? 0 : d < 120 ? Math.max(0, Math.abs(player.speed) + 2) : Math.min(78, Math.max(40, Math.abs(player.speed) + 12));
      if (p.speed < targetSpeed) p.speed = Math.min(targetSpeed, p.speed + 30 * dt);
      else p.speed = Math.max(targetSpeed, p.speed - 50 * dt);
      p.x += Math.cos(p.angle) * p.speed * dt;
      p.y += Math.sin(p.angle) * p.speed * dt;
      p.x = clamp(p.x, 20, WORLD_W - 20);
      p.y = clamp(p.y, 20, WORLD_H - 20);
      // Ram: contact with the player car hurts the player.
      if (state.car && dist2(p.x, p.y, player.x, player.y) < 34 * 34) {
        const impact = Math.abs(p.speed - player.speed);
        if (impact > 8 && state.time - (p.lastRam ?? -10) > 1.5) {
          p.lastRam = state.time;
          state.health = Math.max(0, state.health - Math.min(18, impact * 0.4));
          state.heat = clamp(state.heat + 0.2, 0, 5);
          state.shake = 1;
          state.collisions++;
          state.events.push({ type: 'rammed', t: state.time, health: state.health });
        }
      }
      // Arrest: player pinned, slow, patrol on top of them.
      if (Math.abs(player.speed) < 5 && d < 34) {
        p.arrestT += dt;
        if (p.arrestT > 2) {
          failMission(state, 'busted');
          p.arrestT = 0;
          p.mode = 'loop';
        }
      } else {
        p.arrestT = 0;
      }
      if (d > 600) {
        p.chaseT += dt;
        if (p.chaseT > 5) {
          p.mode = 'loop';
          p.chaseT = 0;
        }
      } else {
        p.chaseT = 0;
      }
    } else {
      // Loop the rectangle: boulevard -> 864 east -> 2880 south -> 2592 west.
      const wp = state.patrolLoop[p.wp];
      const d = Math.sqrt(dist2(p.x, p.y, wp.x, wp.y));
      if (d < 30) {
        p.wp = (p.wp + 1) % state.patrolLoop.length;
      } else {
        const desired = Math.atan2(wp.y - p.y, wp.x - p.x);
        p.angle += clamp(angleDiff(desired, p.angle), -2.0 * dt, 2.0 * dt);
        p.speed = Math.min(52, p.speed + 22 * dt);
        p.x += Math.cos(p.angle) * p.speed * dt;
        p.y += Math.sin(p.angle) * p.speed * dt;
      }
    }
  }
}

function collideCarWithWorld(state, car) {
  const city = state.city;
  const box = { x: car.x, y: car.y, angle: car.angle, hw: 17, hh: 8.5 };
  let hit = false;
  for (const b of city.buildings) {
    if (Math.abs(b.x + b.w / 2 - car.x) > 220 || Math.abs(b.y + b.h / 2 - car.y) > 220) continue;
    const res = obbVsAabb(box, b);
    if (res) {
      car.x += res.nx * res.overlap;
      car.y += res.ny * res.overlap;
      hit = true;
    }
  }
  // The plaza fountain is a roundabout, not a wall to drive through.
  const fdx = car.x - city.fountain.cx;
  const fdy = car.y - city.fountain.cy;
  const fd = Math.sqrt(fdx * fdx + fdy * fdy);
  if (fd < 42 + 14 && fd > 0.01) {
    const push = 42 + 14 - fd;
    car.x += (fdx / fd) * push;
    car.y += (fdy / fd) * push;
    hit = true;
  }
  return hit;
}

function stepPlayerCar(state, input, dt) {
  const car = state.car;
  if (!car) return;
  const prof = PROFILES[car.profile];
  const vmax = kmhToUps(prof.topKmh);
  const revMax = kmhToUps(prof.reverseKmh);
  const speedBefore = car.speed;

  if (input.up) {
    car.speed += prof.accel * Math.max(0, 1 - car.speed / vmax) * dt;
  } else if (input.down) {
    if (car.speed > 1) car.speed -= prof.brake * dt;
    else car.speed -= prof.accel * 0.6 * Math.max(0, 1 + car.speed / revMax) * dt;
  } else {
    // Rolling drag.
    const drag = 8 * dt + Math.abs(car.speed) * 0.12 * dt;
    if (Math.abs(car.speed) <= drag) car.speed = 0;
    else car.speed -= Math.sign(car.speed) * drag;
  }
  if (input.handbrake) {
    const dec = 60 * dt;
    if (Math.abs(car.speed) <= dec) car.speed = 0;
    else car.speed -= Math.sign(car.speed) * dec;
  }
  car.speed = clamp(car.speed, -revMax, vmax);

  const steerMax = 0.7 * (input.handbrake ? 1.5 : 1) * (1 / (1 + Math.abs(car.speed) * 0.015));
  const steer = clamp(input.steer ?? 0, -1, 1) * steerMax;
  car.angle += (car.speed / 24) * Math.tan(steer) * dt;

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  if (car.x < 10 || car.x > WORLD_W - 10) {
    car.x = clamp(car.x, 10, WORLD_W - 10);
    car.speed *= 0.5;
  }
  if (car.y < 10 || car.y > WORLD_H - 10) {
    car.y = clamp(car.y, 10, WORLD_H - 10);
    car.speed *= 0.5;
  }

  // Building / fountain collision: stop + damage feedback. Damage, HEAT
  // and the event are rate-limited per impact so one grind against a wall
  // cannot drain the car in a single second; the push-out still applies
  // every step.
  const hitWall = collideCarWithWorld(state, car);
  if (hitWall && Math.abs(speedBefore) > 12 && state.time - (state.lastWallHit ?? -10) > 0.8) {
    state.lastWallHit = state.time;
    const dmg = Math.min(22, (Math.abs(speedBefore) - 12) * 0.5);
    state.health = Math.max(0, state.health - dmg);
    state.heat = clamp(state.heat + 0.4, 0, 5);
    state.shake = 1;
    state.collisions++;
    state.events.push({ type: 'collision', t: state.time, damage: Math.round(dmg), health: Math.round(state.health) });
    for (let i = 0; i < 6; i++) {
      state.dust.push({ x: car.x, y: car.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.7 });
    }
    car.speed = -car.speed * 0.15;
  } else if (hitWall) {
    car.speed *= 0.5;
  }

  // Car vs traffic car. The hitbox is a touch narrower than the drawn
  // body (15 x 5 half-extents): two cars passing in adjacent lanes 16
  // units apart, or past a parked row 12 units off the centre-line, must
  // not count as a crash.
  for (const t of state.traffic) {
    if (t.parked) continue;
    if (dist2(car.x, car.y, t.x, t.y) > 60 * 60) continue;
    const res = obbVsObb(
      { x: car.x, y: car.y, angle: car.angle, hw: 15, hh: 5 },
      { x: t.x, y: t.y, angle: t.angle, hw: 15, hh: 5 },
    );
    if (res) {
      car.x += res.nx * res.overlap;
      car.y += res.ny * res.overlap;
      // A corner graze while turning past a car in the next lane
      // penetrates only a few units — it nudges the cars apart but is
      // not a crash. Only a deep overlap counts as an impact.
      if (res.overlap < 4) continue;
      const impact = Math.abs(car.speed - t.speed);
      if (impact > 10 && state.time - (state.lastTrafficHit ?? -10) > 1.0) {
        state.lastTrafficHit = state.time;
        const dmg = Math.min(16, (impact - 10) * 0.4);
        state.health = Math.max(0, state.health - dmg);
        state.heat = clamp(state.heat + 0.3, 0, 5);
        state.shake = 1;
        state.collisions++;
        state.events.push({ type: 'collision-traffic', t: state.time, damage: Math.round(dmg) });
        car.speed *= 0.4;
        t.speed *= 0.5;
      } else {
        car.speed *= 0.7;
      }
    }
  }

  // Parked cars are solid too — locked ones, drivable ones and Oren's
  // car. (A drivable car that sits on a parked-car slot is checked once.)
  const parkedSolid = [...state.city.parked, state.orenCar];
  for (const d of state.drivable) {
    if (d === state.car) continue;
    if (!state.city.parked.some((p) => Math.abs(p.x - d.x) < 4 && Math.abs(p.y - d.y) < 4)) {
      parkedSolid.push(d);
    }
  }
  for (const p of parkedSolid) {
    if (dist2(car.x, car.y, p.x, p.y) > 60 * 60) continue;
    const res = obbVsObb(
      { x: car.x, y: car.y, angle: car.angle, hw: 15, hh: 5 },
      { x: p.x, y: p.y, angle: p.angle, hw: 15, hh: 5 },
    );
    if (res) {
      car.x += res.nx * res.overlap;
      car.y += res.ny * res.overlap;
      // Same graze rule as traffic: a shallow brush is not a crash.
      if (res.overlap < 4) continue;
      const impact = Math.abs(car.speed);
      if (impact > 12 && state.time - (state.lastWallHit ?? -10) > 0.8) {
        state.lastWallHit = state.time;
        const dmg = Math.min(18, (impact - 12) * 0.5);
        state.health = Math.max(0, state.health - dmg);
        state.heat = clamp(state.heat + 0.3, 0, 5);
        state.shake = 1;
        state.collisions++;
        state.events.push({ type: 'collision-parked', t: state.time, damage: Math.round(dmg) });
        car.speed *= 0.3;
      } else {
        car.speed *= 0.6;
      }
    }
  }

  // Red-light run: crossing a stop line while the light is red.
  const tMs = state.time * 1000;
  const dir = car.speed >= 0 ? Math.cos(car.angle) : -Math.cos(car.angle);
  for (const L of state.city.lights) {
    if (Math.abs(car.x - 1920) > 60) continue;
    const movingNorth = Math.sin(car.angle) < -0.5;
    const movingSouth = Math.sin(car.angle) > 0.5;
    if (!movingNorth && !movingSouth) continue;
    const stopY = movingNorth ? L.y + 34 : L.y - 34;
    const key = `${L.index}:${movingNorth ? 'n' : 's'}`;
    const before = (state.prevStopDist ?? {})[key];
    const distNow = movingNorth ? car.y - stopY : stopY - car.y;
    // A genuine crossing moves a few units per step; a stale `before`
    // (the car was pushed sideways at the fountain, or left the road)
    // must never fake a red-light run.
    if (before !== undefined && before > 0 && before < 12 && distNow <= 0) {
      const ls = lightState(tMs, L.index);
      if (ls === 'red' && state.time - (state.lastLightPass[key] ?? -100) > 8) {
        state.lastLightPass[key] = state.time;
        state.redRuns++;
        // A red run is a serious violation: it must build HEAT faster
        // than clean driving sheds it, or three reds in a row would
        // never reach the chase threshold. It also resets the clean
        // timer, so the decay does not start until the driver has been
        // clean for a while after the violation.
        state.heat = clamp(state.heat + 2, 0, 5);
        state.cleanT = 0;
        state.events.push({ type: 'red-run', t: state.time, light: L.index });
      }
    }
    state.prevStopDist = { ...(state.prevStopDist ?? {}), [key]: distNow };
  }
  void dir;

  // Speeding raises HEAT; clean driving lowers it — but never while a
  // patrol is actively chasing, or the chase would give up mid-pursuit.
  // The decay is slow (0.05/s after 10 s clean): a driver who keeps
  // breaking the law must stay hot.
  const beingChased = state.patrol.some((p) => p.mode === 'chase');
  if (Math.abs(car.speed) > kmhToUps(90)) {
    state.heat = clamp(state.heat + 0.15 * dt, 0, 5);
    state.cleanT = 0;
  } else {
    state.cleanT += dt;
    if (state.cleanT > 10 && !beingChased) state.heat = clamp(state.heat - 0.05 * dt, 0, 5);
  }

  if (state.health <= 0) failMission(state, 'wrecked');
}

function stepMara(state, input, dt) {
  const m = state.mara;
  let dx = 0;
  let dy = 0;
  if (input.up) dy -= 1;
  if (input.down) dy += 1;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;
  if (dx !== 0 || dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    const sp = 95;
    m.x += (dx / len) * sp * dt;
    m.y += (dy / len) * sp * dt;
    m.angle = Math.atan2(dy, dx);
    state.firstMove = true;
  }
  m.x = clamp(m.x, 10, WORLD_W - 10);
  m.y = clamp(m.y, 10, WORLD_H - 10);
  for (const b of state.city.buildings) {
    if (Math.abs(b.x + b.w / 2 - m.x) > 120 || Math.abs(b.y + b.h / 2 - m.y) > 120) continue;
    const res = circleVsAabb(m.x, m.y, 7, b);
    if (res) {
      m.x += res.nx * res.overlap;
      m.y += res.ny * res.overlap;
    }
  }
  const fdx = m.x - state.city.fountain.cx;
  const fdy = m.y - state.city.fountain.cy;
  const fd = Math.sqrt(fdx * fdx + fdy * fdy);
  if (fd < 42 + 7 && fd > 0.01) {
    const push = 42 + 7 - fd;
    m.x += (fdx / fd) * push;
    m.y += (fdy / fd) * push;
  }
  // E: enter the nearest drivable car.
  if (input.e) {
    const near = nearestDrivable(state, m.x, m.y, 60);
    if (near) {
      state.car = near;
      m.onFoot = false;
      state.dialog = { speaker: 'Mara', text: `In the ${PROFILES[near.profile].name}. Let's drive.`, until: state.time + 3 };
    }
  }
}

function stepMissions(state, dt) {
  const m = currentMission(state);
  if (!m || !state.mission) return;
  const pos = playerPos(state);
  const ms = state.mission;
  // The timer must NOT run before the player moves.
  if (!state.firstMove) {
    if (state.car && Math.abs(state.car.speed) > 1) state.firstMove = true;
  } else {
    ms.elapsed += dt;
  }
  const target = ms.phase === 'pickup' ? m.pickup : m.dropoff;
  const d = Math.sqrt(dist2(pos.x, pos.y, target.x, target.y));
  if (d < 70) {
    if (ms.phase === 'pickup') {
      if (m.afterClose && state.clockMin < m.closeMin) {
        if (!state.waitingClose || state.time - state.waitingClose > 4) {
          state.waitingClose = state.time;
          const mins = m.closeMin - state.clockMin;
          state.dialog = {
            speaker: 'Neri',
            text: `The shutters are still up — come back after 18:00 (${mins} min to go).`,
            until: state.time + 3.5,
          };
        }
        return;
      }
      ms.phase = 'deliver';
      state.dialog = { speaker: m.speaker, text: m.pickupLine, until: state.time + 5 };
      state.events.push({ type: 'pickup', t: state.time, mission: m.id });
    } else {
      state.cash += m.reward;
      state.missionsDone++;
      state.events.push({ type: 'delivered', t: state.time, mission: m.id, cash: state.cash });
      if (m.id === 4) {
        state.broadcast = {
          text: 'SOLMAR FM — BREAKING: The Glass Debt is settled. Mara Venn walks free tonight.',
          until: state.time + 8,
        };
        state.dialog = { speaker: 'Mara', text: m.doneLine, until: state.time + 6 };
        state.mission = null;
        state.events.push({ type: 'all-missions-done', t: state.time, cash: state.cash });
      } else {
        state.dialog = { speaker: m.speaker, text: m.doneLine, until: state.time + 5 };
        startMission(state, state.missionIndex + 1);
      }
    }
  }
}

export function stepGame(state, input, dt) {
  state.time += dt;
  state.clockMin += dt * 2; // 1 game hour per 30 s
  state.radioT += dt;
  if (state.radioT > 25) {
    state.radioT = 0;
    state.radioTrack = (state.radioTrack + 1) % RADIO_TRACKS.length;
  }
  if (state.dialog && state.time > state.dialog.until) state.dialog = null;
  if (state.broadcast && state.time > state.broadcast.until) state.broadcast = null;
  state.shake = Math.max(0, state.shake - dt * 2);
  for (const d of state.dust) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.life -= dt;
  }
  state.dust = state.dust.filter((d) => d.life > 0);

  stepTraffic(state, dt);
  stepPeds(state, dt);
  if (state.mode === 'play') {
    const wasInCar = !!state.car;
    if (state.car) stepPlayerCar(state, input, dt);
    else stepMara(state, input, dt);
    // E: exit the car (only when nearly stopped, and only if the player
    // was already in the car when the step began — entering and exiting
    // on the same press would cancel the entry).
    if (input.e && wasInCar && state.car && Math.abs(state.car.speed) < 2) {
      const car = state.car;
      state.mara.x = car.x + Math.cos(car.angle + Math.PI / 2) * 30;
      state.mara.y = car.y + Math.sin(car.angle + Math.PI / 2) * 30;
      state.mara.onFoot = true;
      state.car = null;
    }
    stepPatrol(state, dt);
    stepMissions(state, dt);
  } else {
    stepPatrol(state, dt);
  }
}

// ---------------------------------------------------------------- autopilot

// Walk `dist` units along the route polyline from the point on it
// closest to the car. Returns the point plus the direction of the
// segment it sits on. `dist` 0 returns the closest point itself.
function pathPointAt(state, dist) {
  const pts = state.route;
  if (!pts || pts.length === 0) return null;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, dirX: 0, dirY: 0 };
  let bestSeg = 0;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;
    let t = ((state.car.x - a.x) * abx + (state.car.y - a.y) * aby) / len2;
    t = clamp(t, 0, 1);
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const d = dist2(state.car.x, state.car.y, px, py);
    if (d < bestD) {
      bestD = d;
      bestSeg = i;
      bestT = t;
    }
  }
  // Shoved far off the path (by a collision): head for the closest
  // point on it instead of the lookahead point.
  if (bestD > 80 * 80 && dist > 0) {
    const a = pts[bestSeg];
    const b = pts[bestSeg + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return {
      x: a.x + (b.x - a.x) * bestT,
      y: a.y + (b.y - a.y) * bestT,
      dirX: (b.x - a.x) / len,
      dirY: (b.y - a.y) / len,
    };
  }
  let remaining = dist;
  let seg = bestSeg;
  let t = bestT;
  while (seg < pts.length - 1) {
    const a = pts[seg];
    const b = pts[seg + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const fromHere = (1 - t) * segLen;
    if (fromHere >= remaining) {
      const tt = t + remaining / segLen;
      const len = segLen || 1;
      return {
        x: a.x + (b.x - a.x) * tt,
        y: a.y + (b.y - a.y) * tt,
        dirX: (b.x - a.x) / len,
        dirY: (b.y - a.y) / len,
      };
    }
    remaining -= fromHere;
    seg++;
    t = 0;
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  return { x: last.x, y: last.y, dirX: (last.x - prev.x) / len, dirY: (last.y - prev.y) / len };
}

// Follow the route polyline instead of chasing a single waypoint: aim
// 50 units ahead along the path from the closest point on it. Point
// pursuit never corrects a lateral offset — a car 27 units off the
// centre line stays off it and runs into the parked row — while path
// following pulls it back onto the road centre. The aim point is
// offset 10 units to the RIGHT of the direction of travel (right-hand
// traffic): the player then drives in the traffic lane for its
// direction — 1930 northbound, 1910 southbound on the boulevard —
// instead of on the centre line, which is only 8 units from either
// traffic lane and too close for the 10-unit car hitbox.
function pathTarget(state) {
  const pts = state.route;
  if (!pts || pts.length === 0) return null;
  const p = pathPointAt(state, 50);
  if (!p) return null;
  // Only the 64-wide boulevard has room for a lane offset — on the
  // 32-wide side streets the parked rows sit 12 units off the centre
  // line, so the player drives on the centre there.
  const onBoulevard = Math.abs(p.dirX) < 0.1 && Math.abs(p.x - 1920) < 40;
  const off = onBoulevard ? 10 : 0;
  // Right of the direction of travel (y grows downward: right = (-dy, dx)).
  return { x: p.x + (-p.dirY) * off, y: p.y + p.dirX * off };
}

// Drives the player car along the road graph to a target (used by the
// headless mission test and by the in-game ?autodrive=1 screenshot mode).
export function autopilotInput(state, target, opts = {}) {
  const car = state.car;
  if (!car || !target) return { up: false, down: false, steer: 0, handbrake: false };
  const key = `${target.x},${target.y}`;
  if (state.routeKey !== key) {
    state.route = findRoute(state.graph, { x: car.x, y: car.y }, target);
    state.routeKey = key;
    state.routeIdx = 0;
  }
  const pos = { x: car.x, y: car.y };
  // Keep routeIdx advancing for diagnostics; steering follows the path.
  let wp = state.route[state.routeIdx];
  while (wp && dist2(pos.x, pos.y, wp.x, wp.y) < 30 * 30) {
    state.routeIdx++;
    wp = state.route[state.routeIdx];
  }
  wp = pathTarget(state);
  if (!wp) return { up: false, down: Math.abs(car.speed) > 3, steer: 0, handbrake: false };
  const desired = Math.atan2(wp.y - pos.y, wp.x - pos.x);
  const dAng = angleDiff(desired, car.angle);
  const finalDist = Math.sqrt(dist2(pos.x, pos.y, target.x, target.y));
  // U-turn: the target is behind the car, so reverse into the turn
  // (steering inverts while reversing) instead of pushing forward
  // into whatever is ahead. Two phases: while still moving forward,
  // brake with normal steering; once slow or already reversing,
  // reverse with inverted steering. (A single branch that only
  // reversed below 10 u/s oscillated against the brake branch and
  // never completed the turn.)
  if (Math.abs(dAng) > 2.2) {
    if (car.speed > 3) {
      return { up: false, down: true, steer: clamp(dAng * 1.8, -1, 1), handbrake: false };
    }
    return { up: false, down: true, steer: -clamp(dAng * 1.8, -1, 1), handbrake: false };
  }
  // Slow down for a sharp turn ahead: the path 120 units on may head
  // in a very different direction than the road the car is on, and at
  // speed the turning radius (44+ units) does not fit a 32-wide
  // street — the car would swing into the buildings past the corner.
  // Forward motion only — it must not fight a reversing U-turn.
  const ahead = pathPointAt(state, 120);
  const now = pathPointAt(state, 0);
  if (ahead && now) {
    const turnAhead = Math.abs(
      angleDiff(Math.atan2(ahead.dirY, ahead.dirX), Math.atan2(now.dirY, now.dirX)),
    );
    if (turnAhead > 0.6 && car.speed > 12) {
      return { up: false, down: true, steer: clamp(dAng * 1.8, -1, 1), handbrake: false };
    }
  }
  // Too fast and too far off-heading: brake first, then turn. Coasting
  // through a 180-degree turn at speed swings the car off the road
  // (it did donuts in the blocks west of the boulevard). Forward only.
  if (Math.abs(dAng) > 1.5 && car.speed > 10) {
    return { up: false, down: true, steer: clamp(dAng * 1.8, -1, 1), handbrake: false };
  }
  // Creep forward when slow even if the nose is off-target: a stopped
  // car cannot turn (the bicycle model steers with speed), so refusing
  // throttle while misaligned deadlocks it. At speed, only throttle
  // when roughly aligned.
  let up = (Math.abs(dAng) < 1.5 || Math.abs(car.speed) < 6) && car.speed < 45;
  let down = false;
  if (finalDist < 70) {
    up = false;
    down = Math.abs(car.speed) > 4;
  }
  // Lawful driving: stop at a red or yellow light ahead on the boulevard.
  if (opts.lawful && Math.abs(car.x - 1920) < 50) {
    const dir = Math.sin(car.angle) < -0.5 ? -1 : Math.sin(car.angle) > 0.5 ? 1 : 0;
    if (dir !== 0) {
      for (const L of state.city.lights) {
        const stopY = L.y - dir * 34;
        const distToStop = dir * (stopY - car.y);
        if (distToStop > 0 && distToStop < 130) {
          const ls = lightState(state.time * 1000, L.index);
          if (ls !== 'green') {
            up = false;
            // Brake only while moving — holding reverse at a standstill
            // backs the car away from the line.
            down = car.speed > 2;
          }
        }
      }
    }
  }
  // Do not rear-end the car ahead — same direction only; oncoming cars
  // in the other lane are not in the way.
  for (const t of state.traffic) {
    if (t.parked) continue;
    if (Math.cos(t.angle - car.angle) < 0.5) continue;
    const dx = t.x - car.x;
    const dy = t.y - car.y;
    const ahead = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    const side = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
    if (ahead > 0 && ahead < 50 && side < 10) {
      up = false;
      if (ahead < 35 && car.speed > 2) down = true;
    }
  }
  return { up, down, steer: clamp(dAng * 1.8, -1, 1), handbrake: false };
}
