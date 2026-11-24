// verify-layout.mjs — checks the city of Solmar before it ships.
// Imports the same city.js the game draws, so the checks run on the real
// city, not a copy of it. Exit code 0 when there are no problems.
//
// Checks:
//  1. Boulevard sidewalks run along BOTH sides, every segment (sampled
//     every 32 world units along the full boulevard).
//  2. No building corner sits on a road.
//  3. No car (parked, traffic base position, player) sits inside a building.
//  4. Every pedestrian's anchor point sits on a sidewalk.
//  5. No building overlaps another building.
//  6. Sanity floors: enough buildings, cars, pedestrians, lamps, trees.
import { buildCity, trafficPos, pedestrianPos, pointInRect, ROAD_KINDS } from '../game/city.js';

const city = buildCity();
const problems = [];
const note = (msg) => problems.push(msg);

function onRoad(x, y) {
  return city.roads.some((r) => pointInRect(x, y, r));
}
function onSidewalk(x, y) {
  return city.sidewalks.some((s) => pointInRect(x, y, s));
}
function inBuilding(x, y) {
  return city.buildings.some((b) => pointInRect(x, y, b));
}

// 1. Boulevard sidewalks, both sides, every segment.
{
  const sw = ROAD_KINDS.boulevard.sw;
  let missingLeft = 0;
  let missingRight = 0;
  for (let y = 0; y < 3456; y += 32) {
    if (!onSidewalk(1888 - sw / 2, y)) missingLeft++;
    if (!onSidewalk(1952 + sw / 2, y)) missingRight++;
  }
  if (missingLeft > 0) note(`boulevard west sidewalk missing at ${missingLeft} sample points`);
  if (missingRight > 0) note(`boulevard east sidewalk missing at ${missingRight} sample points`);
}

// 2. No building corner on a road.
let buildingCornerOnRoad = 0;
for (const b of city.buildings) {
  const corners = [
    [b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h],
  ];
  if (corners.some(([x, y]) => onRoad(x, y))) buildingCornerOnRoad++;
}
if (buildingCornerOnRoad > 0) note(`${buildingCornerOnRoad} buildings have a corner on a road`);

// 3. No car inside a building.
let carsInBuildings = 0;
const checkCar = (x, y, what) => {
  if (inBuilding(x, y)) { carsInBuildings++; note(`${what} at (${Math.round(x)},${Math.round(y)}) sits inside a building`); }
};
for (const p of city.parked) checkCar(p.x, p.y, 'parked car');
for (const c of city.traffic) {
  const pos = trafficPos(c, 1200);
  checkCar(pos.x, pos.y, 'traffic car');
}
checkCar(city.player.x, city.player.y, 'player car');

// 4. Every pedestrian on a sidewalk.
let pedsOffSidewalk = 0;
for (const p of city.pedestrians) {
  const pos = pedestrianPos(p, 0);
  if (!onSidewalk(pos.x, pos.y)) pedsOffSidewalk++;
}
if (pedsOffSidewalk > 0) note(`${pedsOffSidewalk} pedestrians are not on a sidewalk`);

// 5. No building overlaps another.
let overlaps = 0;
const bs = city.buildings;
for (let i = 0; i < bs.length; i++) {
  for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i];
    const b = bs[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps++;
  }
}
if (overlaps > 0) note(`${overlaps} building pairs overlap`);

// 6. Sanity floors.
const counts = {
  buildings: city.buildings.length,
  parkedCars: city.parked.length,
  trafficCars: city.traffic.length,
  pedestrians: city.pedestrians.length,
  lamps: city.lamps.length,
  trees: city.trees.length,
  boats: city.boats.length,
  trafficLights: city.lights.length,
  landmarks: city.buildings.filter((b) => b.landmark).length,
  shopfronts: city.buildings.filter((b) => b.shop).length,
  rooftopProps: city.buildings.reduce((n, b) => n + b.props.length, 0),
  sidewalks: city.sidewalks.length,
};
const floors = { buildings: 400, parkedCars: 40, trafficCars: 30, pedestrians: 80, lamps: 40, trees: 40, boats: 5, trafficLights: 4, landmarks: 4, shopfronts: 10 };
for (const [k, min] of Object.entries(floors)) {
  if (counts[k] < min) note(`${k}: only ${counts[k]} (floor ${min})`);
}

console.log('LAYOUT COUNTS ' + JSON.stringify(counts));
if (problems.length === 0) {
  console.log('LAYOUT: 0 problems');
} else {
  console.log(`LAYOUT: ${problems.length} problems`);
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
