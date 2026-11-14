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

export function computeMannKendallAndTheilSen(
  values: number[],
  stepsPerDecade = 120
): TrendAnalysisResult {
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
  const slopePerStep = medianSorted(slopes, pairCount);
  const slopePerDecade = slopePerStep * stepsPerDecade;
  const delta20Yr = slopePerStep * (n - 1);

  const residuals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    residuals[i] = values[i] - slopePerStep * i;
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
    slopePerMonth: slopePerStep,
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

export interface PettittResult {
  index: number;
  year: number;
  month: number;
  dateLabel: string;
  uStatistic: number;
  pValue: number;
  significant: boolean;
  shiftMagnitude: number;
}

// Non-parametric Pettitt test for single regime/change-point detection in time series
export function computePettittChangePoint(points: TimeSeriesPoint[]): PettittResult | null {
  const n = points.length;
  if (n < 12) return null;

  let maxAbsU = -1;
  let bestT = 0;

  // Compute U_t incrementally in O(n^2) cleanly for n <= 400
  for (let t = 1; t < n - 1; t++) {
    let u = 0;
    for (let i = 0; i <= t; i++) {
      const xi = points[i].raw;
      for (let j = t + 1; j < n; j++) {
        const d = xi - points[j].raw;
        if (d > 1e-12) u += 1;
        else if (d < -1e-12) u -= 1;
      }
    }
    const absU = Math.abs(u);
    if (absU > maxAbsU) {
      maxAbsU = absU;
      bestT = t;
    }
  }

  // Approximate two-sided p-value: p ≈ 2 * exp((-6 * K^2) / (n^3 + n^2))
  const n3n2 = n * n * n + n * n;
  const pValue = Math.min(1, Math.max(0, 2 * Math.exp((-6 * maxAbsU * maxAbsU) / n3n2)));

  let preSum = 0;
  for (let i = 0; i <= bestT; i++) preSum += points[i].raw;
  let postSum = 0;
  for (let i = bestT + 1; i < n; i++) postSum += points[i].raw;
  const preMean = preSum / (bestT + 1);
  const postMean = postSum / (n - bestT - 1);

  const pt = points[bestT];
  return {
    index: bestT,
    year: pt.year,
    month: pt.month,
    dateLabel: pt.dateLabel,
    uStatistic: maxAbsU,
    pValue,
    significant: pValue < 0.05,
    shiftMagnitude: postMean - preMean,
  };
}

export interface CrossCorrelationResult {
  r: number;
  rSquared: number;
  pValue: number;
  nOverlap: number;
  lagSteps: number;
  optimalLagSteps: number;
  optimalR: number;
}

function pearsonAtLag(a: number[], b: number[], lag: number): { r: number; n: number } {
  // lag > 0 means Series A leads Series B by `lag` steps (compare A[t] with B[t + lag])
  const pairsA: number[] = [];
  const pairsB: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const j = i + lag;
    if (j >= 0 && j < b.length) {
      pairsA.push(a[i]);
      pairsB.push(b[j]);
    }
  }
  const n = pairsA.length;
  if (n < 4) return { r: 0, n };
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += pairsA[i];
    sumB += pairsB[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = pairsA[i] - meanA;
    const db = pairsB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return { r: denom > 1e-12 ? Math.max(-1, Math.min(1, num / denom)) : 0, n };
}

export function computeCrossCorrelation(
  seriesA: TimeSeriesPoint[],
  seriesB: TimeSeriesPoint[],
  lagSteps = 0,
  maxSearchLag = 6
): CrossCorrelationResult {
  const valsA = seriesA.map((p) => p.raw);
  const valsB = seriesB.map((p) => p.raw);

  const { r, n } = pearsonAtLag(valsA, valsB, lagSteps);
  // Fisher z transformation for significance p-value
  const clampedR = Math.max(-0.999, Math.min(0.999, r));
  const fisherZ =
    n > 4 ? 0.5 * Math.log((1 + clampedR) / (1 - clampedR)) * Math.sqrt(n - 3) : 0;
  const pValue = normalTwoTailedPValue(fisherZ);

  let optimalLagSteps = 0;
  let optimalR = 0;
  for (let l = -maxSearchLag; l <= maxSearchLag; l++) {
    const res = pearsonAtLag(valsA, valsB, l);
    if (Math.abs(res.r) > Math.abs(optimalR)) {
      optimalR = res.r;
      optimalLagSteps = l;
    }
  }

  return {
    r,
    rSquared: r * r,
    pValue,
    nOverlap: n,
    lagSteps,
    optimalLagSteps,
    optimalR,
  };
}

export interface SeasonalTrendStat {
  season: 'DJF' | 'MAM' | 'JJA' | 'SON';
  label: string;
  slopePerDecade: number;
  pValue: number;
  significant: boolean;
}

export function computeSeasonalBreakdown(
  points: TimeSeriesPoint[]
): SeasonalTrendStat[] {
  const defs: { season: 'DJF' | 'MAM' | 'JJA' | 'SON'; label: string; months: number[] }[] = [
    { season: 'DJF', label: 'Winter (DJF)', months: [12, 1, 2] },
    { season: 'MAM', label: 'Spring (MAM)', months: [3, 4, 5] },
    { season: 'JJA', label: 'Summer (JJA)', months: [6, 7, 8] },
    { season: 'SON', label: 'Autumn (SON)', months: [9, 10, 11] },
  ];

  return defs.map((d) => {
    const byYear = new Map<number, number[]>();
    for (const pt of points) {
      if (!d.months.includes(pt.month)) continue;
      // Group Dec with following year for boreal DJF continuity
      const seasonYear = pt.month === 12 ? pt.year + 1 : pt.year;
      const arr = byYear.get(seasonYear) ?? [];
      arr.push(pt.raw);
      byYear.set(seasonYear, arr);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => a - b);
    const vals = years.map((yr) => {
      const arr = byYear.get(yr)!;
      return arr.reduce((s, v) => s + v, 0) / arr.length;
    });
    const res = computeMannKendallAndTheilSen(vals, 10);
    return {
      season: d.season,
      label: d.label,
      slopePerDecade: res.slopePerDecade,
      pValue: res.pValue,
      significant: res.significant,
    };
  });
}

export interface ParsedExternalCsv {
  title: string;
  unit: string;
  points: TimeSeriesPoint[];
  stats: TrendAnalysisResult;
  pettitt: PettittResult | null;
}

export function parseUserCsvTimeSeries(
  csvText: string,
  fileName = 'Uploaded CSV'
): ParsedExternalCsv {
  const rawLines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (rawLines.length < 5) {
    throw new Error('CSV must contain at least 5 data rows (Date, Value).');
  }

  const parsedRows: { year: number; month: number; dateLabel: string; val: number }[] = [];
  let detectedUnit = 'units';

  for (let idx = 0; idx < rawLines.length; idx++) {
    const cols = rawLines[idx].split(/[,;\t]+/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;

    // Skip header row if value column is non-numeric
    const candidateVal = Number(cols[cols.length >= 4 && !Number.isNaN(Number(cols[3])) ? 3 : 1]);
    if (idx === 0 && Number.isNaN(candidateVal)) {
      if (cols[2] && /unit|°|mm|cm|mg|%/i.test(cols[2])) {
        detectedUnit = cols[2];
      }
      continue;
    }

    // Try finding numeric value column (supports Date,Val or Date,Year,Month,Raw_Anomaly export format)
    let val = Number(cols[1]);
    if (Number.isNaN(val) && cols.length >= 4) {
      val = Number(cols[3]);
    }
    if (Number.isNaN(val)) continue;

    // Parse date from cols[0] (YYYY-MM, YYYY-MM-DD, YYYY/MM, or YYYY)
    const dateStr = cols[0];
    let year = 2005 + Math.floor(parsedRows.length / 12);
    let month = (parsedRows.length % 12) + 1;

    const ymMatch = dateStr.match(/^(\d{4})[-/](\d{1,2})/);
    const yOnlyMatch = dateStr.match(/^(\d{4})$/);
    if (ymMatch) {
      year = Number(ymMatch[1]);
      month = Math.max(1, Math.min(12, Number(ymMatch[2])));
    } else if (yOnlyMatch) {
      year = Number(yOnlyMatch[1]);
      month = 1;
    }

    parsedRows.push({
      year,
      month,
      dateLabel: `${year}-${String(month).padStart(2, '0')}`,
      val,
    });
  }

  if (parsedRows.length < 5) {
    throw new Error(
      'Could not parse at least 5 numeric rows. Expected columns like "YYYY-MM, value".'
    );
  }

  // Estimate steps per decade based on distinct years vs row count
  const spanYears = Math.max(
    1,
    parsedRows[parsedRows.length - 1].year - parsedRows[0].year
  );
  const stepsPerYear = parsedRows.length / spanYears;
  const stepsPerDecade = Math.max(10, Math.round(stepsPerYear * 10));

  const rawValues = parsedRows.map((r) => r.val);
  const stats = computeMannKendallAndTheilSen(rawValues, stepsPerDecade);
  const loessValues = computeLoess(rawValues, 0.16);

  const points: TimeSeriesPoint[] = parsedRows.map((r, i) => ({
    index: i,
    year: r.year,
    month: r.month,
    dateLabel: r.dateLabel,
    raw: r.val,
    loess: loessValues[i],
    theilSen: stats.intercept + stats.slopePerMonth * i,
  }));

  const pettitt = computePettittChangePoint(points);
  return {
    title: fileName.replace(/\.(csv|txt)$/i, ''),
    unit: detectedUnit,
    points,
    stats,
    pettitt,
  };
}

