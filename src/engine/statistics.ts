export type ConfidenceTier = 1 | 2 | 3 | 4;

export interface TrendAnalysisResult {
  n: number;
  sStatistic: number;
  zScore: number;
  pValue: number;
  significant: boolean;
  confidenceTier: ConfidenceTier;
  confidenceLabel: string;
  slopePerMonth: number;
  slopePerDecade: number;
  intercept: number;
  delta20Yr: number;
}

export interface TimeSeriesPoint {
  index: number;
  year: number;
  month: number; // 1..12
  dateLabel: string; // YYYY-MM
  raw: number;
  loess: number;
  theilSen: number;
}

// High-precision normal CDF via Abramowitz & Stegun 7.1.26 erf approximation
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalTwoTailedPValue(z: number): number {
  const absZ = Math.abs(z);
  const cdf = 0.5 * (1.0 + erf(absZ / Math.SQRT2));
  const p = 2.0 * (1.0 - cdf);
  return Math.max(0, Math.min(1, p));
}

export function formatPValue(p: number): string {
  if (p < 0.0001) return '< 0.0001';
  if (p < 0.001) return p.toFixed(4);
  if (p < 0.01) return p.toFixed(4);
  return p.toFixed(3);
}

export function getConfidenceInfo(p: number): {
  tier: ConfidenceTier;
  label: string;
  significant: boolean;
} {
  if (p < 0.001) {
    return { tier: 4, label: 'Very High Confidence (99.9%)', significant: true };
  }
  if (p < 0.01) {
    return { tier: 3, label: 'High Confidence (99%)', significant: true };
  }
  if (p < 0.05) {
    return { tier: 2, label: 'Moderate Confidence (95%)', significant: true };
  }
  return { tier: 1, label: 'Not Significant (Noise, p >= 0.05)', significant: false };
}

function medianSorted(arr: Float64Array, len: number): number {
  if (len === 0) return 0;
  const mid = len >> 1;
  if (len % 2 === 1) return arr[mid];
  return 0.5 * (arr[mid - 1] + arr[mid]);
}

export function computeMannKendallAndTheilSen(values: number[]): TrendAnalysisResult {
  const n = values.length;
  if (n < 4) {
    return {
      n,
      sStatistic: 0,
      zScore: 0,
      pValue: 1,
      significant: false,
      confidenceTier: 1,
      confidenceLabel: 'Insufficient Samples',
      slopePerMonth: 0,
      slopePerDecade: 0,
      intercept: values[0] ?? 0,
      delta20Yr: 0,
    };
  }

  let s = 0;
  const pairCount = (n * (n - 1)) >> 1;
  const slopes = new Float64Array(pairCount);
  let k = 0;

  for (let i = 0; i < n - 1; i++) {
    const yi = values[i];
    for (let j = i + 1; j < n; j++) {
      const diff = values[j] - yi;
      if (diff > 1e-12) s += 1;
      else if (diff < -1e-12) s -= 1;
      slopes[k++] = diff / (j - i);
    }
  }

  // Tie correction for Mann-Kendall variance
  const sortedVals = Float64Array.from(values).sort();
  let tieAdjustment = 0;
  let run = 1;
  for (let i = 1; i < n; i++) {
    if (Math.abs(sortedVals[i] - sortedVals[i - 1]) < 1e-12) {
      run++;
    } else {
      if (run > 1) {
        tieAdjustment += run * (run - 1) * (2 * run + 5);
      }
      run = 1;
    }
  }
  if (run > 1) {
    tieAdjustment += run * (run - 1) * (2 * run + 5);
  }

  const varS = (n * (n - 1) * (2 * n + 5) - tieAdjustment) / 18;
  let z = 0;
  if (varS > 0) {
    if (s > 0) z = (s - 1) / Math.sqrt(varS);
    else if (s < 0) z = (s + 1) / Math.sqrt(varS);
  }

  const pValue = normalTwoTailedPValue(z);
  const conf = getConfidenceInfo(pValue);

  slopes.sort();
  const slopePerMonth = medianSorted(slopes, pairCount);
  const slopePerDecade = slopePerMonth * 120; // 12 months * 10 years
  const delta20Yr = slopePerMonth * (n - 1);

  const residuals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    residuals[i] = values[i] - slopePerMonth * i;
  }
  residuals.sort();
  const intercept = medianSorted(residuals, n);

  return {
    n,
    sStatistic: s,
    zScore: z,
    pValue,
    significant: conf.significant,
    confidenceTier: conf.tier,
    confidenceLabel: conf.label,
    slopePerMonth,
    slopePerDecade,
    intercept,
    delta20Yr,
  };
}

// Fast annual Mann-Kendall p-value for 20-year grid cells (N = 20)
const VAR_S_20 = (20 * 19 * (40 + 5)) / 18; // 950
const SQRT_VAR_S_20 = Math.sqrt(VAR_S_20);

export function fastAnnualMannKendallPValue(annualValues: Float64Array): number {
  const n = annualValues.length;
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    const yi = annualValues[i];
    for (let j = i + 1; j < n; j++) {
      const d = annualValues[j] - yi;
      if (d > 1e-9) s += 1;
      else if (d < -1e-9) s -= 1;
    }
  }
  let z = 0;
  if (s > 0) z = (s - 1) / SQRT_VAR_S_20;
  else if (s < 0) z = (s + 1) / SQRT_VAR_S_20;
  return normalTwoTailedPValue(z);
}

// LOESS local weighted linear regression with tricube kernel
export function computeLoess(values: number[], span = 0.14): number[] {
  const n = values.length;
  if (n < 5) return [...values];
  const halfWindow = Math.max(4, Math.round((n * span) / 2));
  const smoothed = new Array<number>(n);

  for (let x = 0; x < n; x++) {
    const left = Math.max(0, x - halfWindow);
    const right = Math.min(n - 1, x + halfWindow);
    const maxDist = Math.max(Math.abs(x - left), Math.abs(right - x), 1);

    let sumW = 0;
    let sumWX = 0;
    let sumWY = 0;
    let sumWXX = 0;
    let sumWXY = 0;

    for (let i = left; i <= right; i++) {
      const u = Math.min(1, Math.abs(i - x) / maxDist);
      const t = 1 - u * u * u;
      const w = t * t * t;
      const y = values[i];
      sumW += w;
      sumWX += w * i;
      sumWY += w * y;
      sumWXX += w * i * i;
      sumWXY += w * i * y;
    }

    const denom = sumW * sumWXX - sumWX * sumWX;
    if (Math.abs(denom) < 1e-12) {
      smoothed[x] = sumWY / (sumW || 1);
    } else {
      const b1 = (sumW * sumWXY - sumWX * sumWY) / denom;
      const b0 = (sumWY - b1 * sumWX) / sumW;
      smoothed[x] = b0 + b1 * x;
    }
  }

  return smoothed;
}

// Great-circle geodesic points (returns [lon, lat][] in degrees)
export function computeGeodesicPoints(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  steps = 72
): [number, number][] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const p1 = lat1 * toRad;
  const l1 = lon1 * toRad;
  const p2 = lat2 * toRad;
  const l2 = lon2 * toRad;

  const x1 = Math.cos(p1) * Math.cos(l1);
  const y1 = Math.cos(p1) * Math.sin(l1);
  const z1 = Math.sin(p1);

  const x2 = Math.cos(p2) * Math.cos(l2);
  const y2 = Math.cos(p2) * Math.sin(l2);
  const z2 = Math.sin(p2);

  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    let x: number, y: number, z: number;
    if (sinOmega < 1e-6) {
      x = x1 * (1 - f) + x2 * f;
      y = y1 * (1 - f) + y2 * f;
      z = z1 * (1 - f) + z2 * f;
    } else {
      const a = Math.sin((1 - f) * omega) / sinOmega;
      const b = Math.sin(f * omega) / sinOmega;
      x = a * x1 + b * x2;
      y = a * y1 + b * y2;
      z = a * z1 + b * z2;
    }
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg;
    const lon = Math.atan2(y, x) * toDeg;
    pts.push([lon, lat]);
  }
  return pts;
}

// Calibrated diverging Blue -> White -> Red scientific palette
// t in [-1, 1]
const DIVERGING_STOPS: [number, number, number][] = [
  [23, 55, 130],   // -1.00 deep NASA cobalt blue
  [37, 99, 235],   // -0.66 royal blue
  [96, 165, 250],  // -0.33 sky blue
  [248, 250, 252], //  0.00 neutral near-white
  [251, 191, 36],  // +0.33 warm amber
  [239, 68, 68],   // +0.66 crimson red
  [153, 27, 27],   // +1.00 deep maroon
];

export function valueToDivergingRGB(normalized: number): [number, number, number] {
  const clamped = Math.max(-1, Math.min(1, normalized));
  const scaled = ((clamped + 1) * 0.5) * (DIVERGING_STOPS.length - 1);
  const idx = Math.min(DIVERGING_STOPS.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = DIVERGING_STOPS[idx];
  const c1 = DIVERGING_STOPS[idx + 1];
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}
