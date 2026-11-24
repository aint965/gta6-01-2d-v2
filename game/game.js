// game.js — "Palkon Auto" 2D: hand-written Canvas 2D top-down renderer.
// Stage B: driving, traffic, headlights, missions, police, radio, title.
// The city of Solmar comes from city.js; all game logic lives in
// engine.js (pure, no DOM) so the headless verifier runs the same code
// the player plays. No library, no WebGL, no network.

import {
  WORLD_W, WORLD_H, SEED, buildCity, districtAt, trafficPos, pedestrianPos,
  hash2, ROAD_KINDS, lightState,
} from './city.js';
import {
  PROFILES, kmhToUps, upsToKmh, clamp, angleDiff, MISSIONS, RADIO_TRACKS,
  SAFEHOUSE, createGame, currentMission, missionTarget, startMission,
  stepGame, autopilotInput, playerPos, findRoute,
} from './engine.js';

const params = new URLSearchParams(location.search);
const city = buildCity(SEED);
const state = createGame(city, {
  mode: params.get('mode') === 'play' ? 'play' : 'title',
  inCar: params.get('incar') === '1',
  t0: params.get('t') !== null ? Number(params.get('t')) : 1200,
  noTraffic: params.get('notraffic') === '1',
  beamCar: params.get('beamcar') === '1',
});
const autodrive = params.get('autodrive') === '1';
const still = params.get('still') === '1';
if (state.mode === 'play' && !state.mission) startMission(state, 0);

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

// Input: held keys + edge-triggered presses consumed once per frame.
const keys = new Set();
let ePressed = false;
let enterPressed = false;
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === '1' || k === '2' || k === '3') {
    preset = { 1: 'day', 2: 'sunset', 3: 'night' }[k];
  } else if (k === 't') {
    preset = preset === 'day' ? 'sunset' : preset === 'sunset' ? 'night' : 'day';
  } else if (k === 'h') {
    headlightsOn = !headlightsOn;
  } else if (k === 'e') {
    ePressed = true;
  } else if (k === 'enter') {
    enterPressed = true;
  } else if (k === 'arrowup' || k === 'arrowdown') {
    if (state.mode === 'title') {
      state.menuIndex = k === 'arrowup' ? 0 : 1;
    }
    keys.add(k);
  } else {
    keys.add(k);
  }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function buildInput() {
  const input = {
    up: keys.has('w') || keys.has('arrowup'),
    down: keys.has('s') || keys.has('arrowdown'),
    left: keys.has('a') || keys.has('arrowleft'),
    right: keys.has('d') || keys.has('arrowright'),
    handbrake: keys.has(' '),
    steer: (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0),
    e: ePressed,
    enter: enterPressed,
  };
  ePressed = false;
  enterPressed = false;
  return input;
}

function stepTitle(input) {
  if (!input.enter) return;
  if (state.showHelp) {
    state.showHelp = false;
    return;
  }
  if (state.menuIndex === 1) {
    state.showHelp = true;
    return;
  }
  state.mode = 'play';
  if (!state.mission) startMission(state, 0);
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

function fmtTime(sec) {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fmtClock(min) {
  const h = Math.floor(min / 60) % 24;
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

function drawCar(x, y, angle, color, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Body: 34 long, 17 wide. Front is +x.
  ctx.fillStyle = '#00000033';
  ctx.fillRect(-15, -6, 32, 19);
  ctx.fillStyle = opts.locked ? shade(color, 0.55) : color;
  ctx.beginPath();
  ctx.roundRect(-17, -8.5, 34, 17, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Roof + windshield.
  ctx.fillStyle = shade(color, opts.locked ? 0.5 : 0.82);
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
  if (opts.isPlayer) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', 0, 3);
  }
  if (opts.locked) {
    // A tiny padlock on the roof: this car stays locked.
    ctx.fillStyle = '#222';
    ctx.fillRect(-2, -1, 4, 4);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -1, 2.2, Math.PI, 0);
    ctx.stroke();
  }
  ctx.restore();
  if (opts.drivable) {
    // Green ring + key dot: drivable at a glance, parked cars stay locked.
    ctx.strokeStyle = 'rgba(80,220,120,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8b45a';
    ctx.beginPath();
    ctx.arc(x, y - 30, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (opts.patrol) {
    // Black-and-white patrol car with a flashing light bar.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#111';
    ctx.fillRect(-8, -8.5, 16, 17);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(-2, -8.5, 4, 17);
    const flash = Math.floor(state.time * 2) % 2 === 0;
    ctx.fillStyle = flash ? '#ff3b30' : '#2f7bff';
    ctx.fillRect(-4, -11, 4, 3);
    ctx.fillStyle = flash ? '#2f7bff' : '#ff3b30';
    ctx.fillRect(0, -11, 4, 3);
    ctx.restore();
  }
}

function drawMara(x, y, angle) {
  ctx.fillStyle = '#00000030';
  ctx.beginPath();
  ctx.arc(x + 1, y + 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d77f69';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8c39a';
  ctx.beginPath();
  ctx.arc(x, y - 1.5, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#142d38';
  ctx.beginPath();
  ctx.arc(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawCars(r, t) {
  // Parked cars stay locked — except the drivable ones, which are drawn
  // from state.drivable below with their green ring.
  for (const p of city.parked) {
    if (!inView(r, p.x - 30, p.y - 30, 60, 60)) continue;
    const isDrv = state.drivable.some((d) => Math.abs(d.x - p.x) < 4 && Math.abs(d.y - p.y) < 4);
    if (isDrv) continue;
    drawCar(p.x, p.y, p.angle, p.color, { locked: true });
  }
  // Drivable cars (Mara's sedan + one of each other profile).
  for (const d of state.drivable) {
    if (state.car === d) continue;
    if (!inView(r, d.x - 30, d.y - 30, 60, 60)) continue;
    drawCar(d.x, d.y, d.angle, d.color, { drivable: true });
  }
  // Oren's car (mission 2): a person waits inside — pink ring, never a
  // building marker.
  if (state.missionIndex === 1 && state.mission && state.mission.phase === 'pickup') {
    const o = state.orenCar;
    if (inView(r, o.x - 30, o.y - 30, 60, 60)) {
      drawCar(o.x, o.y, o.angle, o.color, {});
      ctx.strokeStyle = 'rgba(255,92,138,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ff5c8a';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('O', o.x, o.y - 30);
    }
  }
  // Traffic, swinging around the plaza fountain like a roundabout.
  for (const c of state.traffic) {
    let x = c.x;
    const dy = c.y - 1728;
    if (Math.abs(dy) < 90) {
      const k = 1 - Math.abs(dy) / 90;
      x = c.x + (c.northbound ? 1 : -1) * k * 55;
    }
    if (!inView(r, x - 20, c.y - 20, 40, 40)) continue;
    drawCar(x, c.y, c.angle, c.color, {});
  }
  // Patrol cars.
  for (const p of state.patrol) {
    if (!inView(r, p.x - 20, p.y - 20, 40, 40)) continue;
    drawCar(p.x, p.y, p.angle, '#111111', { patrol: true });
  }
  // The player car, or Mara on foot (her sedan is drawn by the drivable
  // loop above, with its green ring).
  if (state.car) {
    drawCar(state.car.x, state.car.y, state.car.angle, state.car.color, { isPlayer: true });
  } else {
    drawMara(state.mara.x, state.mara.y, state.mara.angle);
  }
}

function drawPedestrians(r, t) {
  for (const p of state.peds) {
    if (!inView(r, p.x - 8, p.y - 8, 16, 16)) continue;
    ctx.fillStyle = '#00000030';
    ctx.beginPath();
    ctx.arc(p.x + 1, p.y + 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 1.5, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const c of state.crossers) {
    if (!inView(r, c.x - 8, c.y - 8, 16, 16)) continue;
    ctx.fillStyle = '#00000030';
    ctx.beginPath();
    ctx.arc(c.x + 1, c.y + 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3498db';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(c.x, c.y - 1.5, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMissionMarkers(r, t) {
  // E-interaction radius on the ground around the nearest drivable car.
  if (state.mode === 'play' && !state.car) {
    let best = null;
    let bestD = 120 * 120;
    for (const c of state.drivable) {
      const d = (c.x - state.mara.x) ** 2 + (c.y - state.mara.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      ctx.strokeStyle = 'rgba(80,220,120,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(best.x, best.y, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Mission target: pulsing diamond + ground ring, its own colour per phase.
  const target = missionTarget(state);
  if (target && state.mode === 'play') {
    const pulse = 1 + 0.18 * Math.sin(t / 180);
    const color = target.kind === 'pickup' ? '#e8b45a' : '#50dc78';
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.fillRect(-9 * pulse, -9 * pulse, 18 * pulse, 18 * pulse);
    ctx.strokeStyle = '#142d38';
    ctx.lineWidth = 2;
    ctx.strokeRect(-9 * pulse, -9 * pulse, 18 * pulse, 18 * pulse);
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 34 + 6 * Math.sin(t / 180), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(target.kind === 'pickup' ? '!' : '$', target.x, target.y - 44);
  }
  // Safehouse: pink house marker — never the mission colour or icon.
  const sh = SAFEHOUSE;
  if (inView(r, sh.x - 40, sh.y - 40, 80, 80)) {
    ctx.fillStyle = '#ff5c8a';
    ctx.beginPath();
    ctx.moveTo(sh.x, sh.y - 12);
    ctx.lineTo(sh.x + 10, sh.y - 2);
    ctx.lineTo(sh.x + 10, sh.y + 8);
    ctx.lineTo(sh.x - 10, sh.y + 8);
    ctx.lineTo(sh.x - 10, sh.y - 2);
    ctx.closePath();
    ctx.fill();
  }
  // Dust puffs from collisions.
  for (const d of state.dust) {
    ctx.fillStyle = `rgba(200,180,140,${Math.max(0, d.life)})`;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 6 + (0.7 - d.life) * 10, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFurniture(r, t) {
  // Traffic lights at the boulevard intersections — 26 s cycle, shared
  // with the engine so the traffic obeys the same lights the player sees.
  const tMs = state.time * 1000;
  for (const L of city.lights) {
    if (!inView(r, L.x - 60, L.y - 60, 120, 120)) continue;
    const light = lightState(tMs, L.index);
    ctx.fillStyle = '#2c3136';
    ctx.fillRect(L.x + 40, L.y - 44, 8, 26);
    ctx.fillStyle = '#1c1f22';
    ctx.fillRect(L.x + 38, L.y - 46, 12, 10);
    ctx.fillStyle = light === 'red' ? '#ff3b30' : '#571512';
    ctx.beginPath();
    ctx.arc(L.x + 44, L.y - 41, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = light === 'yellow' ? '#ffcc00' : '#574d12';
    ctx.beginPath();
    ctx.arc(L.x + 44, L.y - 36, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = light === 'green' ? '#34c759' : '#12351c';
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
  // Trees: trunk + two-tone canopy + a sunlit crescent, so they read as
  // trees instead of flat green circles.
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
      ctx.fillStyle = '#67a35c';
      ctx.beginPath();
      ctx.arc(tree.x + 1, tree.y - 16, tree.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tree.x, tree.y + tree.r * 0.5);
      ctx.lineTo(tree.x, tree.y + 2);
      ctx.stroke();
      ctx.fillStyle = preset === 'sunset' ? '#5d7a3a' : '#4e8a4a';
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = preset === 'sunset' ? '#74904a' : '#67a35c';
      ctx.beginPath();
      ctx.arc(tree.x - 3, tree.y - 3, tree.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,220,0.25)';
      ctx.beginPath();
      ctx.arc(tree.x - tree.r * 0.35, tree.y - tree.r * 0.4, tree.r * 0.3, 0, Math.PI * 2);
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

// The player car's headlight: a soft beam cone on the road ahead. One
// smooth linear gradient, brightest near the car and fading evenly with
// distance, blurred at the edges — never stacked discs, never a ring,
// never a hard edge. In daylight it is nearly invisible.
function drawHeadlightCone() {
  const car = state.car ?? state.drivable[0];
  const alpha = preset === 'night' ? 0.5 : preset === 'sunset' ? 0.14 : 0.05;
  if (!headlightsOn || alpha <= 0.01) return;
  const fx = car.x + Math.cos(car.angle) * 16;
  const fy = car.y + Math.sin(car.angle) * 16;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(car.angle);
  // Main beam: a trapezoid 14 -> 334 units long, 16 -> 150 wide.
  const g = ctx.createLinearGradient(0, 0, 334, 0);
  g.addColorStop(0, `rgba(255,240,180,${alpha})`);
  g.addColorStop(0.45, `rgba(255,240,180,${alpha * 0.55})`);
  g.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = g;
  ctx.filter = 'blur(9px)';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(334, -75);
  ctx.lineTo(334, 75);
  ctx.lineTo(0, 8);
  ctx.closePath();
  ctx.fill();
  // Bright core: a narrower, hotter wedge inside the main beam.
  const g2 = ctx.createLinearGradient(0, 0, 240, 0);
  g2.addColorStop(0, `rgba(255,246,200,${alpha * 0.75})`);
  g2.addColorStop(0.5, `rgba(255,246,200,${alpha * 0.4})`);
  g2.addColorStop(1, 'rgba(255,246,200,0)');
  ctx.fillStyle = g2;
  ctx.filter = 'blur(6px)';
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(240, -34);
  ctx.lineTo(240, 34);
  ctx.lineTo(0, 5);
  ctx.closePath();
  ctx.fill();
  ctx.filter = 'none';
  ctx.restore();
}

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
  // Street-light pools: smooth radial gradients, no rings. Kept dimmer
  // than Stage A so they stop washing the top of the night frame grey
  // where they overlap the headlight beam.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const lamp of city.lamps) {
    if (!inView(r, lamp.x - 100, lamp.y - 100, 200, 200)) continue;
    const g = ctx.createRadialGradient(lamp.x, lamp.y, 4, lamp.x, lamp.y, 85);
    g.addColorStop(0, 'rgba(255,220,140,0.22)');
    g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 85, 0, Math.PI * 2);
    ctx.fill();
  }
  if (headlightsOn) drawHeadlightCone();
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
  // The headlight cone at sunset is drawn by render() in world space.
}

// ---------------------------------------------------------------- HUD + minimap

function drawHUD(t) {
  const d = districtAt(playerPos(state).x, playerPos(state).y);
  const W = canvas.width;
  const H = canvas.height;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Top-left: title + district with tagline and standing + cash.
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(12, 12, 330, 118);
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
  ctx.fillText(`Standing ${d.standing}/100`, 24, 100);
  ctx.fillStyle = '#2c3e46';
  ctx.fillRect(150, 90, 120, 7);
  ctx.fillStyle = '#e8b45a';
  ctx.fillRect(150, 90, (120 * d.standing) / 100, 7);
  ctx.fillStyle = '#50dc78';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`$${state.cash.toLocaleString('en-US')}  ·  ${fmtClock(state.clockMin)}`, 24, 122);

  // Top-centre: compass strip (north-up) + SOLMAR FM below it.
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(W / 2 - 130, 12, 260, 30);
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('W', W / 2 - 100, 33);
  ctx.fillText('N', W / 2, 33);
  ctx.fillText('E', W / 2 + 100, 33);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  const radio = `SOLMAR FM  ♪  ${RADIO_TRACKS[state.radioTrack]}`;
  ctx.font = '13px sans-serif';
  const rw = ctx.measureText(radio).width;
  ctx.fillRect(W / 2 - rw / 2 - 12, 48, rw + 24, 24);
  ctx.fillStyle = '#ffd166';
  ctx.fillText(radio, W / 2 - rw / 2, 65);

  // Top-right: lighting preset + HEAT stars.
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(W - 212, 12, 200, 30);
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`${PRESETS[preset].name}  ·  press 1/2/3`, W - 200, 33);
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(W - 212, 48, 200, 26);
  ctx.fillStyle = '#cfe0dc';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('HEAT', W - 200, 66);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < Math.round(state.heat) ? '#ff5c5c' : 'rgba(255,255,255,0.25)';
    ctx.font = '15px sans-serif';
    ctx.fillText('★', W - 152 + i * 20, 67);
  }

  // Right side: mission panel — objective in HUD form (dialog + world
  // marker are the other two forms).
  const m = currentMission(state);
  if (m && state.mission) {
    const ms = state.mission;
    const target = missionTarget(state);
    const px = W - 322;
    const py = 84;
    ctx.fillStyle = 'rgba(10,20,28,0.72)';
    ctx.fillRect(px, py, 310, 108);
    ctx.fillStyle = '#e8b45a';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`MISSION ${m.id} — ${m.name.toUpperCase()}`, px + 12, py + 22);
    ctx.fillStyle = '#f2e3c2';
    ctx.font = '13px sans-serif';
    const obj = ms.phase === 'pickup'
      ? `Pick up: ${target.label}`
      : `Deliver: ${target.label}`;
    ctx.fillText(obj.length > 42 ? obj.slice(0, 42) + '…' : obj, px + 12, py + 44);
    ctx.fillStyle = '#8fa8a0';
    ctx.font = '12px sans-serif';
    const pos = playerPos(state);
    const distM = Math.round(Math.sqrt((pos.x - target.x) ** 2 + (pos.y - target.y) ** 2) / 2);
    ctx.fillText(
      `${ms.started ? `TIME ${fmtTime(ms.elapsed)}` : 'TIMER STARTS WHEN YOU MOVE'}  ·  ${distM} m`,
      px + 12, py + 64,
    );
    ctx.fillStyle = '#50dc78';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`REWARD $${m.reward}`, px + 12, py + 88);
    ctx.fillStyle = '#2c3e46';
    ctx.fillRect(px + 150, py + 78, 148, 8);
    ctx.fillStyle = '#50dc78';
    ctx.fillRect(px + 150, py + 78, (148 * state.missionsDone) / 4, 8);
    ctx.fillStyle = '#8fa8a0';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${state.missionsDone}/4 done`, px + 150, py + 102);
  } else if (state.missionsDone >= 4) {
    ctx.fillStyle = 'rgba(10,20,28,0.72)';
    ctx.fillRect(W - 322, 84, 310, 44);
    ctx.fillStyle = '#50dc78';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('ALL MISSIONS COMPLETE — $2,000', W - 310, 112);
  }

  // Bottom-left: big speedometer + health bar under it.
  const speedKmh = state.car ? Math.round(Math.abs(upsToKmh(state.car.speed))) : 0;
  const sx = 78;
  const sy = H - 78;
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.beginPath();
  ctx.arc(sx, sy, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = speedKmh > 90 ? '#ff5c5c' : '#e8b45a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sx, sy, 56, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  // Needle.
  const prof = state.car ? PROFILES[state.car.profile] : PROFILES.sedan;
  const frac = clamp(speedKmh / prof.topKmh, 0, 1);
  const na = Math.PI * 0.75 + frac * Math.PI * 1.5;
  ctx.strokeStyle = '#f2e3c2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + Math.cos(na) * 46, sy + Math.sin(na) * 46);
  ctx.stroke();
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(speedKmh), sx, sy + 4);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#8fa8a0';
  ctx.fillText('km/h', sx, sy + 24);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(28, H - 8, 100, 0);
  ctx.fillStyle = '#8fa8a0';
  ctx.font = '11px sans-serif';
  ctx.fillText(state.car ? prof.name.toUpperCase() : 'ON FOOT', 28, H - 12);
  // Health bar.
  ctx.fillStyle = 'rgba(10,20,28,0.62)';
  ctx.fillRect(140, H - 40, 130, 24);
  ctx.fillStyle = '#cfe0dc';
  ctx.font = '11px sans-serif';
  ctx.fillText('CAR', 148, H - 23);
  ctx.fillStyle = '#2c3e46';
  ctx.fillRect(178, H - 32, 84, 8);
  ctx.fillStyle = state.health > 50 ? '#50dc78' : state.health > 25 ? '#e8b45a' : '#ff5c5c';
  ctx.fillRect(178, H - 32, (84 * state.health) / 100, 8);

  // E prompt when Mara is on foot near a drivable car.
  if (state.mode === 'play' && !state.car) {
    let best = null;
    let bestD = 70 * 70;
    for (const c of state.drivable) {
      const d = (c.x - state.mara.x) ** 2 + (c.y - state.mara.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      const label = `E — Enter the ${PROFILES[best.profile].name}`;
      ctx.font = 'bold 15px sans-serif';
      const lw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(10,20,28,0.78)';
      ctx.fillRect(W / 2 - lw / 2 - 14, H - 148, lw + 28, 30);
      ctx.fillStyle = '#50dc78';
      ctx.textAlign = 'center';
      ctx.fillText(label, W / 2, H - 127);
      ctx.textAlign = 'left';
    }
  }

  // Dialog box: the mission objective in dialog form.
  if (state.dialog && state.mode === 'play') {
    const dw = 660;
    const dx = W / 2 - dw / 2;
    const dy = H - 108;
    ctx.fillStyle = 'rgba(10,20,28,0.82)';
    ctx.fillRect(dx, dy, dw, 64);
    ctx.strokeStyle = '#d77f69';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx + 1, dy + 1, dw - 2, 62);
    ctx.fillStyle = '#d77f69';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(state.dialog.speaker.toUpperCase(), dx + 14, dy + 20);
    ctx.fillStyle = '#f2e3c2';
    ctx.font = '14px sans-serif';
    const words = state.dialog.text.split(' ');
    let line = '';
    let ly = dy + 40;
    for (const w of words) {
      if (ctx.measureText(line + w + ' ').width > dw - 28) {
        ctx.fillText(line, dx + 14, ly);
        line = '';
        ly += 17;
      }
      line += w + ' ';
    }
    ctx.fillText(line, dx + 14, ly);
  }

  // Mission-4 finale broadcast, centre screen.
  if (state.broadcast) {
    const bt = state.broadcast.text;
    ctx.font = 'bold 20px sans-serif';
    const bw = ctx.measureText(bt).width;
    ctx.fillStyle = 'rgba(10,20,28,0.78)';
    ctx.fillRect(W / 2 - bw / 2 - 16, 110, bw + 32, 36);
    ctx.fillStyle = '#ffd166';
    ctx.textAlign = 'center';
    ctx.fillText(bt, W / 2, 135);
    ctx.textAlign = 'left';
  }

  // Bottom-centre: the control scheme, written on screen in every mode.
  const controls = state.car
    ? 'W/S — drive · A/D — steer · SPACE — handbrake · E — exit car · H — headlights · 1/2/3 — lighting'
    : 'WASD — walk · E — enter car · H — headlights · 1/2/3 — lighting';
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
  // GPS route to the mission target.
  const target = missionTarget(state);
  if (target && state.mode === 'play') {
    const route = findRoute(state.graph, playerPos(state), target);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < route.length; i++) {
      const px = mx + route[i].x * s;
      const py = my + route[i].y * s;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Mission marker on the minimap.
    ctx.fillStyle = target.kind === 'pickup' ? '#e8b45a' : '#50dc78';
    ctx.save();
    ctx.translate(mx + target.x * s, my + target.y * s);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
  // Safehouse (pink) + patrol cars (white dots).
  ctx.fillStyle = '#ff5c8a';
  ctx.fillRect(mx + SAFEHOUSE.x * s - 3, my + SAFEHOUSE.y * s - 3, 6, 6);
  ctx.fillStyle = '#ffffff';
  for (const p of state.patrol) {
    ctx.beginPath();
    ctx.arc(mx + p.x * s, my + p.y * s, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Viewport rectangle + player arrow.
  const vw = (canvas.width / cam.zoom) * s;
  const vh = (canvas.height / cam.zoom) * s;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + (cam.cx - canvas.width / cam.zoom / 2) * s, my + (cam.cy - canvas.height / cam.zoom / 2) * s, vw, vh);
  const pp = playerPos(state);
  const px = mx + pp.x * s;
  const py = my + pp.y * s;
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

// ---------------------------------------------------------------- title

function drawTitle(t) {
  const W = canvas.width;
  const H = canvas.height;
  // Slow pan over the plaza at sunset behind the menu.
  cam.cx = 1920 + Math.sin(t / 9000) * 420;
  cam.cy = 1728 + Math.cos(t / 11000) * 300;
  cam.zoom = 0.9;
  // Darken the vista so the type reads.
  ctx.fillStyle = 'rgba(8,16,28,0.45)';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(8,16,28,0.15)');
  g.addColorStop(0.55, 'rgba(8,16,28,0.05)');
  g.addColorStop(1, 'rgba(8,16,28,0.75)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  // Logo.
  ctx.fillStyle = '#d77f69';
  ctx.font = 'bold 92px sans-serif';
  ctx.fillText('PALKON AUTO', W / 2, H * 0.34);
  ctx.fillStyle = '#f2e3c2';
  ctx.font = 'bold 92px sans-serif';
  ctx.globalAlpha = 0.16;
  ctx.fillText('PALKON AUTO', W / 2 + 4, H * 0.34 + 4);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#e8b45a';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('—  A  S O L M A R  S T O R Y  —', W / 2, H * 0.34 + 44);
  ctx.fillStyle = '#cfe0dc';
  ctx.font = '16px sans-serif';
  ctx.fillText('Mara Venn vs Bastion Civic  ·  Four jobs. One city. $2,000 on the line.', W / 2, H * 0.34 + 76);

  if (state.showHelp) {
    ctx.fillStyle = 'rgba(10,20,28,0.85)';
    ctx.fillRect(W / 2 - 330, H * 0.48, 660, 220);
    ctx.strokeStyle = '#e8b45a';
    ctx.lineWidth = 2;
    ctx.strokeRect(W / 2 - 330, H * 0.48, 660, 220);
    ctx.fillStyle = '#f2e3c2';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('HOW TO PLAY', W / 2, H * 0.48 + 36);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#cfe0dc';
    const lines = [
      'W / S — drive & brake · A / D — steer · SPACE — handbrake',
      'E — enter or exit a car (green ring = drivable, grey = locked)',
      'Follow the yellow marker: dialog, HUD panel and map all agree.',
      'The timer starts when you move. HEAT rises with speeding,',
      'crashes and red lights — at 3 stars the patrol hunts you.',
      '1 / 2 / 3 — midday, sunset, night · H — headlights',
    ];
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.48 + 68 + i * 24));
    ctx.fillStyle = '#e8b45a';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('Press Enter to go back', W / 2, H * 0.48 + 196);
  } else {
    const items = ['START', 'HOW TO PLAY'];
    items.forEach((label, i) => {
      const y = H * 0.52 + i * 56;
      const selected = state.menuIndex === i;
      ctx.fillStyle = selected ? '#e8b45a' : '#f2e3c2';
      ctx.font = `bold ${selected ? 30 : 24}px sans-serif`;
      ctx.fillText((selected ? '▶ ' : '') + label, W / 2, y);
    });
    ctx.fillStyle = '#8fa8a0';
    ctx.font = '15px sans-serif';
    ctx.fillText('Press Enter  ·  Use ↑ ↓ to choose', W / 2, H * 0.52 + 140);
  }
  ctx.fillStyle = 'rgba(242,227,194,0.75)';
  ctx.font = '13px sans-serif';
  ctx.fillText('SOLMAR FM is on the air  ·  An original story — no real people, places or brands', W / 2, H - 24);
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------- frame

let last = 0;
function frame(now) {
  const t = fixedT !== null ? fixedT : now;
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  const input = buildInput();
  if (state.mode === 'title') {
    stepTitle(input);
  } else if (!still) {
    let driveInput = input;
    if (autodrive && state.car && state.mode === 'play') {
      driveInput = { ...autopilotInput(state, { x: 1928, y: 200 }, { lawful: true }), e: false, enter: false };
    }
    stepGame(state, driveInput, dt);
  }
  // Camera follows the player smoothly — unless the shot is fixed.
  if (fixedT === null && state.mode !== 'title') {
    const pp = playerPos(state);
    const k = 1 - Math.exp(-5 * dt);
    cam.cx += (pp.x - cam.cx) * k;
    cam.cy += (pp.y - cam.cy) * k;
    cam.zoom = 1;
  }
  render(t);
  requestAnimationFrame(frame);
}

function render(t) {
  const r = visibleRect();
  const shx = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 10 : 0;
  const shy = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 10 : 0;
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, canvas.width / 2 - cam.cx * cam.zoom + shx, canvas.height / 2 - cam.cy * cam.zoom + shy);
  drawGround(r);
  drawRoads(r);
  drawFountain();
  drawShadows(r);
  drawBuildings(r, t);
  drawCars(r, t);
  drawPedestrians(r, t);
  drawMissionMarkers(r, t);
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
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, canvas.width / 2 - cam.cx * cam.zoom + shx, canvas.height / 2 - cam.cy * cam.zoom + shy);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (headlightsOn) drawHeadlightCone();
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.fillStyle = 'rgba(8,16,44,0.52)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, canvas.width / 2 - cam.cx * cam.zoom + shx, canvas.height / 2 - cam.cy * cam.zoom + shy);
    drawNightExtras(r);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (state.mode === 'title') {
    drawTitle(t);
  } else {
    drawHUD(t);
  }
}

// First frame synchronously so a headless screenshot always has a picture.
render(fixedT !== null ? fixedT : 0);
requestAnimationFrame(frame);
