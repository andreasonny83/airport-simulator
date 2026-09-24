/**
 * Ground route geometry: turning a few control points into a smooth,
 * densely sampled centreline a plane can follow on the ground.
 *
 * Two building blocks:
 * - `filletPath`: straight legs between control points, with every corner
 *   rounded into a circular arc (like a real taxiway fillet). Heading is
 *   continuous along the result, so a plane following it never snaps round.
 * - `mergeCurve`: a cubic Hermite curve from wherever the plane touched down,
 *   pointing wherever it was pointing, onto the runway centreline, pointing
 *   exactly down the runway.
 *
 * Routes are plain data (`GroundRoute`) and can be extended in place with
 * `appendToRoute`, so a moving plane can be given more route without
 * stopping or re-planning the part it's already on.
 */
import { angleDelta, distance, lerp, normalizeAngle } from "./math";
import type { GroundRoute, Vec2 } from "./types";

/** Max angle (radians) swept between two samples on an arc. */
const ARC_STEP = 0.12;

/** Samples along a touchdown merge curve. */
const MERGE_SAMPLES = 16;

/** Below this turn (radians) a corner is treated as straight. */
const MIN_CORNER = 1e-3;

/** A sampled point with its direction of travel. */
interface Sample {
  p: Vec2;
  heading: number;
}

/** Empty route starting at `p`, pointing along `heading`. */
export function createRoute(p: Vec2, heading: number): GroundRoute {
  return { points: [{ ...p }], headings: [heading], dist: [0] };
}

/** Total length of a route. */
export function routeLength(route: GroundRoute): number {
  return route.dist[route.dist.length - 1] ?? 0;
}

/** Last point of a route. */
export function routeEnd(route: GroundRoute): Vec2 {
  return route.points[route.points.length - 1]!;
}

/** Add samples to the end of `route`, extending its cumulative distances. */
function pushSamples(route: GroundRoute, samples: readonly Sample[]): void {
  for (const { p, heading } of samples) {
    const last = routeEnd(route);
    const d = distance(last, p);
    if (d < 1e-6) continue; // duplicate (e.g. arc end == next arc start)
    route.points.push({ ...p });
    route.headings.push(normalizeAngle(heading));
    route.dist.push(routeLength(route) + d);
  }
}

/**
 * Extend `route` through `controls` (the route's current end is the first
 * corner), rounding each corner with `radius`, or `radii[i]` for the corner
 * at `controls[i]` when given.
 */
export function appendToRoute(
  route: GroundRoute,
  controls: readonly Vec2[],
  radius: number,
  radii: readonly (number | undefined)[] = [],
): void {
  const start = routeEnd(route);
  // Seed the corner at the route's end with the direction it's heading. The
  // plane may already be sitting there, so that join can't be rounded:
  // callers extend routes straight ahead (hold point → stand, stand → hangar).
  const behind = route.headings[route.headings.length - 1]!;
  const prev = { x: start.x - Math.cos(behind), y: start.y - Math.sin(behind) };
  const samples = filletPath(
    [prev, start, ...controls],
    radius,
    [undefined, undefined, ...radii],
    true,
  );
  pushSamples(route, samples);
}

/**
 * Sample the polyline `points` with every interior corner rounded into an
 * arc of (at most) `radius`, or `radii[i]` for the corner at `points[i]`.
 *
 * An arc's tangent points sit `t = r · tan(θ/2)` either side of the corner
 * (θ = turn angle). Where legs are too short for that, `t` shrinks to fit
 * (half a leg, or the whole leg next to either end of the path), and the
 * radius shrinks with it: the turn gets tighter, never cut.
 *
 * @param seeded  `points[0]` only gives the incoming direction at
 *   `points[1]` (the end of an existing route): it isn't output, and the
 *   corner at `points[1]` can't be rounded, since the plane is already
 *   there. Callers keep that join straight.
 */
export function filletPath(
  points: readonly Vec2[],
  radius: number,
  radii: readonly (number | undefined)[] = [],
  seeded = false,
): Sample[] {
  const n = points.length;
  const out: Sample[] = [];
  if (n < 2) return out;
  const legHeading = (i: number) =>
    Math.atan2(points[i + 1]!.y - points[i]!.y, points[i + 1]!.x - points[i]!.x);
  const legLength = (i: number) => distance(points[i]!, points[i + 1]!);
  const lastLeg = n - 2;

  if (!seeded) out.push({ p: { ...points[0]! }, heading: legHeading(0) });
  /** Room on leg `leg` for the corner at its end. */
  const roomIn = (leg: number) => {
    if (leg === 0) return seeded ? 0 : legLength(0); // nothing before the start
    if (leg === 1 && seeded) return legLength(1); // the seed corner took none of it
    return legLength(leg) / 2; // shared with the corner at its start
  };

  for (let i = 1; i < n - 1; i++) {
    const hIn = legHeading(i - 1);
    const hOut = legHeading(i);
    const turn = angleDelta(hIn, hOut);
    const corner = points[i]!;
    if (Math.abs(turn) < MIN_CORNER) {
      out.push({ p: { ...corner }, heading: hOut });
      continue;
    }
    // Room on each leg: a leg shared by two corners gives each half of it.
    const outRoom = i === lastLeg ? legLength(i) : legLength(i) / 2;
    const half = Math.abs(turn) / 2;
    const r0 = radii[i] ?? radius;
    const t = Math.min(r0 * Math.tan(half), roomIn(i - 1), outRoom);
    if (t <= 1e-6) {
      // No room to round it (the seed corner): turn on the spot.
      out.push({ p: { ...corner }, heading: hOut });
      continue;
    }
    const r = t / Math.tan(half);

    // Arc from the tangent point on the way in to the one on the way out.
    // The centre sits `r` to the inside of the turn (left for turn < 0).
    const side = Math.sign(turn);
    const a = { x: corner.x - Math.cos(hIn) * t, y: corner.y - Math.sin(hIn) * t };
    const cx = a.x - Math.sin(hIn) * r * side;
    const cy = a.y + Math.cos(hIn) * r * side;
    const steps = Math.max(2, Math.ceil(Math.abs(turn) / ARC_STEP));
    for (let k = 0; k <= steps; k++) {
      const heading = hIn + (turn * k) / steps;
      // Position on the circle: from the centre, back out to the side.
      out.push({
        p: {
          x: cx + Math.sin(heading) * r * side,
          y: cy - Math.cos(heading) * r * side,
        },
        heading,
      });
    }
  }
  out.push({ p: { ...points[n - 1]! }, heading: legHeading(n - 2) });
  return out;
}

/**
 * Cubic Hermite curve from `from` (heading `h0`) to `to` (heading `h1`):
 * leaves along the plane's own heading and arrives exactly along the
 * runway, however far off-centre it touched down.
 */
export function mergeCurve(from: Vec2, h0: number, to: Vec2, h1: number): Sample[] {
  // Tangent length = chord length gives a gentle, loop-free S-bend.
  const chord = distance(from, to);
  const m0 = { x: Math.cos(h0) * chord, y: Math.sin(h0) * chord };
  const m1 = { x: Math.cos(h1) * chord, y: Math.sin(h1) * chord };
  const out: Sample[] = [];
  for (let i = 0; i <= MERGE_SAMPLES; i++) {
    const t = i / MERGE_SAMPLES;
    const t2 = t * t;
    const t3 = t2 * t;
    // Hermite basis functions and their derivatives.
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const d00 = 6 * t2 - 6 * t;
    const d10 = 3 * t2 - 4 * t + 1;
    const d01 = -6 * t2 + 6 * t;
    const d11 = 3 * t2 - 2 * t;
    const x = h00 * from.x + h10 * m0.x + h01 * to.x + h11 * m1.x;
    const y = h00 * from.y + h10 * m0.y + h01 * to.y + h11 * m1.y;
    const dx = d00 * from.x + d10 * m0.x + d01 * to.x + d11 * m1.x;
    const dy = d00 * from.y + d10 * m0.y + d01 * to.y + d11 * m1.y;
    out.push({ p: { x, y }, heading: Math.atan2(dy, dx) });
  }
  // Pin the ends to the exact headings (the derivative is exact anyway, but
  // this guards against a degenerate zero-length chord).
  out[0]!.heading = h0;
  out[out.length - 1]!.heading = h1;
  return out;
}

/** Route from `samples` (the first sample is the route's start). */
export function routeFromSamples(samples: readonly Sample[]): GroundRoute {
  const first = samples[0]!;
  const route = createRoute(first.p, first.heading);
  pushSamples(route, samples.slice(1));
  return route;
}

/** Append pre-built samples (e.g. from `filletPath`) to a route. */
export function appendSamples(route: GroundRoute, samples: readonly Sample[]): void {
  pushSamples(route, samples);
}

/**
 * Position and heading at distance `s` along the route (clamped to its
 * ends). Headings are blended the short way round between samples.
 */
export function sampleRoute(route: GroundRoute, s: number, out: Vec2): number {
  const { points, headings, dist } = route;
  const last = points.length - 1;
  if (s <= 0 || last === 0) {
    out.x = points[0]!.x;
    out.y = points[0]!.y;
    return headings[0]!;
  }
  if (s >= dist[last]!) {
    out.x = points[last]!.x;
    out.y = points[last]!.y;
    return headings[last]!;
  }
  // Binary search for the segment containing `s`.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const f = (s - dist[lo]!) / (dist[hi]! - dist[lo]!);
  out.x = lerp(points[lo]!.x, points[hi]!.x, f);
  out.y = lerp(points[lo]!.y, points[hi]!.y, f);
  return normalizeAngle(headings[lo]! + angleDelta(headings[lo]!, headings[hi]!) * f);
}
