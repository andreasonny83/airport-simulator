/**
 * Road traffic: cars driving between the edge of the map and the airports'
 * car parks, along the roads exactly as drawn (see `RoadNetwork`).
 *
 * Nothing pops into view:
 *   - cars arrive from the roads' far ends, out in the horizon haze, and
 *     leave the same way;
 *   - the rest are parked in the car parks. A parked car backs out of its
 *     bay after a while and drives off, and cars arriving from the country
 *     often head for a car park, drive in and take a free bay (reserved
 *     when they set off, so it's still free when they get there).
 *
 * Cars keep to the right-hand lane, slow down in car parks, keep their
 * distance from the car in front, and wait at a drawbridge's barrier while
 * it's up (see core/bridges.ts).
 *
 * Decoration only, like the boats (core/boats.ts): the simulation never
 * reads it. Pure and seeded, so the traffic is the same every game;
 * render/cars.ts draws it.
 */
import {
  CAR_FOLLOW_GAP,
  CAR_LANE_OFFSET,
  CAR_MAX,
  CAR_PARK_FILL,
  CAR_PARK_SPEED,
  CAR_PARK_TIME_MAX,
  CAR_PARK_TIME_MIN,
  CAR_SPAWN_MAX,
  CAR_SPAWN_MIN,
  CAR_SPEED,
} from "../config";
import type { Airport, Bay } from "./airports";
import { closedToCars, type BridgeState } from "./bridges";
import { routeBetween, type RoadNetwork } from "./countryside";
import {
  arcLengths,
  distanceToSegment,
  nearestOnPolyline,
  offsetPolyline,
  resamplePolyline,
  roundCorners,
} from "./geometry";
import { lerp, mulberry32 } from "./math";
import { horizonFade, type Bounds } from "./scenery";
import type { Rng, Vec2 } from "./types";

/** A car park the traffic uses: its road node, gate and bays. */
export interface CarPark {
  /** Road network node at the car park's entrance. */
  node: number;
  entrance: Vec2;
  gate: Vec2;
  bays: Bay[];
  /** Car id in (or on its way to) each bay, or null if free. */
  taken: (number | null)[];
  /**
   * The entry lane (entrance ↔ gate) is shared both ways, and cars leaving
   * turn across the lane of cars coming in. So it works like a single-lane
   * bridge: any number of cars going the same way, never both ways at once.
   */
  lane: { dir: "in" | "out" | null; cars: Set<number> };
}

/** One stretch of a car's trip, driven forwards or in reverse. */
export interface Leg {
  line: Vec2[];
  along: number[];
  length: number;
  /** Backing out of a bay: the car faces the other way from its motion. */
  reverse: boolean;
  /** Distances along the leg where it's in a car park (slow), from the start / to the end. */
  slowUntil: number;
  slowFrom: number;
  /** Where the leg crosses a bridge: its index and the stretch of the leg on it. */
  bridges: { bridge: number; from: number; to: number }[];
  /** Where the leg uses a car park's entry lane, and which way. */
  lanes: { park: number; from: number; to: number; dir: "in" | "out" }[];
}

export interface Car {
  id: number;
  legs: Leg[];
  leg: number;
  /** Distance along the current leg. */
  s: number;
  speed: number;
  /** Cruising speed on the open road: each driver is a little different. */
  cruise: number;
  /** Parked in this bay (legs are empty until it sets off). */
  parked: { park: number; bay: number } | null;
  /** Seconds left before a parked car sets off. */
  timer: number;
  /** Bay this car holds: the one it's parked in, backing out of, or driving to. */
  holds: { park: number; bay: number } | null;
  /** Bay it's driving to next, held once it has backed out of `holds`. */
  next: { park: number; bay: number } | null;
  /** The car it slowed down for last step, if any (for settling who goes first). */
  yieldTo: number | null;
}

export interface CarTraffic {
  network: RoadNetwork;
  parks: CarPark[];
  bridges: readonly BridgeState[];
  bounds: Bounds;
  /** Road network nodes at the map's edge, where cars come and go. */
  edges: number[];
  cars: Car[];
  nextSpawnIn: number;
  nextId: number;
  rng: Rng;
}

/** Where a car is now, ready to draw. */
export interface CarPose {
  pos: Vec2;
  heading: number;
}

const TRAFFIC_SEED = 0xca75;
/** Spacing of the points cars follow. */
const STEP = 0.4;
/** Braking and acceleration (units / second²). */
const BRAKE = 5;
const ACCEL = 2;
/** Cars look this far ahead for traffic, and ignore cars further than this to the side. */
const LOOK_AHEAD = 4.5;
const LOOK_SIDE = 0.8;
/** …or this far, for a car going the same way (merging in at a junction). */
const LOOK_SIDE_MERGE = 1.5;
/** Cars in the car park keep to the right of the aisle by this much. */
const AISLE_LANE = 0.45;
/**
 * New cars from the map's edge only fill `CAR_MAX - LEAVE_HEADROOM` of the
 * driving places; the rest are kept for cars leaving the car parks, so
 * parks neither fill up for good nor drain.
 */
const LEAVE_HEADROOM = 6;
/** Parked cars wait longer while fewer than this share of bays is taken. */
const PARKED_TARGET = 0.45;
/** Cars already on the road when the world is built (it doesn't start empty). */
const START_ON_ROAD = 5;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * @param bounds  the scenery map: trips to and from the map's edge start
 *   and end where the horizon haze hides a car completely (see
 *   `horizonFade`), not at the very edge, so cars don't spend minutes
 *   driving where nobody can see them.
 */
export function createCarTraffic(
  network: RoadNetwork,
  airports: readonly Airport[],
  bridges: readonly BridgeState[],
  bounds: Bounds,
): CarTraffic {
  const rng = mulberry32(TRAFFIC_SEED);
  const parks: CarPark[] = [];
  airports.forEach((a, i) => {
    const node = network.nodes.findIndex((n) => n.kind === "entrance" && n.airport === i);
    if (!a.landside || node < 0) return;
    parks.push({
      node,
      entrance: a.landside.entrance,
      gate: a.landside.gate,
      bays: a.landside.bays,
      taken: a.landside.bays.map(() => null),
      lane: { dir: null, cars: new Set() },
    });
  });
  const edges = network.nodes.flatMap((n, i) => (n.kind === "edge" ? [i] : []));
  const traffic: CarTraffic = {
    network,
    parks,
    bridges,
    bounds,
    edges,
    cars: [],
    nextSpawnIn: 1,
    nextId: 0,
    rng,
  };

  // Car parks start partly full, cars leaving at staggered times.
  parks.forEach((park, p) =>
    park.bays.forEach((_, b) => {
      if (rng() >= CAR_PARK_FILL) return;
      const car = newCar(traffic);
      car.parked = { park: p, bay: b };
      car.holds = { park: p, bay: b };
      car.timer = lerp(3, CAR_PARK_TIME_MAX, rng());
      park.taken[b] = car.id;
      traffic.cars.push(car);
    }),
  );
  // And a few already driving, part-way through their trip.
  for (let i = 0; i < START_ON_ROAD; i++) {
    const car = spawnFromEdge(traffic);
    if (!car) continue;
    const leg = car.legs[0]!;
    car.s = leg.length * lerp(0.35, 0.8, rng());
  }
  return traffic;
}

function newCar(traffic: CarTraffic): Car {
  const cruise = CAR_SPEED * lerp(0.8, 1.2, traffic.rng());
  return {
    id: traffic.nextId++,
    legs: [],
    leg: 0,
    s: 0,
    speed: 0,
    cruise,
    parked: null,
    timer: 0,
    holds: null,
    next: null,
    yieldTo: null,
  };
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

/** Share of all car park bays with a car parked in them. */
function parkedShare(traffic: CarTraffic): number {
  const bays = traffic.parks.reduce((n, p) => n + p.taken.length, 0);
  return bays ? traffic.cars.filter((c) => c.parked).length / bays : 0;
}

/** Share of all car park bays that are free (or 0 with no car parks). */
function freeShare(traffic: CarTraffic): number {
  let free = 0;
  let total = 0;
  for (const park of traffic.parks) {
    total += park.taken.length;
    free += park.taken.filter((id) => id === null).length;
  }
  return total ? free / total : 0;
}

/** A free bay somewhere (random park, random bay), or null. */
function freeBay(traffic: CarTraffic, exceptPark = -1): { park: number; bay: number } | null {
  const { rng } = traffic;
  const options: { park: number; bay: number }[] = [];
  traffic.parks.forEach((park, p) => {
    if (p === exceptPark) return;
    park.taken.forEach((id, b) => {
      if (id === null) options.push({ park: p, bay: b });
    });
  });
  return options.length ? options[Math.floor(rng() * options.length)]! : null;
}

/** New car at a random map-edge road end, heading for a car park or out another way. */
function spawnFromEdge(traffic: CarTraffic): Car | null {
  const { rng, edges, network } = traffic;
  if (edges.length === 0) return null;
  const origin = edges[Math.floor(rng() * edges.length)]!;
  // Wait until the last car to arrive here has pulled away.
  const at = network.nodes[origin]!.pos;
  const busy = traffic.cars.some((c) => {
    if (c.parked) return false;
    const p = carPose(traffic, c).pos;
    return Math.hypot(p.x - at.x, p.y - at.y) < 5;
  });
  if (busy) return null;
  // Emptier car parks draw more cars in, so they settle about half full.
  const bay = rng() < 0.15 + freeShare(traffic) ? freeBay(traffic) : null;
  const others = edges.filter((e) => e !== origin);
  const dest = bay ? traffic.parks[bay.park]!.node : others[Math.floor(rng() * others.length)];
  if (dest === undefined) return null;
  const full = routeBetween(network, origin, dest);
  if (!full) return null;
  const road = trimHaze(traffic, full);

  const car = newCar(traffic);
  const pieces = [offsetPolyline(road, CAR_LANE_OFFSET)];
  let slowTail = 0;
  if (bay) {
    const inside = parkIn(traffic.parks[bay.park]!, bay.bay);
    slowTail = polylineLength(inside);
    pieces.push(inside);
    car.holds = bay;
    traffic.parks[bay.park]!.taken[bay.bay] = car.id;
  }
  car.legs = [makeLeg(traffic, pieces, false, 0, slowTail)];
  car.speed = car.cruise;
  traffic.cars.push(car);
  return car;
}

/** Legs for a parked car leaving: back out of the bay, then drive away. */
function setOff(traffic: CarTraffic, car: Car): boolean {
  const { rng, network } = traffic;
  const here = car.parked!;
  const park = traffic.parks[here.park]!;
  const bay = park.bays[here.bay]!;
  const other = rng() < 0.25 ? freeBay(traffic, here.park) : null;
  const dest = other
    ? traffic.parks[other.park]!.node
    : traffic.edges[Math.floor(rng() * traffic.edges.length)];
  if (dest === undefined) return false;
  const full = routeBetween(network, park.node, dest);
  if (!full) return false;
  const road = trimHaze(traffic, full);

  const { reverse, out } = parkOut(park, bay);
  const outLength = polylineLength(out);
  const pieces = [out, offsetPolyline(road, CAR_LANE_OFFSET)];
  let slowTail = 0;
  if (other) {
    const inside = parkIn(traffic.parks[other.park]!, other.bay);
    slowTail = polylineLength(inside);
    pieces.push(inside);
    traffic.parks[other.park]!.taken[other.bay] = car.id;
  }
  car.legs = [
    makeLeg(traffic, [reverse], true, Infinity, 0),
    makeLeg(traffic, pieces, false, outLength, slowTail),
  ];
  car.leg = 0;
  car.s = 0;
  car.speed = 0;
  car.parked = null;
  // Keeps holding its old bay until it has backed out; then `other`, if any.
  car.holds = here;
  car.timer = 0;
  car.next = other;
  return true;
}

/**
 * Cut a route's ends that run out into the horizon haze: from the first to
 * the last point where a car would still be (just) visible, plus a little.
 * Routes between two car parks never reach the haze and come back whole.
 */
function trimHaze(traffic: CarTraffic, route: readonly Vec2[]): Vec2[] {
  const hidden = (p: Vec2) => horizonFade(p, traffic.bounds) > 0.985;
  let first = 0;
  while (first < route.length - 2 && hidden(route[first]!) && hidden(route[first + 1]!)) first++;
  let last = route.length - 1;
  while (last > first + 1 && hidden(route[last]!) && hidden(route[last - 1]!)) last--;
  return route.slice(first, last + 1);
}

/**
 * From the car park's entrance to bay `b`: in along the entry lane, along
 * the aisle, and round into the bay nose first (right-hand lanes).
 */
function parkIn(park: CarPark, b: number): Vec2[] {
  const bay = park.bays[b]!;
  const lane = offsetPolyline(dedupe([park.entrance, park.gate, bay.front]), AISLE_LANE);
  return [...lane, bay.pos];
}

/**
 * Leaving bay `bay`: back out into the aisle, turning to face the gate
 * (`reverse`), then drive along the aisle and out of the entrance (`out`).
 */
function parkOut(park: CarPark, bay: Bay): { reverse: Vec2[]; out: Vec2[] } {
  const toGate = { x: park.gate.x - bay.front.x, y: park.gate.y - bay.front.y };
  let len = Math.hypot(toGate.x, toGate.y);
  let d = { x: toGate.x / (len || 1), y: toGate.y / (len || 1) };
  if (len < 0.3) {
    // Right in front of the gate: head off along the aisle either way.
    const toEntrance = { x: park.entrance.x - park.gate.x, y: park.entrance.y - park.gate.y };
    len = Math.hypot(toEntrance.x, toEntrance.y) || 1;
    d = { x: -toEntrance.y / len, y: toEntrance.x / len };
  }
  // Back out a little past the bay, away from the gate.
  const start = { x: bay.front.x - d.x * 1.2, y: bay.front.y - d.y * 1.2 };
  const out = offsetPolyline(dedupe([start, park.gate, park.entrance]), AISLE_LANE);
  const mid = {
    x: bay.pos.x + (bay.front.x - bay.pos.x) * 0.7,
    y: bay.pos.y + (bay.front.y - bay.pos.y) * 0.7,
  };
  return { reverse: [bay.pos, mid, out[0]!], out };
}

/**
 * Join `pieces` into one smooth leg: corners rounded (junction turns, the
 * turn into a bay), points evenly spaced. `slowUntil` / `slowTail`: how much
 * of the start / end is car park, driven slowly.
 */
function makeLeg(
  traffic: CarTraffic,
  pieces: readonly Vec2[][],
  reverse: boolean,
  slowUntil: number,
  slowTail: number,
): Leg {
  const joined: Vec2[] = [];
  for (const piece of pieces) joined.push(...(joined.length ? piece.slice(1) : piece));
  const line = resamplePolyline(roundCorners(dedupe(joined), 3), STEP);
  const along = arcLengths(line);
  const length = along[along.length - 1]!;
  const leg: Leg = {
    line,
    along,
    length,
    reverse,
    slowUntil,
    slowFrom: length - slowTail,
    bridges: [],
    lanes: [],
  };
  // Where this leg runs over a bridge.
  traffic.bridges.forEach((state, i) => {
    let from = Infinity;
    let to = -Infinity;
    line.forEach((p, k) => {
      if (nearestOnPolyline(p, state.bridge.points).distance < 1.6) {
        from = Math.min(from, along[k]!);
        to = Math.max(to, along[k]!);
      }
    });
    if (from < to) leg.bridges.push({ bridge: i, from, to });
  });
  // Where this leg uses a car park's entry lane, and which way.
  traffic.parks.forEach((park, i) => {
    let from = Infinity;
    let to = -Infinity;
    line.forEach((p, k) => {
      if (distanceToSegment(p, park.entrance, park.gate) < 1.4) {
        from = Math.min(from, along[k]!);
        to = Math.max(to, along[k]!);
      }
    });
    if (!(from < to)) return;
    const start = line[along.findIndex((a) => a >= from)]!;
    const dIn = Math.hypot(start.x - park.entrance.x, start.y - park.entrance.y);
    const dGate = Math.hypot(start.x - park.gate.x, start.y - park.gate.y);
    leg.lanes.push({ park: i, from, to, dir: dIn < dGate ? "in" : "out" });
  });
  return leg;
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

/** Advance traffic by `dt` seconds. */
export function stepCars(traffic: CarTraffic, dt: number): void {
  const { rng } = traffic;
  // New arrivals from the country, out in the haze.
  traffic.nextSpawnIn -= dt;
  if (traffic.nextSpawnIn <= 0) {
    traffic.nextSpawnIn = lerp(CAR_SPAWN_MIN, CAR_SPAWN_MAX, rng());
    const driving = traffic.cars.filter((c) => !c.parked).length;
    if (driving < CAR_MAX - LEAVE_HEADROOM) spawnFromEdge(traffic);
  }

  const poses = new Map<number, { pos: Vec2; dir: Vec2 }>();
  for (const car of traffic.cars) {
    if (car.parked) continue;
    const pose = sample(car.legs[car.leg]!, car.s);
    poses.set(car.id, { pos: pose.pos, dir: pose.dir });
  }

  for (const car of traffic.cars) {
    if (car.parked) {
      car.timer -= dt;
      // Set off once the aisle behind the bay is clear and the roads aren't full.
      const driving = traffic.cars.filter((c) => !c.parked).length;
      // A car park under half full keeps its cars a while longer.
      if (car.timer <= 0 && parkedShare(traffic) < PARKED_TARGET) {
        car.timer = lerp(5, 20, rng());
      }
      if (
        car.timer <= 0 &&
        driving < CAR_MAX &&
        aisleClear(traffic, car, poses) &&
        laneFreeToLeave(traffic, car.parked.park) &&
        setOff(traffic, car)
      ) {
        // Reserve the entry lane for leaving: arrivals wait at the entrance.
        const lane = traffic.parks[car.holds!.park]!.lane;
        lane.cars.add(car.id);
        lane.dir = "out";
      }
      continue;
    }
    const leg = car.legs[car.leg]!;
    const limit = speedLimit(traffic, car, leg, poses);
    car.speed =
      limit < car.speed
        ? Math.max(limit, car.speed - BRAKE * dt)
        : Math.min(limit, car.speed + ACCEL * dt);
    car.s += car.speed * dt;
    trackLanes(traffic, car, leg);
    if (car.s < leg.length) continue;

    if (car.leg + 1 < car.legs.length) {
      // Backed out of the bay: it's free for someone else now.
      if (car.holds) traffic.parks[car.holds.park]!.taken[car.holds.bay] = null;
      car.holds = car.next;
      car.next = null;
      car.leg++;
      car.s = 0;
      car.speed = 0;
    } else if (car.holds) {
      // Pulled into its bay: done with the entry lane.
      leaveLanes(traffic, car);
      car.parked = car.holds;
      car.legs = [];
      car.leg = 0;
      car.s = 0;
      car.speed = 0;
      car.timer = lerp(CAR_PARK_TIME_MIN, CAR_PARK_TIME_MAX, rng());
    } else {
      car.s = Infinity; // off the map: removed below
    }
  }
  for (const car of traffic.cars) if (car.s === Infinity) leaveLanes(traffic, car);
  traffic.cars = traffic.cars.filter((c) => c.parked || c.s !== Infinity);
}

/**
 * Sign `car` in to the entry lanes it's on, and out of those it has left.
 * Leaving cars signed in when they set off (see `setOff`) and stay signed
 * in until they're through the lane.
 */
function trackLanes(traffic: CarTraffic, car: Car, leg: Leg): void {
  for (const span of leg.lanes) {
    const lane = traffic.parks[span.park]!.lane;
    const inside = (span.dir === "out" || car.s >= span.from - 0.3) && car.s <= span.to + 0.3;
    if (inside) {
      lane.cars.add(car.id);
      lane.dir = span.dir;
    } else if (lane.cars.delete(car.id) && lane.cars.size === 0) {
      lane.dir = null;
    }
  }
}

/** Sign `car` out of every entry lane (it's gone). */
function leaveLanes(traffic: CarTraffic, car: Car): void {
  for (const park of traffic.parks) {
    if (park.lane.cars.delete(car.id) && park.lane.cars.size === 0) park.lane.dir = null;
  }
}

/** Highest speed `car` may do now: cruise, car park, traffic ahead, bridge barrier, end of leg. */
function speedLimit(
  traffic: CarTraffic,
  car: Car,
  leg: Leg,
  poses: ReadonlyMap<number, { pos: Vec2; dir: Vec2 }>,
): number {
  const stopWithin = (d: number, v = 0) => Math.sqrt(v * v + 2 * BRAKE * 0.6 * Math.max(0, d));
  const inPark = car.s < leg.slowUntil || car.s > leg.slowFrom;
  let limit = inPark
    ? CAR_PARK_SPEED
    : Math.min(car.cruise, stopWithin(leg.slowFrom - car.s, CAR_PARK_SPEED));
  // Pull up gently at the end of the leg (in the bay, or before backing out).
  if (leg.reverse || car.holds) limit = Math.min(limit, stopWithin(leg.length - car.s, 0.4));

  // Traffic ahead in our lane (whatever road it's on).
  const me = poses.get(car.id)!;
  let yieldTo: number | null = null;
  for (const other of traffic.cars) {
    if (other === car || other.parked) continue;
    // (A car that set off this step has no pose yet: it starts next step.)
    const them = poses.get(other.id);
    if (!them) continue;
    const gap = aheadGap(me, them);
    if (gap === null) continue;
    // Two cars that each see the other ahead (crossing, or pulling out in
    // front of each other): go if the other is already waiting for us, or,
    // both still moving, if we have the lower id. Never drive into a car
    // that has stopped for some other reason (e.g. finishing a reverse).
    if (aheadGap(them, me) !== null) {
      const waitingForUs = other.yieldTo === car.id;
      if (waitingForUs || (car.id < other.id && other.speed > 0.05 && other.yieldTo === null)) {
        continue;
      }
    }
    const l = stopWithin(gap - CAR_FOLLOW_GAP);
    if (l < limit) {
      limit = l;
      yieldTo = other.id;
    }
  }
  car.yieldTo = yieldTo;

  // A car park entry lane in use the other way: wait short of it.
  for (const span of leg.lanes) {
    const lane = traffic.parks[span.park]!.lane;
    if (car.s < span.from - 0.3 && lane.cars.size > 0 && lane.dir !== span.dir) {
      limit = Math.min(limit, stopWithin(span.from - 0.9 - car.s));
    }
  }

  // A drawbridge that's up (or about to be): stop at the barrier, unless
  // it's too late to stop (then we're committed: see `committedTo`).
  for (const span of leg.bridges) {
    const state = traffic.bridges[span.bridge]!;
    if (closedToCars(state) && car.s < span.from - 0.2 && !committedTo(car, span)) {
      limit = Math.min(limit, stopWithin(span.from - 1.2 - car.s));
    }
  }
  return limit;
}

/**
 * True once `car` can no longer stop short of a bridge (`span`): it goes
 * across whatever happens, and the bridge waits for it before lifting.
 */
function committedTo(car: Car, span: { from: number; to: number }): boolean {
  if (car.s > span.to + 0.5) return false;
  if (car.s >= span.from - 0.2) return true; // on it
  // Still short of it: committed only if moving too fast to stop (a car
  // creeping up to the barrier stays stopped behind it).
  // (Margin: a car braking for the barrier stops at `from - 1.2` exactly on
  // its braking curve, and must never tip over into "committed".)
  const stopping = (car.speed * car.speed) / (2 * BRAKE * 0.6);
  return car.speed > 0.3 && car.s + stopping > span.from - 0.4;
}

/**
 * Distance ahead of `me` (along its motion) to the car at `them`, if it's
 * in our way. A car going the same way counts from further to the side, so
 * one merging in from a side road is seen before it's squarely in front.
 */
function aheadGap(me: { pos: Vec2; dir: Vec2 }, them: { pos: Vec2; dir?: Vec2 }): number | null {
  const dx = them.pos.x - me.pos.x;
  const dy = them.pos.y - me.pos.y;
  const along = dx * me.dir.x + dy * me.dir.y;
  const side = Math.abs(dx * me.dir.y - dy * me.dir.x);
  const sameWay = them.dir ? them.dir.x * me.dir.x + them.dir.y * me.dir.y > 0.6 : false;
  const reach = sameWay ? LOOK_SIDE_MERGE : LOOK_SIDE;
  return along > 0 && along < LOOK_AHEAD && side < reach ? along : null;
}

/**
 * A parked car in park `p` may set off: nobody in the entry lane, and no
 * car about to turn in (arrivals go first; leaving can wait).
 */
function laneFreeToLeave(traffic: CarTraffic, p: number): boolean {
  if (traffic.parks[p]!.lane.cars.size > 0) return false;
  return !traffic.cars.some((c) => {
    if (c.parked) return false;
    const leg = c.legs[c.leg]!;
    return leg.lanes.some((l) => l.park === p && l.dir === "in" && c.s > l.from - 10 && c.s < l.to);
  });
}

/** No car driving close to the front of `car`'s bay, so it can back out. */
function aisleClear(
  traffic: CarTraffic,
  car: Car,
  poses: ReadonlyMap<number, { pos: Vec2; dir: Vec2 }>,
): boolean {
  const bay = traffic.parks[car.parked!.park]!.bays[car.parked!.bay]!;
  for (const other of traffic.cars) {
    const pose = poses.get(other.id);
    if (!pose) continue;
    if (Math.hypot(pose.pos.x - bay.front.x, pose.pos.y - bay.front.y) < 2.6) return false;
  }
  return true;
}

/** True for each bridge while a car is on it (or right at its start). */
export function carsOnBridges(traffic: CarTraffic): boolean[] {
  const on = traffic.bridges.map(() => false);
  for (const car of traffic.cars) {
    if (car.parked) continue;
    for (const span of car.legs[car.leg]!.bridges) {
      // On it, or committed to it; a car waiting at the barrier doesn't count.
      if (committedTo(car, span)) on[span.bridge] = true;
    }
  }
  return on;
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

/** Where a car is and which way it faces. */
export function carPose(traffic: CarTraffic, car: Car): CarPose {
  if (car.parked) {
    const bay = traffic.parks[car.parked.park]!.bays[car.parked.bay]!;
    return { pos: bay.pos, heading: bay.heading };
  }
  const leg = car.legs[car.leg]!;
  const { pos, dir } = sample(leg, car.s);
  const heading = Math.atan2(dir.y, dir.x) + (leg.reverse ? Math.PI : 0);
  return { pos, heading };
}

/** Point and direction of motion at distance `s` along a leg. */
function sample(leg: Leg, s: number): { pos: Vec2; dir: Vec2 } {
  const { along, line } = leg;
  const t = Math.max(0, Math.min(leg.length, s));
  let lo = 0;
  let hi = along.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (along[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const a = line[lo]!;
  const b = line[hi]!;
  const seg = along[hi]! - along[lo]! || 1;
  const f = (t - along[lo]!) / seg;
  // Direction from a little either side, so it turns smoothly round corners.
  const ahead = pointAt(leg, t + 0.5);
  const behind = pointAt(leg, t - 0.5);
  const dl = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
  return {
    pos: { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) },
    dir: { x: (ahead.x - behind.x) / dl, y: (ahead.y - behind.y) / dl },
  };
}

function pointAt(leg: Leg, s: number): Vec2 {
  const t = Math.max(0, Math.min(leg.length, s));
  const i = Math.min(leg.line.length - 2, Math.max(0, Math.floor(t / STEP)));
  // Points are evenly spaced (resampled), so the index is direct.
  const a = leg.line[i]!;
  const b = leg.line[i + 1]!;
  const seg = leg.along[i + 1]! - leg.along[i]! || 1;
  const f = Math.max(0, Math.min(1, (t - leg.along[i]!) / seg));
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function polylineLength(line: readonly Vec2[]): number {
  return arcLengths(line).at(-1) ?? 0;
}

/** Drop consecutive points closer than 0.05. */
function dedupe(line: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of line) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.05) out.push(p);
  }
  return out;
}
