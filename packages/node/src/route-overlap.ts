/**
 * The geometry two routes share: whether one is strictly more specific than the
 * other, and the concrete path both would match when neither is. D90 R19(c)'s
 * rule that a route's *shape* has one definition lives in `route-shape.ts`;
 * this is the finer question the overlap referee asks once two shapes differ,
 * and it is pure — it reads paths and answers, and knows nothing about the
 * analyzer that asks.
 */

const routeDecimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;

type RouteSegment = {readonly literal: string} | {readonly capture: string; readonly captureType: string};

export function routeSegments(path: string): readonly RouteSegment[] {
  return path.split("/").map((segment) => {
    const match = /^\{([A-Za-z_][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*)\}$/u.exec(segment);
    return match ? {capture: match[1]!, captureType: match[2]!} : {literal: segment};
  });
}

function routeCaptureAdmits(captureType: string, literal: string): boolean {
  if (captureType === "number") return routeDecimalPattern.test(literal) && Number.isFinite(Number(literal));
  if (captureType === "bool") return literal === "true" || literal === "false";
  return true;
}

function routeSharedSegment(left: RouteSegment, right: RouteSegment): string | null {
  if ("literal" in left) {
    if ("literal" in right) return left.literal === right.literal ? left.literal : null;
    return routeCaptureAdmits(right.captureType, left.literal) ? left.literal : null;
  }
  if ("literal" in right) return routeCaptureAdmits(left.captureType, right.literal) ? right.literal : null;
  const types = new Set([left.captureType, right.captureType]);
  if (types.has("number") && types.has("bool")) return null;
  if (types.has("number")) return "1";
  if (types.has("bool")) return "true";
  return left.capture;
}

export function routeSharedPath(left: readonly RouteSegment[], right: readonly RouteSegment[]): string | null {
  if (left.length !== right.length) return null;
  const shared: string[] = [];
  for (let index = 0; index < left.length; index += 1) {
    const segment = routeSharedSegment(left[index]!, right[index]!);
    if (segment === null) return null;
    shared.push(segment);
  }
  return shared.join("/");
}

function routeLiteralPositions(segments: readonly RouteSegment[]): ReadonlySet<number> {
  const positions = new Set<number>();
  for (let index = 0; index < segments.length; index += 1) if ("literal" in segments[index]!) positions.add(index);
  return positions;
}

export function routeSpecificityDecides(left: readonly RouteSegment[], right: readonly RouteSegment[]): boolean {
  const leftLiterals = routeLiteralPositions(left);
  const rightLiterals = routeLiteralPositions(right);
  if (leftLiterals.size === rightLiterals.size) return false;
  const [subset, superset] = leftLiterals.size < rightLiterals.size ? [leftLiterals, rightLiterals] : [rightLiterals, leftLiterals];
  for (const position of subset) if (!superset.has(position)) return false;
  return true;
}
