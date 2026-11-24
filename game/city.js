// city.js — Solmar, the city of "Palkon Auto" 2D.
// Pure data + a seeded generator. No browser APIs, so the layout verifier
// (checks/verify-layout.mjs) can import this file in plain Node and check
// the same city the game draws. Seed 20261123: the same seed always builds
// the same city, so screenshots and tests are deterministic.

export const WORLD_W = 3840;
export const WORLD_H = 3456;
export const SEED = 20261123;

/** Deterministic PRNG: mulberry32. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small deterministic hash of two integers -> [0, 1). Used for per-window lit state. */
export function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- districts

export const DISTRICTS = [
  {
    id: 'canal',
    name: 'Canal Ward',
    tagline: 'Water finds its own way.',
    standing: 71,
    x0: 0, y0: 0, x1: 960, y1: 1152,
    roofs: ['#7a6a8a', '#6b5d7d', '#8a7a9a', '#5f5470', '#746484'],
    walls: ['#d8d2c4', '#cfc8b8', '#ddd6c8'],
  },
  {
    id: 'glasspoint',
    name: 'Glasspoint',
    tagline: 'Glass towers, glass ceilings.',
    standing: 81,
    x0: 1952, y0: 0, x1: 3840, y1: 1152,
    roofs: ['#7fb3c8', '#6aa5bd', '#8fc3d4', '#5d94ab', '#74aec2'],
    walls: ['#c8d8dc', '#b8ccd2', '#d2dee2'],
  },
  {
    id: 'oldsolmar',
    name: 'Old Solmar',
    tagline: 'Streets older than the law.',
    standing: 62,
    x0: 0, y0: 1152, x1: 1888, y1: 2304,
    roofs: ['#b5654a', '#a85b40', '#c07a52', '#96503a', '#ad6a48'],
    walls: ['#e8d5b0', '#dfc49a', '#d9b98c'],
  },
  {
    id: 'citrus',
    name: 'Citrus Quarter',
    tagline: 'Sweet air, sour deals.',
    standing: 66,
    x0: 1952, y0: 1152, x1: 3840, y1: 2304,
    roofs: ['#e07840', '#d96a35', '#e88a50', '#c95f2e', '#dd7a44'],
    walls: ['#f2e3c2', '#eed9ae', '#f6e8c8'],
  },
  {
    id: 'market',
    name: 'South Market',
    tagline: 'Everything has a price. Most of it fair.',
    standing: 58,
    x0: 0, y0: 2304, x1: 1888, y1: 3456,
    roofs: ['#c98a3d', '#b57a2e', '#d99a4a', '#a86f28', '#c18438'],
    walls: ['#efe0c0', '#e6d3a8', '#f2e5c6'],
  },
  {
    id: 'marina',
    name: 'Pearl Marina',
    tagline: 'The harbour never sleeps.',
    standing: 74,
    x0: 1952, y0: 2304, x1: 3000, y1: 3456,
    roofs: ['#4a7a8a', '#3d6b7d', '#5a8a9a', '#35606f', '#457585'],
    walls: ['#e0e8e4', '#d2ddd8', '#e6ece8'],
  },
  {
    id: 'beach',
    name: 'Sunstrand Beach',
    tagline: 'Sand in your shoes, sun on your back.',
    standing: 69,
    x0: 3000, y0: 2304, x1: 3840, y1: 3456,
    roofs: ['#e8b45a', '#dfa848', '#f0c06a', '#d69a3a', '#e5ad52'],
    walls: ['#f5ead0', '#efe0bc', '#f8efda'],
  },
];

export function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  }
  // The boulevard strip itself belongs to no district: fall back to the
  // district on the same side of the boulevard at this height.
  if (x >= 1888 && x < 1952) {
    if (y < 1152) return DISTRICTS[1];
    if (y < 2304) return DISTRICTS[3];
    return DISTRICTS[5];
  }
  return DISTRICTS[2];
}

// ---------------------------------------------------------------- roads

// Road widths by kind (world units) and the sidewalk width each side gets.
export const ROAD_KINDS = {
  boulevard: { w: 64, sw: 12 },
  main: { w: 48, sw: 10 },
  secondary: { w: 32, sw: 8 },
  local: { w: 20, sw: 6 },
};

function vRoad(cx, kind, y0, y1) {
  const k = ROAD_KINDS[kind];
  return { x: cx - k.w / 2, y: y0, w: k.w, h: y1 - y0, kind, vertical: true };
}
function hRoad(cy, kind, x0, x1) {
  const k = ROAD_KINDS[kind];
  return { x: x0, y: cy - k.w / 2, w: x1 - x0, h: k.w, kind, vertical: false };
}

export function buildRoads() {
  const roads = [];
  // Vertical streets.
  roads.push(vRoad(480, 'local', 0, WORLD_H));
  roads.push(vRoad(960, 'secondary', 0, WORLD_H));
  roads.push(vRoad(1440, 'local', 0, 1152));
  // Old Solmar jog: the 1440 street steps sideways through the old quarter.
  roads.push(vRoad(1400, 'local', 1152, 1690));
  roads.push({ x: 1400, y: 1680, w: 80, h: 24, kind: 'local', vertical: false });
  roads.push(vRoad(1480, 'local', 1690, 2304));
  roads.push(vRoad(1440, 'local', 2304, WORLD_H));
  roads.push(vRoad(1920, 'boulevard', 0, WORLD_H));
  roads.push(vRoad(2400, 'secondary', 0, WORLD_H));
  roads.push(vRoad(2880, 'local', 0, WORLD_H));
  roads.push(vRoad(3360, 'secondary', 0, WORLD_H));
  // Horizontal streets.
  roads.push(hRoad(432, 'local', 0, 700)); // ends at the canal promenade
  roads.push(hRoad(432, 'local', 820, WORLD_W));
  roads.push(hRoad(864, 'secondary', 0, WORLD_W)); // bridge 1 over the canal
  // Old Solmar jog: the 1296 street steps down through the old quarter.
  roads.push(hRoad(1296, 'local', 0, 700));
  roads.push(hRoad(1260, 'local', 820, 1100));
  roads.push({ x: 1090, y: 1260, w: 20, h: 80, kind: 'local', vertical: true });
  roads.push(hRoad(1340, 'local', 1100, 1888));
  roads.push(hRoad(1296, 'local', 1888, WORLD_W));
  roads.push(hRoad(1728, 'main', 0, WORLD_W)); // bridge 2 over the canal
  roads.push(hRoad(2160, 'local', 0, WORLD_W)); // bridge 3 over the canal
  roads.push(hRoad(2592, 'secondary', 0, WORLD_W));
  roads.push(hRoad(3024, 'local', 0, WORLD_W));
  return roads;
}

// ---------------------------------------------------------------- water / park / plaza

export const CANAL = { x: 700, y: 0, w: 120, h: 2304 };
export const HARBOUR = { x: 2500, y: 2950, w: 1340, h: 506 };
export const BEACH = [
  { x: 2500, y: 2890, w: 1340, h: 60 },
  { x: 3760, y: 2592, w: 80, h: 298 },
];
export const PARK = { x: 2050, y: 1850, w: 330, h: 280 };
export const POND = { cx: 2215, cy: 1990, rx: 70, ry: 45 };
export const PLAZA = { cx: 1920, cy: 1728, r: 150 };
export const FOUNTAIN = { cx: 1920, cy: 1728, r: 38 };

// ---------------------------------------------------------------- helpers

function rectsOverlap(a, b, pad = 0) {
  return (
    a.x - pad < b.x + b.w + pad &&
    a.x + a.w + pad > b.x - pad &&
    a.y - pad < b.y + b.h + pad &&
    a.y + a.h + pad > b.y - pad
  );
}

function pointInRect(px, py, r) {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
}

function circleHitsRect(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// ---------------------------------------------------------------- the build

export function buildCity(seed = SEED) {
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const roads = buildRoads();

  // Sidewalks: a pavement strip with a curb edge along BOTH sides of every
  // road, plus the canal promenade strips.
  const sidewalks = [];
  for (const road of roads) {
    const sw = ROAD_KINDS[road.kind].sw;
    if (road.vertical) {
      sidewalks.push({ x: road.x - sw, y: road.y, w: sw, h: road.h, vertical: true, road: road.kind });
      sidewalks.push({ x: road.x + road.w, y: road.y, w: sw, h: road.h, vertical: true, road: road.kind });
    } else {
      sidewalks.push({ x: road.x, y: road.y - sw, w: road.w, h: sw, vertical: false, road: road.kind });
      sidewalks.push({ x: road.x, y: road.y + road.h, w: road.w, h: sw, vertical: false, road: road.kind });
    }
  }
  // Canal promenade: paved walk on both banks, with lamps and trees.
  sidewalks.push({ x: 688, y: 0, w: 12, h: 2304, vertical: true, road: 'promenade' });
  sidewalks.push({ x: 820, y: 0, w: 12, h: 2304, vertical: true, road: 'promenade' });

  // Buildings: fill the BLOCKS between the streets. Block columns/rows are
  // the gaps between the road bands (road + sidewalk on both sides); the
  // jogged Old Solmar streets use their widest extent, so the bands are
  // conservative. Each block gets a 3x3 grid of buildings. Candidates are
  // still rejected on water, sand, the plaza circle and the park, and on
  // the jog road rects themselves (they cut across two blocks).
  const V_BANDS = [[458, 502], [936, 984], [1384, 1496], [1870, 1970], [2376, 2424], [2858, 2902], [3336, 3384]];
  const H_BANDS = [[410, 454], [840, 888], [1244, 1356], [1688, 1768], [2138, 2182], [2568, 2616], [3002, 3046]];
  const gaps = (bands, max) => {
    const out = [];
    let cur = 8;
    for (const [a, b] of bands) {
      if (a > cur) out.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (cur < max - 8) out.push([cur, max - 8]);
    return out;
  };
  const cols = gaps(V_BANDS, WORLD_W);
  const rows = gaps(H_BANDS, WORLD_H);
  const noBuild = [
    ...roads.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, pad: ROAD_KINDS[r.kind].sw })),
    { x: CANAL.x, y: CANAL.y, w: CANAL.w, h: CANAL.h, pad: 16 },
    { x: HARBOUR.x, y: HARBOUR.y, w: HARBOUR.w, h: HARBOUR.h, pad: 4 },
    ...BEACH.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, pad: 4 })),
    { x: PARK.x, y: PARK.y, w: PARK.w, h: PARK.h, pad: 4 },
  ];
  const buildings = [];
  let nextId = 1;
  for (const [x0, x1] of cols) {
    for (const [y0, y1] of rows) {
      const cellW = (x1 - x0) / 3;
      const cellH = (y1 - y0) / 3;
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 3; i++) {
          if (rng() < 0.06) continue; // occasional empty lot / yard
          const cx = x0 + cellW * (i + 0.5) + (rng() - 0.5) * 20;
          const cy = y0 + cellH * (j + 0.5) + (rng() - 0.5) * 18;
          const d = districtAt(cx, cy);
          const tall = d.id === 'glasspoint';
          const w = tall ? cellW * (0.6 + rng() * 0.25) : cellW * (0.55 + rng() * 0.25);
          const h = tall ? cellH * (0.65 + rng() * 0.3) : cellH * (0.5 + rng() * 0.28);
          const b = { x: cx - w / 2, y: cy - h / 2, w, h };
          if (circleHitsRect(PLAZA.cx, PLAZA.cy, PLAZA.r + 22, b)) continue;
          let blocked = false;
          for (const nb of noBuild) {
            if (rectsOverlap(b, nb, nb.pad ?? 0)) { blocked = true; break; }
          }
          if (blocked) continue;
          for (const other of buildings) {
            if (rectsOverlap(b, other, 8)) { blocked = true; break; }
          }
          if (blocked) continue;
          const nearBoulevard =
            Math.abs(b.x + b.w - 1888) < 40 || Math.abs(b.x - 1952) < 40;
          const height = tall ? 25 + rng() * 35 : nearBoulevard ? 15 + rng() * 30 : 8 + rng() * 22;
          const props = [];
          if (height >= 15 && rng() < 0.45) {
            const n = 1 + Math.floor(rng() * 3);
            for (let k = 0; k < n; k++) {
              props.push({
                type: pick(['ac', 'tank', 'antenna']),
                dx: 8 + rng() * Math.max(8, b.w - 28),
                dy: 8 + rng() * Math.max(8, b.h - 28),
                s: 6 + rng() * 8,
              });
            }
          }
          buildings.push({
            id: nextId++,
            x: Math.round(b.x), y: Math.round(b.y),
            w: Math.round(b.w), h: Math.round(b.h),
            district: d.id,
            roof: pick(d.roofs),
            wall: pick(d.walls),
            height: Math.round(height),
            shop: nearBoulevard,
            awning: pick(['#d77f69', '#398e99', '#e8b45a', '#7a6a8a', '#c0392b']),
            sign: pick(['TACOS', 'BAR', 'HOTEL', 'CAFE', '24H', 'GYM', 'CLUB', 'SHOP']),
            props,
            landmark: false,
            signText: '',
          });
        }
      }
    }
  }

  // Landmark buildings with neon signage: the nearest building to each anchor.
  const landmarks = [
    { x: 1920, y: 700, text: 'SOLMAR GRAND' },
    { x: 1830, y: 1560, text: "NERI'S" },
    { x: 2010, y: 2400, text: "OREN'S GARAGE" },
    { x: 2900, y: 500, text: 'GLASSPOINT' },
  ];
  for (const lm of landmarks) {
    let best = null;
    let bestD = 1e12;
    for (const b of buildings) {
      const dx = b.x + b.w / 2 - lm.x;
      const dy = b.y + b.h / 2 - lm.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestD) { bestD = dist; best = b; }
    }
    if (best && bestD < 260 * 260) {
      best.landmark = true;
      best.signText = lm.text;
    }
  }

  // Cars. Parked cars hug the curbs; moving traffic runs the boulevard
  // lanes; the player car sits on the northbound lane by the plaza.
  const CAR_COLORS = ['#c0392b', '#2980b9', '#ecf0f1', '#2c3e50', '#f39c12', '#7f8c8d', '#16a085'];
  const parked = [];
  const horizCentres = [432, 864, 1296, 1728, 2160, 2592, 3024];
  const nearRoad = (y) => horizCentres.some((c) => Math.abs(y - c) < 48);
  const addParkedRun = (x, y0, y1, step, angle) => {
    for (let y = y0; y <= y1; y += step) {
      if (nearRoad(y)) continue;
      if (Math.abs(y - 1728) < 200) continue; // keep the plaza approach clear
      parked.push({ x, y, angle, color: rng() < 0.22 ? '#f1c40f' : pick(CAR_COLORS), parked: true });
    }
  };
  addParkedRun(1898, 240, 3300, 132, Math.PI / 2); // west curb, faces south
  addParkedRun(1942, 240, 3300, 132, -Math.PI / 2); // east curb, faces north
  addParkedRun(948, 300, 3200, 168, Math.PI / 2);
  addParkedRun(972, 300, 3200, 168, -Math.PI / 2);
  addParkedRun(2388, 300, 3200, 168, Math.PI / 2);
  addParkedRun(2412, 300, 3200, 168, -Math.PI / 2);

  const traffic = [];
  // Stagger each lane's cars evenly down the boulevard so they never
  // bunch up and overlap; speeds still vary, so the gaps breathe.
  const laneCount = { north: 0, south: 0 };
  for (let i = 0; i < 40; i++) {
    const northbound = i % 2 === 0;
    const lane = northbound ? 'north' : 'south';
    const slot = laneCount[lane]++;
    traffic.push({
      x: northbound ? 1928 : 1912,
      y0: slot * (WORLD_H / 20) + (rng() - 0.5) * 60,
      speed: 60 + rng() * 80, // world units per second
      northbound,
      color: rng() < 0.25 ? '#f1c40f' : pick(CAR_COLORS),
      parked: false,
    });
  }

  const player = { x: 1928, y: 1900, angle: -Math.PI / 2, color: '#d77f69' };

  // Pedestrians walk ON sidewalks: each one is anchored to a sidewalk rect
  // and only ever moves along it, never sideways off it.
  const JACKETS = ['#f1c40f', '#e74c3c', '#1abc9c', '#e67e22', '#e84393', '#3498db', '#f5f5f5'];
  const pedestrians = [];
  for (let i = 0; i < 110; i++) {
    const sw = pick(sidewalks);
    let x, y, axis;
    if (sw.vertical) {
      axis = 'v';
      x = sw.x + sw.w / 2 + (rng() - 0.5) * (sw.w - 4);
      y = sw.y + rng() * sw.h;
    } else {
      axis = 'h';
      x = sw.x + rng() * sw.w;
      y = sw.y + sw.h / 2 + (rng() - 0.5) * (sw.h - 4);
    }
    pedestrians.push({ x, y, axis, jacket: pick(JACKETS), phase: rng() * Math.PI * 2, sw });
  }

  // Traffic lights at the boulevard's big intersections.
  const lights = [864, 1296, 1728, 2160, 2592].map((y, i) => ({
    x: 1920, y, index: i,
  }));

  // Street lamps: both boulevard curbs, the canal promenade, the plaza ring.
  const lamps = [];
  for (let y = 100; y <= 3350; y += 170) {
    lamps.push({ x: 1876, y });
    lamps.push({ x: 1964, y });
  }
  for (let y = 120; y <= 2250; y += 200) {
    lamps.push({ x: 692, y });
    lamps.push({ x: 828, y });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    lamps.push({ x: PLAZA.cx + Math.cos(a) * 165, y: PLAZA.cy + Math.sin(a) * 165 });
  }

  // Trees: the park, the promenade, beach palms, the plaza.
  const trees = [];
  for (let i = 0; i < 36; i++) {
    const x = PARK.x + 14 + rng() * (PARK.w - 28);
    const y = PARK.y + 14 + rng() * (PARK.h - 28);
    const dx = (x - POND.cx) / POND.rx;
    const dy = (y - POND.cy) / POND.ry;
    if (dx * dx + dy * dy < 1.3) continue; // keep out of the pond
    trees.push({ x, y, r: 10 + rng() * 8, type: 'round' });
  }
  for (let y = 200; y <= 2200; y += 150) {
    trees.push({ x: rng() < 0.5 ? 694 : 826, y, r: 9 + rng() * 5, type: 'round' });
  }
  for (let i = 0; i < 12; i++) {
    trees.push({ x: 2560 + rng() * 1200, y: 2902 + rng() * 36, r: 8 + rng() * 4, type: 'palm' });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    trees.push({ x: PLAZA.cx + Math.cos(a) * 118, y: PLAZA.cy + Math.sin(a) * 118, r: 9 + rng() * 4, type: 'round' });
  }

  // Boats on the canal and in the harbour.
  const boats = [
    { x: 760, y: 300, angle: Math.PI / 2 },
    { x: 760, y: 1000, angle: Math.PI / 2 },
    { x: 760, y: 1800, angle: -Math.PI / 2 },
  ];
  for (let i = 0; i < 5; i++) {
    boats.push({ x: 2620 + rng() * 1100, y: 3020 + rng() * 380, angle: rng() * Math.PI * 2 });
  }

  // Marina piers jutting into the harbour.
  const piers = [2700, 3000, 3300].map((x) => ({ x: x - 12, y: 2950, w: 24, h: 120 }));

  return {
    seed,
    roads, sidewalks, buildings, parked, traffic, player, pedestrians,
    lights, lamps, trees, boats, piers,
    canal: CANAL, harbour: HARBOUR, beach: BEACH, park: PARK, pond: POND,
    plaza: PLAZA, fountain: FOUNTAIN,
    districts: DISTRICTS,
  };
}

/** Traffic-light state at time t (milliseconds) for light `index`.
 *  26 s cycle, offset per light: green 12 s, yellow 3 s, red 11 s.
 *  Shared by the renderer and the engine so both agree on every light. */
export function lightState(t, index) {
  const phase = (((t / 1000 + index * 3.1) % 26) + 26) % 26;
  if (phase < 12) return 'green';
  if (phase < 15) return 'yellow';
  return 'red';
}

/** Where a traffic car is at time t (milliseconds). Deterministic in t.
 *  Cars swing around the plaza fountain like a roundabout: near the
 *  fountain they slide sideways off their lane and back, smoothly. */
export function trafficPos(car, t) {
  const travelled = (car.speed * t) / 1000;
  const y = car.northbound
    ? (((car.y0 - travelled) % WORLD_H) + WORLD_H) % WORLD_H
    : (car.y0 + travelled) % WORLD_H;
  let x = car.x;
  const dy = y - 1728;
  if (Math.abs(dy) < 90) {
    const k = 1 - Math.abs(dy) / 90; // 1 at the fountain, 0 at the edge
    x = car.x + (car.northbound ? 1 : -1) * k * 55;
  }
  return { x, y };
}

/** Where a pedestrian is at time t: slides along their sidewalk, never off it. */
export function pedestrianPos(p, t) {
  const off = Math.sin(t / 900 + p.phase) * 10;
  if (p.axis === 'v') {
    const y = Math.max(p.sw.y + 2, Math.min(p.sw.y + p.sw.h - 2, p.y + off));
    return { x: p.x, y };
  }
  const x = Math.max(p.sw.x + 2, Math.min(p.sw.x + p.sw.w - 2, p.x + off));
  return { x, y: p.y };
}

export { pointInRect, rectsOverlap };
