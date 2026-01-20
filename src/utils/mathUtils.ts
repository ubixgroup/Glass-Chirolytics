import { Point, Circle } from '@/types/types';

// ──────────────────────────────────────────────────────────────────
//  1) helper: Euclidean distance
// ──────────────────────────────────────────────────────────────────
export function distance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * converts MediaPipe landmark coordinates (0-1 range) to canvas pixel coordinates
 * @param landmark MediaPipe landmark with normalized coordinates (0-1)
 * @param canvasWidth Width of the target canvas
 * @param canvasHeight Height of the target canvas
 * @returns Point with pixel coordinates
 */
export function getLandmarkPosition(
  landmark: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number
): Point {
  return {
    x: landmark.x * canvasWidth,
    y: landmark.y * canvasHeight,
  };
}

// ──────────────────────────────────────────────────────────────────
//  2) the Welzl-based minimum enclosing circle algorithm
// ──────────────────────────────────────────────────────────────────

/**
 * returns the smallest circle that encloses all given points
 * this is a TypeScript adaptation of Welzl's algorithm
 */
export function minEnclosingCircle(points: Point[]): Circle {
  if (!points || points.length === 0) {
    return { center: { x: 0, y: 0 }, radius: 0 };
  }
  // shuffle to avoid worst-case scenarios
  const shuffled = [...points];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return mecWelzl(shuffled, [], shuffled.length);
}

/**
 * welzl's recursive function. `R` is the set of boundary points on which
 * the minimal enclosing circle depends. We recurse until we've placed all
 * points or we have three boundary points.
 */
function mecWelzl(points: Point[], boundary: Point[], n: number): Circle {
  // base cases
  if (n === 0 || boundary.length === 3) {
    return circleFromBoundary(boundary);
  }

  // take a random point p
  const p = points[n - 1];
  // get the MEC of the other points
  const circle = mecWelzl(points, boundary, n - 1);

  // if p is inside this circle, it's still our MEC
  if (distance(p, circle.center) <= circle.radius) {
    return circle;
  }

  // otherwise, p must lie on the boundary of the new MEC
  return mecWelzl(points, [...boundary, p], n - 1);
}

/**
 * compute the minimal circle from 0, 1, 2, or 3 boundary points
 */
function circleFromBoundary(boundary: Point[]): Circle {
  switch (boundary.length) {
    case 0:
      return { center: { x: 0, y: 0 }, radius: 0 };
    case 1:
      return { center: boundary[0], radius: 0 };
    case 2:
      return circleFrom2Points(boundary[0], boundary[1]);
    default:
      return circleFrom3Points(boundary[0], boundary[1], boundary[2]);
  }
}

function circleFrom2Points(a: Point, b: Point): Circle {
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const r = distance(a, center);
  return { center, radius: r };
}

function circleFrom3Points(a: Point, b: Point, c: Point): Circle {
  // circumcircle
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (d === 0) {
    // points are collinear – fallback to smaller circle from pairs
    return circleFrom2Points(a, b);
  }
  const aSq = a.x * a.x + a.y * a.y;
  const bSq = b.x * b.x + b.y * b.y;
  const cSq = c.x * c.x + c.y * c.y;
  const cx = (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d;
  const cy = (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d;
  const center = { x: cx, y: cy };
  const r = distance(a, center);
  return { center, radius: r };
}
