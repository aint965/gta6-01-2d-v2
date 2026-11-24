// game.js — "Palkon Auto" 2D: hand-written Canvas 2D top-down renderer.
// Stage A: the city of Solmar, three lighting presets, minimap + HUD,
// camera pan + deterministic URL params. No library, no WebGL, no network.
// Driving, missions, police and the title screen arrive in Stage B.

import {
  WORLD_W, WORLD_H, SEED, buildCity, districtAt, trafficPos, pedestrianPos,
  hash2, ROAD_KINDS,
} from './city.js';

const params = new URLSearchParams(location.search);
const city = buildCity(SEED);

// ---------------------------------------------------------------- state

const PRESETS = {
  day: { name: 'MIDDAY', key: '1' },
  sunset: { name: 'SUNSET', key: '2' },
  night: { name: 'NIGHT', key: '3' },
};
let preset = ['day', 'sunset', 'night'].includes(params.get('preset'))
  ? params.get('preset')
  : { 1: 'day', 2: 'sunset', 3: 'night' }[params.get('preset')] || 'day';
let headlightsOn = params.get('headlights') !== 'off';
const fixedT = params.get('t') !== null ? Number(params.get('t')) : null;

const cam = {
  cx: params.get('cx') !== null ? Number(params.get('cx')) : city.player.x,
  cy: params.get('cy') !== null ? Number(params.get('cy')) : city.player.y,
  zoom: params.get('zoom') !== null ? Number(params.get('zoom')) : 1,
};
if (!Number.isFinite(cam.zoom) || cam.zoom <= 0) cam.zoom = 1;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Arrow keys / WASD pan the camera in this stage; 1/2/3 or T cycle light.
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.key === '1' || e.key === '2' || e.key === '3') {
    preset = { 1: 'day', 2: 'sunset', 3: 'night' }[e.key];
  } else if (e.key === 't' || e.key === 'T') {
    preset = preset === 'day' ? 'sunset' : preset === 'sunset' ? 'night' : 'day';
  } else if (e.key === 'h' || e.key === 'H') {
    headlightsOn = !headlightsOn;
  } else {
    keys.add(e.key.toLowerCase());
  }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function stepCamera(dt) {
  const speed = 900 * dt;
  if (keys.has('arrowleft') || keys.has('a')) cam.cx -= speed;
  if (keys.has('arrowright') || keys.has('d')) cam.cx += speed;
  if (keys.has('arrowup') || keys.has('w')) cam.cy -= speed;
  if (keys.has('arrowdown') || keys.has('s')) cam.cy += speed;
  cam.cx = Math.max(0, Math.min(WORLD_W, cam.cx));
  cam.cy = Math.max(0, Math.min(WORLD_H, cam.cy));
}

// ---------------------------------------------------------------- helpers

const DISTRICT_FILL = {
  canal: '#b9b3a4', glasspoint: '#c3d4d8', oldsolmar: '#d9c49a',
  citrus: '#e6c98f', market: '#dcc491', marina: '#b8c8c4', beach: '#e8d29a',
};

function visibleRect() {
  const w = canvas.width / cam.zoom;
  const h = canvas.height / cam.zoom;
  return { x: cam.cx - w / 2 - 60, y: cam.cy - h / 2 - 60, w: w + 120, h: h + 120 };
}

function inView(r, x, y, w, h) {
  return x + w >= r.x && x <= r.x + r.w && y + h >= r.y && y <= r.y + r.h;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

// Window grid along a building's street-facing edges. Deterministic per
// building id + window index, so day and night draws agree.
function windowRects(b) {
  const out = [];
  const step = 13;
  let i = 0;
  const push = (x, y, w, h) => {
    out.push({ x, y, w, h, lit: hash2(b.id, i++) < 0.42, big: hash2(b.id, i + 500) < 0.18 });
  };
  for (let x = b.x + 7; x + 7 <= b.x + b.w - 5; x += step) {
    push(x, b.y + 3, 6, 4); // north edge
    push(x, b.y + b.h - 7, 6, 4); // south edge
  }
  for (let y = b.y + 9; y + 7 <= b.y + b.h - 5; y += step) {
    push(b.x + 3, y, 4, 6); // west edge
    push(b.x + b.w - 7, y, 4, 6); // east edge
  }
  return out;
}

// ---------------------------------------------------------------- drawing

function drawGround(r) {
  ctx.fillStyle = '#cbb98d';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // District-tinted ground so each quarter reads from a block away.
  for (const d of city.districts) {
    if (!inView(r, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0)) continue;
    ctx.fillStyle = DISTRICT_FILL[d.id];
    ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
  }
  // Beach sand.
  ctx.fillStyle = '#ecd9a0';
  for (const b of city.beach) ctx.fillRect(b.x, b.y, b.w, b.h);
  // Park grass.
  ctx.fillStyle = '#7fae62';
  ctx.fillRect(city.park.x, city.park.y, city.park.w, city.park.h);
  // Water: canal, harbour, pond.
  ctx.fillStyle = '#3d8fa8';
  ctx.fillRect(city.canal.x, city.canal.y, city.canal.w, city.canal.h);
  ctx.fillRect(city.harbour.x, city.harbour.y, city.harbour.w, city.harbour.h);
  ctx.beginPath();
  ctx.ellipse(city.pond.cx, city.pond.cy, city.pond.rx, city.pond.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Marina piers.
  ctx.fillStyle = '#a08a68';
  for (const p of city.piers) ctx.fillRect(p.x, p.y, p.w, p.h);
  // Plaza paving (the roads cut across it; the fountain is drawn after the
  // roads so it sits on top of the intersection like a roundabout).
  ctx.fillStyle = '#dcc7a0';
  ctx.beginPath();
  ctx.arc(city.plaza.cx, city.plaza.cy, city.plaza.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b39a72';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(city.plaza.cx, city.plaza.cy, city.plaza.r - 2, 0, Math.PI * 2);
  ctx.stroke();
}

// The plaza fountain, drawn after the roads: the landmark of Solmar,
// a roundabout the traffic swings around.
function drawFountain() {
  ctx.fillStyle = '#4aa8c4';
  ctx.beginPath();
  ctx.arc(city.fountain.cx, city.fountain.cy, city.fountain.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8ddc0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(city.fountain.cx, city.fountain.cy, city.fountain.r - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e8ddc0';
  ctx.beginPath();
  ctx.arc(city.fountain.cx, city.fountain.cy, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a7a5c';
  ctx.beginPath();
  ctx.arc(city.fountain.cx, city.fountain.cy, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawRoads(r) {
  for (const road of city.roads) {
    if (!inView(r, road.x, road.y, road.w, road.h)) continue;
    ctx.fillStyle = '#3a3f45';
    ctx.fillRect(road.x, road.y, road.w, road.h);
    // Centre dashes.
    ctx.fillStyle = '#d8c96a';
    if (road.vertical) {
      for (let y = road.y + 8; y < road.y + road.h - 8; y += 36) {
        ctx.fillRect(road.x + road.w / 2 - 1.5, y, 3, 18);
      }
    } else {
      for (let x = road.x + 8; x < road.x + road.w - 8; x += 36) {
        ctx.fillRect(x, road.y + road.h / 2 - 1.5, 18, 3);
      }
    }
  }
  // Sidewalks: lighter pavement + a darker curb edge, both sides of every street.
  for (const sw of city.sidewalks) {
    if (!inView(r, sw.x, sw.y, sw.w, sw.h)) continue;
    ctx.fillStyle = sw.road === 'promenade' ? '#c9b48a' : '#b7a98c';
    ctx.fillRect(sw.x, sw.y, sw.w, sw.h);
    ctx.fillStyle = '#8a7c62';
    if (sw.vertical) {
      ctx.fillRect(sw.x, sw.y, 1.5, sw.h);
      ctx.fillRect(sw.x + sw.w - 1.5, sw.y, 1.5, sw.h);
    } else {
      ctx.fillRect(sw.x, sw.y, sw.w, 1.5);
      ctx.fillRect(sw.x, sw.y + sw.h - 1.5, sw.w, 1.5);
    }
  }
  // Sidewalk corner pads at the boulevard intersections.
  ctx.fillStyle = '#b7a98c';
  for (const y of [864, 1296, 1728, 2160, 2592]) {
    ctx.fillRect(1876, y - 44, 12, 12);
    ctx.fillRect(1952, y - 44, 12, 12);
    ctx.fillRect(1876, y + 32, 12, 12);
    ctx.fillRect(1952, y + 32, 12, 12);
  }
}

function drawShadows(r) {
  if (preset === 'day') {
    ctx.fillStyle = 'rgba(20,20,30,0.10)';
    for (const b of city.buildings) {
      if (!inView(r, b.x, b.y, b.w, b.h)) continue;
      ctx.fillRect(b.x + 6, b.y + 5, b.w, b.h);
    }
  } else if (preset === 'sunset') {
    // Long soft golden-hour shadows stretch east.
    ctx.fillStyle = 'rgba(60,25,5,0.15)';
    for (const b of city.buildings) {
      if (!inView(r, b.x, b.y, b.w, b.h)) continue;
      ctx.fillRect(b.x + 26, b.y + 12, b.w, b.h);
    }
  }
}

function drawBuildings(r, t) {
  for (const b of city.buildings) {
    if (!inView(r, b.x, b.y, b.w, b.h)) continue;
    const glass = b.district === 'glasspoint';
    // Roof: per-building colour inside the district palette, parapet edge.
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = shade(b.roof, 0.62);
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
    // Roof texture: a slightly darker inner panel + a lighter ridge line.
    ctx.fillStyle = shade(b.roof, 0.88);
    ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
    ctx.fillStyle = shade(b.roof, 1.12);
    ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, 3);
    // Glass towers: day glare stripe, night lit interior grid.
    if (glass) {
      if (preset === 'day') {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(b.x + b.w * 0.15, b.y + b.h);
        ctx.lineTo(b.x + b.w * 0.45, b.y);
        ctx.lineTo(b.x + b.w * 0.60, b.y);
        ctx.lineTo(b.x + b.w * 0.30, b.y + b.h);
        ctx.closePath();
        ctx.fill();
      } else if (preset === 'night') {
        ctx.fillStyle = 'rgba(255,214,120,0.20)';
        ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
      }
    }
    // Windows along the street-facing edges, with per-window variation.
    const wins = windowRects(b);
    for (const wn of wins) {
      if (preset === 'night') {
        ctx.fillStyle = wn.lit ? '#3a2f18' : '#1d2733';
      } else if (preset === 'sunset') {
        ctx.fillStyle = wn.lit ? '#e8a34c' : '#33414f';
      } else {
        ctx.fillStyle = wn.big ? '#5a7688' : '#2c3e4c';
      }
      ctx.fillRect(wn.x, wn.y, wn.w, wn.h);
    }
    // Ground-floor shopfronts along the boulevard: awning + sign.
    if (b.shop) {
      const edge = b.x + b.w < 1920 ? 'east' : 'west';
      ctx.fillStyle = b.awning;
      if (edge === 'east') {
        ctx.fillRect(b.x + b.w - 2, b.y + 4, 8, Math.min(26, b.h - 8));
      } else {
        ctx.fillRect(b.x - 6, b.y + 4, 8, Math.min(26, b.h - 8));
      }
      ctx.fillStyle = '#142d38';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.sign, b.x + b.w / 2, b.y + b.h - 6);
    }
    // Rooftop props on taller buildings: AC boxes, water tanks, antennae.
    for (const p of b.props) {
      const px = b.x + p.dx;
      const py = b.y + p.dy;
      if (p.type === 'ac') {
        ctx.fillStyle = '#9aa4a8';
        ctx.fillRect(px, py, p.s, p.s * 0.7);
      } else if (p.type === 'tank') {
        ctx.fillStyle = '#7d8a8f';
        ctx.beginPath();
        ctx.arc(px + p.s / 2, py + p.s / 2, p.s / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#5c666b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py + p.s);
        ctx.lineTo(px, py - p.s);
        ctx.stroke();
      }
    }
    // Landmark neon signage: glowing sign text + light pool in front.
    if (b.landmark) {
      const sx = b.x + b.w / 2;
      const sy = b.y - 10;
      if (preset !== 'day') {
        ctx.fillStyle = 'rgba(255,80,120,0.25)';
        ctx.beginPath();
        ctx.arc(sx, sy + 12, 42, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = preset === 'day' ? '#c2185b' : '#ff5c8a';
      ctx.fillText(b.signText, sx, sy);
    }
  }
}

function drawCar(x, y, angle, color, isPlayer, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Body: 34 long, 17 wide. Front is +x.
  ctx.fillStyle = '#00000033';
  ctx.fillRect(-15, -6, 32, 19);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-17, -8.5, 34, 17, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Roof + windshield.
  ctx.fillStyle = shade(color, 0.82);
  ctx.beginPath();
  ctx.roundRect(-6, -6.5, 12, 13, 3);
  ctx.fill();
  ctx.fillStyle = '#22384a';
  ctx.fillRect(6, -6.5, 4, 13);
  // Headlights on the FRONT, tail lights on the REAR.
  ctx.fillStyle = preset === 'night' ? '#fff6c8' : '#f5eeda';
  ctx.fillRect(15.5, -6.5, 2.5, 3.5);
  ctx.fillRect(15.5, 3, 2.5, 3.5);
  ctx.fillStyle = '#e33';
  ctx.fillRect(-18, -6.5, 2.5, 3.5);
  ctx.fillRect(-18, 3, 2.5, 3.5);
  if (isPlayer) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', 0, 3);
  }
  ctx.restore();
}

function drawCars(r, t) {
  for (const p of city.parked) {
    if (!inView(r, p.x - 20, p.y - 20, 40, 40)) continue;
    drawCar(p.x, p.y, p.angle, p.color, false, t);
  }
  for (const car of city.traffic) {
    const pos = trafficPos(car, t);
    if (!inView(r, pos.x - 20, pos.y - 20, 40, 40)) continue;
    drawCar(pos.x, pos.y, car.northbound ? -Math.PI / 2 : Math.PI / 2, car.color, false, t);
  }
  drawCar(city.player.x, city.player.y, city.player.angle, city.player.color, true, t);
}

function drawPedestrians(r, t) {
  for (const p of city.pedestrians) {
    const pos = pedestrianPos(p, t);
    if (!inView(r, pos.x - 8, pos.y - 8, 16, 16)) continue;
    ctx.fillStyle = '#00000030';
    ctx.beginPath();
    ctx.arc(pos.x + 1, pos.y + 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.jacket;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y - 1.5, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFurniture(r, t) {
  // Traffic lights at the boulevard intersections.
  for (const L of city.lights) {
    if (!inView(r, L.x - 60, L.y - 60, 120, 120)) continue;
    const cycle = ((t / 1000 + L.index * 2.4) % 12 + 12) % 12;
    const state = cycle < 5 ? 'green' : cycle < 6.5 ? 'yellow' : 'red';
    ctx.fillStyle = '#2c3136';
    ctx.fillRect(L.x + 40, L.y - 44, 8, 26);
    ctx.fillStyle = '#1c1f22';
    ctx.fillRect(L.x + 38, L.y - 46, 12, 10);
    ctx.fillStyle = state === 'red' ? '#ff3b30' : '#571512';
    ctx.beginPath();
    ctx.arc(L.x + 44, L.y - 41, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = state === 'yellow' ? '#ffcc00' : '#574d12';
    ctx.beginPath();
    ctx.arc(L.x + 44, L.y - 36, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = state === 'green' ? '#34c759' : '#12351c';
    ctx.beginPath();
    ctx.arc(L.x + 44, L.y - 31, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Street lamps: pole + head; the light pool is drawn after the night tint.
  for (const lamp of city.lamps) {
    if (!inView(r, lamp.x - 8, lamp.y - 8, 16, 16)) continue;
    ctx.fillStyle = '#3a3f45';
    ctx.fillRect(lamp.x - 1.5, lamp.y - 1.5, 3, 3);
    ctx.fillStyle = preset === 'night' ? '#ffe9a8' : '#d8d2c0';
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Trees.
  for (const tree of city.trees) {
    if (!inView(r, tree.x - 20, tree.y - 20, 40, 40)) continue;
    if (tree.type === 'palm') {
      ctx.strokeStyle = '#7a5c38';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tree.x, tree.y);
      ctx.lineTo(tree.x + 3, tree.y - 12);
      ctx.stroke();
      ctx.fillStyle = '#4e8a4a';
      ctx.beginPath();
      ctx.arc(tree.x + 3, tree.y - 14, tree.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = preset === 'sunset' ? '#5d7a3a' : '#4e8a4a';
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = preset === 'sunset' ? '#74904a' : '#67a35c';
      ctx.beginPath();
      ctx.arc(tree.x - 3, tree.y - 3, tree.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Boats.
  for (const boat of city.boats) {
    if (!inView(r, boat.x - 30, boat.y - 30, 60, 60)) continue;
    ctx.save();
    ctx.translate(boat.x, boat.y);
    ctx.rotate(boat.angle);
    ctx.fillStyle = '#f2ede0';
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#398e99';
    ctx.fillRect(-6, -3, 10, 6);
    ctx.restore();
  }
  // District + street labels, painted on the ground.
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(20,45,56,0.5)';
  ctx.font = 'bold 22px sans-serif';
  for (const d of city.districts) {
    const cx = (d.x0 + d.x1) / 2;
    const cy = (d.y0 + d.y1) / 2;
    if (!inView(r, cx - 200, cy - 40, 400, 80)) continue;
    ctx.fillText(d.name.toUpperCase(), cx, cy);
  }
  ctx.save();
  ctx.translate(1920, 900);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = 'rgba(20,45,56,0.45)';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('S O L M A R   B O U L E V A R D', 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------- lighting

function drawNightExtras(r) {
  if (preset !== 'night') return;
  // Lit windows shine through the dark tint.
  for (const b of city.buildings) {
    if (!inView(r, b.x, b.y, b.w, b.h)) continue;
    for (const wn of windowRects(b)) {
      if (!wn.lit) continue;
      ctx.fillStyle = 'rgba(255,204,110,0.95)';
      ctx.fillRect(wn.x, wn.y, wn.w, wn.h);
    }
  }
  // Street-light pools: smooth radial gradients, no rings.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const lamp of city.lamps) {
    if (!inView(r, lamp.x - 100, lamp.y - 100, 200, 200)) continue;
    const g = ctx.createRadialGradient(lamp.x, lamp.y, 4, lamp.x, lamp.y, 95);
    g.addColorStop(0, 'rgba(255,220,140,0.30)');
    g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 95, 0, Math.PI * 2);
    ctx.fill();
  }
  // The player car's headlight: two soft radial pools of light on the road
  // ahead — a smooth falloff, no rings, arcs, bands or hard edges.
  if (headlightsOn) {
    const p = city.player;
    const dx = Math.cos(p.angle);
    const dy = Math.sin(p.angle);
    const fx = p.x + dx * 18;
    const fy = p.y + dy * 18;
    const pools = [
      { x: fx + dx * 45, y: fy + dy * 45, r: 75, a: 0.55 },
      { x: fx + dx * 175, y: fy + dy * 175, r: 155, a: 0.38 },
    ];
    for (const pool of pools) {
      const g = ctx.createRadialGradient(pool.x, pool.y, 6, pool.x, pool.y, pool.r);
      g.addColorStop(0, `rgba(255,240,180,${pool.a})`);
      g.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, pool.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawSunsetExtras() {
  if (preset !== 'sunset') return;
  // A faint warm glow low in the west, like the sun going down over the canal.
  const g = ctx.createRadialGradient(0, canvas.height * 0.72, 10, 0, canvas.height * 0.72, 620);
  g.addColorStop(0, 'rgba(255,170,70,0.20)');
  g.addColorStop(1, 'rgba(255,170,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------- HUD + minimap

function drawHUD(t) {
  const d = districtAt(city.player.x, city.player.y);
  const W = canvas.width;
  const H = canvas.height;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Top-left: title + district with tagline and standing.
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(12, 12, 330, 92);
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('PALKON AUTO', 24, 42);
  ctx.fillStyle = '#d77f69';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(d.name.toUpperCase(), 24, 64);
  ctx.fillStyle = '#cfe0dc';
  ctx.font = '13px sans-serif';
  ctx.fillText(d.tagline, 24, 82);
  ctx.fillStyle = '#8fa8a0';
  ctx.font = '12px sans-serif';
  ctx.fillText(`Standing ${d.standing}/100`, 24, 98);
  ctx.fillStyle = '#2c3e46';
  ctx.fillRect(150, 88, 120, 7);
  ctx.fillStyle = '#e8b45a';
  ctx.fillRect(150, 88, (120 * d.standing) / 100, 7);

  // Top-centre: compass strip (north-up).
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(W / 2 - 130, 12, 260, 30);
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('W', W / 2 - 100, 33);
  ctx.fillText('N', W / 2, 33);
  ctx.fillText('E', W / 2 + 100, 33);
  ctx.textAlign = 'left';

  // Top-right: lighting preset.
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(W - 212, 12, 200, 30);
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`${PRESETS[preset].name}  ·  press 1/2/3`, W - 200, 33);

  // Bottom-left: big speedometer (Stage A: the car is parked, 0 km/h).
  const sx = 78;
  const sy = H - 78;
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.beginPath();
  ctx.arc(sx, sy, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8b45a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sx, sy, 56, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('0', sx, sy + 4);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#8fa8a0';
  ctx.fillText('km/h', sx, sy + 24);
  ctx.textAlign = 'left';

  // Bottom-centre: the control scheme, written on screen in every mode.
  const controls = 'ARROWS / WASD — move camera · 1/2/3 or T — lighting · H — headlights · Q — collect · E — enter · X — drop';
  ctx.font = '13px sans-serif';
  const cw = ctx.measureText(controls).width;
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(W / 2 - cw / 2 - 12, H - 34, cw + 24, 24);
  ctx.fillStyle = '#cfe0dc';
  ctx.fillText(controls, W / 2 - cw / 2, H - 17);

  drawMinimap();
}

function drawMinimap() {
  const W = canvas.width;
  const H = canvas.height;
  const mw = 230;
  const mh = 208;
  const mx = W - mw - 12;
  const my = H - mh - 12;
  const s = mw / WORLD_W;
  ctx.fillStyle = 'rgba(10,20,28,0.78)';
  ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
  ctx.save();
  ctx.beginPath();
  ctx.rect(mx, my, mw, mh);
  ctx.clip();
  ctx.fillStyle = '#20303a';
  ctx.fillRect(mx, my, mw, mh);
  // Water.
  ctx.fillStyle = '#3d8fa8';
  ctx.fillRect(mx + city.canal.x * s, my + city.canal.y * s, city.canal.w * s, city.canal.h * s);
  ctx.fillRect(mx + city.harbour.x * s, my + city.harbour.y * s, city.harbour.w * s, city.harbour.h * s);
  // Buildings coloured by district.
  for (const b of city.buildings) {
    const d = city.districts.find((dd) => dd.id === b.district);
    ctx.fillStyle = d ? d.roofs[0] : '#888888';
    ctx.fillRect(mx + b.x * s, my + b.y * s, Math.max(1.5, b.w * s), Math.max(1.5, b.h * s));
  }
  // Boulevard, main street, plaza.
  ctx.fillStyle = '#e8b45a';
  ctx.fillRect(mx + 1888 * s, my, 64 * s, mh);
  ctx.fillStyle = '#d8c96a';
  ctx.fillRect(mx, my + 1728 * s, mw, 48 * s);
  ctx.strokeStyle = '#f2e3c2';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mx + city.plaza.cx * s, my + city.plaza.cy * s, city.plaza.r * s, 0, Math.PI * 2);
  ctx.stroke();
  // Viewport rectangle + player arrow.
  const vw = (canvas.width / cam.zoom) * s;
  const vh = (canvas.height / cam.zoom) * s;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + (cam.cx - canvas.width / cam.zoom / 2) * s, my + (cam.cy - canvas.height / cam.zoom / 2) * s, vw, vh);
  const px = mx + city.player.x * s;
  const py = my + city.player.y * s;
  ctx.fillStyle = '#ff5c5c';
  ctx.beginPath();
  ctx.moveTo(px, py - 6);
  ctx.lineTo(px + 5, py + 5);
  ctx.lineTo(px - 5, py + 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('SOLMAR', mx, my - 8);
}

// ---------------------------------------------------------------- frame

let last = 0;
function frame(now) {
  const t = fixedT !== null ? fixedT : now;
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (fixedT === null) stepCamera(dt);
  render(t);
  requestAnimationFrame(frame);
}

function render(t) {
  const r = visibleRect();
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, canvas.width / 2 - cam.cx * cam.zoom, canvas.height / 2 - cam.cy * cam.zoom);
  drawGround(r);
  drawRoads(r);
  drawFountain();
  drawShadows(r);
  drawBuildings(r, t);
  drawCars(r, t);
  drawPedestrians(r, t);
  drawFurniture(r, t);
  // Lighting tint over the world (HUD stays clean).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (preset === 'day') {
    ctx.fillStyle = 'rgba(255,244,214,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (preset === 'sunset') {
    ctx.fillStyle = 'rgba(255,140,50,0.16)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawSunsetExtras();
  } else {
    ctx.fillStyle = 'rgba(8,16,44,0.52)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, canvas.width / 2 - cam.cx * cam.zoom, canvas.height / 2 - cam.cy * cam.zoom);
    drawNightExtras(r);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  drawHUD(t);
}

// First frame synchronously so a headless screenshot always has a picture.
render(fixedT !== null ? fixedT : 0);
requestAnimationFrame(frame);
