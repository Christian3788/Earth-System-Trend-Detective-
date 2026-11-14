import {
  BoundingBoxROI,
  DATASETS,
  DataMode,
  DatasetId,
  DatasetSpec,
  TELECONNECTIONS,
  TeleconnectionId,
  getEffectiveBounds,
  getEffectivePoles,
} from '../data/datasets';
import { getLandMaskBuffer, isLand } from '../data/worldCoastlines';
import {
  TimeSeriesPoint,
  TrendAnalysisResult,
  computeLoess,
  computeMannKendallAndTheilSen,
  fastAnnualMannKendallPValue,
} from './statistics';

const DEG2RAD = Math.PI / 180;

function gaussianLobe(
  lat: number,
  lon: number,
  cLat: number,
  cLon: number,
  sigmaDeg: number,
  lonStretch = 1.0
): number {
  const dLat = lat - cLat;
  let dLon = lon - cLon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const sLat = sigmaDeg;
  const sLon = sigmaDeg * lonStretch;
  return Math.exp(-0.5 * ((dLat * dLat) / (sLat * sLat) + (dLon * dLon) / (sLon * sLon)));
}

// Continuous radiative forcing progress curve:
// 2005..2024 -> 0..1 (Historical)
// 2025..2099 -> 1..1.78 (RCP 4.5 stabilization) or 1..2.95 (RCP 8.5 high-emissions acceleration)
function getNormalizedProgress(year: number, month: number, dataMode: DataMode): number {
  const t = year + (month - 0.5) / 12;
  if (year <= 2024 || dataMode === 'historical') {
    return (t - 2005) / 19;
  }
  const pFrac = Math.max(0, (t - 2024) / 75);
  if (dataMode === 'rcp45') {
    return 1.0 + 0.78 * (1 - Math.exp(-pFrac * 2.7));
  }
  return 1.0 + 1.95 * Math.pow(pFrac, 1.15);
}

function getDriverTemporalIndex(
  teleconnection: TeleconnectionId,
  year: number,
  month: number,
  dataMode: DataMode
): number {
  const t = year + (month - 0.5) / 12;
  const normT = getNormalizedProgress(year, month, dataMode);
  const season = Math.cos((month - 10) * (Math.PI / 6));

  const projBoost =
    year <= 2024 || dataMode === 'historical'
      ? 1.0
      : dataMode === 'rcp45'
      ? 1.0 + 0.28 * (1 - Math.exp(-((t - 2024) / 75) * 2.5))
      : 1.0 + 0.85 * Math.pow(Math.max(0, (t - 2024) / 75), 1.1);

  if (teleconnection === 'iod') {
    const spike2019 = 1.15 * Math.exp(-Math.pow((t - 2019.75) / 0.55, 2));
    const spike2023 = 0.75 * Math.exp(-Math.pow((t - 2023.75) / 0.6, 2));
    const dip2016 = -0.55 * Math.exp(-Math.pow((t - 2016.6) / 0.45, 2));
    const decadalCycle = year > 2024 ? 0.34 * Math.sin((t - 2024) * 0.95) * projBoost : 0;
    const trend = 0.72 * normT - 0.2;
    return trend + spike2019 + spike2023 + dip2016 + decadalCycle + 0.18 * season + 0.14 * Math.sin(t * 2.1);
  }

  if (teleconnection === 'enso') {
    const elNino2015 = 1.2 * Math.exp(-Math.pow((t - 2015.9) / 0.65, 2));
    const elNino2023 = 1.05 * Math.exp(-Math.pow((t - 2023.85) / 0.6, 2));
    const laNina2011 = -0.75 * Math.exp(-Math.pow((t - 2011.1) / 0.65, 2));
    const laNina2021 = -0.55 * Math.exp(-Math.pow((t - 2021.8) / 0.85, 2));
    const futureEnso = year > 2024 ? 0.44 * Math.sin((t - 2024) * 1.35) * projBoost : 0;
    const trend = 0.55 * normT - 0.15;
    return trend + elNino2015 + elNino2023 + laNina2011 + laNina2021 + futureEnso + 0.12 * season;
  }

  if (teleconnection === 'arctic') {
    const dip2012 = 0.45 * Math.exp(-Math.pow((t - 2012.7) / 0.6, 2));
    const heat2020 = 0.65 * Math.exp(-Math.pow((t - 2020.4) / 0.7, 2));
    const trend = 1.05 * normT - 0.32;
    return trend + dip2012 + heat2020 + 0.22 * Math.cos((month - 1) * (Math.PI / 6)) + 0.1 * Math.sin(t * 1.7);
  }

  const elNinoBoost =
    0.24 * Math.exp(-Math.pow((t - 2016.1) / 0.6, 2)) +
    0.35 * Math.exp(-Math.pow((t - 2023.9) / 0.65, 2));
  return 0.92 * normT - 0.3 + elNinoBoost + 0.08 * Math.sin(t * 1.5);
}

function synopticNoise(lat: number, lon: number, year: number, month: number): number {
  const t = (year - 2005) * 12 + month;
  const rLat = lat * DEG2RAD;
  const rLon = lon * DEG2RAD;
  return (
    0.45 * Math.sin(rLon * 3.1 + rLat * 2.4 + t * 0.47) +
    0.35 * Math.cos(rLon * 5.3 - rLat * 3.7 + t * 0.73) +
    0.2 * Math.sin(rLon * 7.9 + rLat * 6.1 - t * 1.13)
  );
}

export function sampleAnomalyAt(
  dataset: DatasetSpec,
  teleconnectionId: TeleconnectionId,
  lat: number,
  lon: number,
  year: number,
  month: number,
  landFlag?: boolean,
  dataMode: DataMode = 'historical'
): number {
  const onLand = landFlag !== undefined ? landFlag : isLand(lat, lon);
  if (dataset.domain === 'land' && !onLand) return NaN;
  if (dataset.domain === 'ocean' && onLand) return NaN;

  const effectiveMode: DataMode = year <= 2024 ? 'historical' : dataMode;
  const normT = getNormalizedProgress(year, month, effectiveMode);
  const tele = TELECONNECTIONS[teleconnectionId];
  const driver = getDriverTemporalIndex(teleconnectionId, year, month, effectiveMode);
  const noise = synopticNoise(lat, lon, year, month);

  let rawSignal = 0;

  if (tele.poleA && tele.poleB) {
    const spreadA = teleconnectionId === 'enso' ? 11 : teleconnectionId === 'iod' ? 13 : 14;
    const stretchA = teleconnectionId === 'enso' ? 2.6 : teleconnectionId === 'iod' ? 1.5 : 1.8;
    const spreadB = teleconnectionId === 'enso' ? 13 : teleconnectionId === 'iod' ? 14 : 13;
    const stretchB = teleconnectionId === 'enso' ? 1.9 : teleconnectionId === 'iod' ? 1.5 : 1.4;

    const lobeA = gaussianLobe(lat, lon, tele.poleA.lat, tele.poleA.lon, spreadA, stretchA);
    const lobeB = gaussianLobe(lat, lon, tele.poleB.lat, tele.poleB.lon, spreadB, stretchB);

    let landSpillover = 0;
    if (dataset.domain === 'land') {
      if (teleconnectionId === 'iod') {
        landSpillover =
          0.95 * gaussianLobe(lat, lon, 2, 38, 13, 1.2) -
          0.95 * gaussianLobe(lat, lon, -24, 134, 14, 1.3) -
          0.7 * gaussianLobe(lat, lon, -2, 114, 10, 1.4);
      } else if (teleconnectionId === 'enso') {
        landSpillover =
          0.85 * gaussianLobe(lat, lon, -3, -78, 10, 1.1) +
          0.6 * gaussianLobe(lat, lon, 33, -102, 12, 1.3) -
          0.95 * gaussianLobe(lat, lon, -5, -60, 14, 1.3) -
          0.85 * gaussianLobe(lat, lon, -15, 132, 14, 1.4);
      } else if (teleconnectionId === 'arctic') {
        landSpillover =
          0.95 * gaussianLobe(lat, lon, 67, 82, 14, 2.2) +
          0.7 * gaussianLobe(lat, lon, 66, -110, 14, 2.0) -
          0.55 * gaussianLobe(lat, lon, 52, -4, 11, 1.3);
      }
    }

    rawSignal += driver * (1.25 * lobeA - 1.15 * lobeB + landSpillover);
  }

  if (dataset.id === 'merra2_t2m') {
    const arcticAmp = Math.max(0, (lat - 52) / 38);
    const landBoost = onLand ? 1.28 : 0.82;
    const globalWarm = (normT - 0.35) * (0.95 + 1.35 * arcticAmp * arcticAmp) * landBoost;
    const coldBlob = -0.7 * normT * gaussianLobe(lat, lon, 54, -36, 10, 1.3);
    rawSignal += globalWarm + coldBlob + 0.38 * noise;
    return clampScale(rawSignal * 1.15, dataset, effectiveMode);
  }

  if (dataset.id === 'gpm_precip') {
    const itczShift =
      0.55 * Math.sin(lat * 4 * DEG2RAD) * Math.exp(-(lat * lat) / 500) * (normT - 0.3);
    const drySubtropics =
      -0.45 * (gaussianLobe(lat, lon, 28, 5, 12, 2.2) + gaussianLobe(lat, lon, -26, 22, 10, 1.5)) * normT;
    const wetMonsoon = 0.55 * gaussianLobe(lat, lon, 16, 80, 12, 1.4) * (normT - 0.2);
    rawSignal += itczShift + drySubtropics + wetMonsoon + 0.55 * noise;
    return clampScale(rawSignal * 1.45, dataset, effectiveMode);
  }

  if (dataset.id === 'smap_soil') {
    const swUsDry = -0.75 * normT * gaussianLobe(lat, lon, 36, -110, 10, 1.4);
    const medDry = -0.65 * normT * gaussianLobe(lat, lon, 39, 10, 11, 1.9);
    const sahelWet = 0.55 * normT * gaussianLobe(lat, lon, 12, 18, 9, 2.2);
    rawSignal += swUsDry + medDry + sahelWet + 0.32 * noise;
    return clampScale(rawSignal * 0.068, dataset, effectiveMode);
  }

  if (dataset.id === 'swot_water') {
    const seaLevelRise = !onLand ? (normT - 0.35) * 0.65 * Math.cos(lat * 0.6 * DEG2RAD) : 0;
    const nileLakeSurplus = onLand ? 0.9 * normT * gaussianLobe(lat, lon, 1, 33, 10, 1.3) : 0;
    const aralColoradoDrawdown = onLand
      ? -0.95 * normT * (gaussianLobe(lat, lon, 44, 60, 8, 1.3) + gaussianLobe(lat, lon, 36, -113, 8, 1.3))
      : 0;
    rawSignal = rawSignal * 0.75 + seaLevelRise + nileLakeSurplus + aralColoradoDrawdown + 0.24 * noise;
    return clampScale(rawSignal * 12.5, dataset, effectiveMode);
  }

  if (dataset.id === 'seawifs_chl') {
    const somaliUpwell = 0.95 * normT * gaussianLobe(lat, lon, 10, 56, 10, 1.4);
    const amazonPlume = 0.75 * normT * gaussianLobe(lat, lon, 2, -48, 8, 1.2);
    const gangesPlume = 0.65 * normT * gaussianLobe(lat, lon, 19, 89, 8, 1.2);
    const oligotrophicWarm = -0.75 * normT * gaussianLobe(lat, lon, 22, -155, 16, 2.2);
    const dipoleChl =
      teleconnectionId === 'enso'
        ? -rawSignal * 0.65
        : teleconnectionId === 'iod'
        ? rawSignal * 0.55
        : rawSignal * 0.45;
    rawSignal = dipoleChl + somaliUpwell + amazonPlume + gangesPlume + oligotrophicWarm + 0.26 * noise;
    return clampScale(rawSignal * 0.72, dataset, effectiveMode);
  }

  if (dataset.id === 'mur_sst') {
    const baseWarm = (normT - 0.34) * 0.85 * Math.cos(lat * 0.8 * DEG2RAD);
    const marineHeatwave = 0.65 * normT * gaussianLobe(lat, lon, 42, -148, 12, 1.8);
    const northAtlWarm = 0.75 * normT * gaussianLobe(lat, lon, 38, -62, 11, 1.6);
    const coldBlob = -0.75 * normT * gaussianLobe(lat, lon, 54, -36, 10, 1.3);
    rawSignal += baseWarm + marineHeatwave + northAtlWarm + coldBlob + 0.25 * noise;
    return clampScale(rawSignal * 0.92, dataset, effectiveMode);
  }

  if (dataset.id === 'modis_ndvi') {
    const borealGreen =
      0.85 * normT * gaussianLobe(lat, lon, 62, 75, 12, 2.8) +
      0.75 * normT * gaussianLobe(lat, lon, 60, -105, 12, 2.2);
    const amazonStress = -0.75 * normT * gaussianLobe(lat, lon, -6, -60, 12, 1.4);
    const indiaGreen = 0.65 * normT * gaussianLobe(lat, lon, 22, 78, 9, 1.2);
    rawSignal += borealGreen + amazonStress + indiaGreen + 0.28 * noise;
    return clampScale(rawSignal * 0.095, dataset, effectiveMode);
  }

  if (dataset.id === 'rcm_sar') {
    const hudsonWetland = 1.05 * normT * gaussianLobe(lat, lon, 56, -86, 11, 1.6);
    const mackenzieFlood = 0.85 * normT * gaussianLobe(lat, lon, 66, -132, 9, 1.5);
    const arcticIceBackscatterLoss = -1.25 * normT * gaussianLobe(lat, lon, 75.5, 48, 12, 2.2);
    const beaufortLoss = -0.95 * normT * gaussianLobe(lat, lon, 74, -142, 11, 2.0);
    rawSignal =
      rawSignal * 0.35 +
      hudsonWetland +
      mackenzieFlood +
      arcticIceBackscatterLoss +
      beaufortLoss +
      0.24 * noise;
    return clampScale(rawSignal * 1.95, dataset, effectiveMode);
  }

  if (dataset.id === 'amsr2_ice') {
    const polarWeight =
      lat > 54
        ? Math.min(1, (lat - 54) / 16)
        : lat < -54
        ? Math.min(1, (-54 - lat) / 16)
        : 0.02;
    if (polarWeight <= 0.05) {
      return 0;
    }
    const barentsLoss = -1.35 * normT * gaussianLobe(lat, lon, 76, 46, 12, 2.0);
    const beaufortLoss = -1.05 * normT * gaussianLobe(lat, lon, 73, -145, 12, 2.0);
    const rossGain = 0.85 * normT * gaussianLobe(lat, lon, -68, -170, 10, 2.2);
    const weddellVar = -0.65 * (normT - 0.4) * gaussianLobe(lat, lon, -66, -42, 10, 2.0);
    rawSignal = (rawSignal * 0.4 + barentsLoss + beaufortLoss + rossGain + weddellVar + 0.22 * noise) * polarWeight;
    return clampScale(rawSignal * 22, dataset, effectiveMode);
  }

  const greenlandLoss = -1.55 * normT * gaussianLobe(lat, lon, 70, -42, 9, 1.4);
  const westAntLoss = -1.35 * normT * gaussianLobe(lat, lon, -75, -105, 10, 2.0);
  const nwIndiaDeplete = -0.95 * normT * gaussianLobe(lat, lon, 29, 76, 8, 1.2);
  const okavangoSurplus = 0.65 * normT * gaussianLobe(lat, lon, -15, 24, 9, 1.2);
  rawSignal = rawSignal * 0.45 + greenlandLoss + westAntLoss + nwIndiaDeplete + okavangoSurplus + 0.18 * noise;
  return clampScale(rawSignal * 16, dataset, effectiveMode);
}

function clampScale(val: number, dataset: DatasetSpec, dataMode: DataMode): number {
  const bounds = getEffectiveBounds(dataset, dataMode);
  return Math.max(bounds.min, Math.min(bounds.max, val));
}

export function generatePointTimeSeries(
  dataset: DatasetSpec,
  teleconnectionId: TeleconnectionId,
  lat: number,
  lon: number,
  dataMode: DataMode = 'historical',
  includeFullHorizon = false
): { points: TimeSeriesPoint[]; stats: TrendAnalysisResult } {
  const rawValues: number[] = [];
  const meta: { year: number; month: number; dateLabel: string }[] = [];

  const isMonthly = dataMode === 'historical' && !includeFullHorizon;
  const startYear = includeFullHorizon || dataMode === 'historical' ? 2005 : 2025;
  const endYear = dataMode === 'historical' && !includeFullHorizon ? 2024 : 2099;
  const months = isMonthly ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1, 4, 7, 10];
  const stepsPerDecade = isMonthly ? 120 : 40;

  for (let year = startYear; year <= endYear; year++) {
    for (const month of months) {
      const val = sampleAnomalyAt(dataset, teleconnectionId, lat, lon, year, month, undefined, dataMode);
      const cleanVal = Number.isNaN(val) ? 0 : val;
      rawValues.push(cleanVal);
      meta.push({
        year,
        month,
        dateLabel: `${year}-${String(month).padStart(2, '0')}`,
      });
    }
  }

  const stats = computeMannKendallAndTheilSen(rawValues, stepsPerDecade);
  const loessValues = computeLoess(rawValues, isMonthly ? 0.14 : 0.12);

  const points: TimeSeriesPoint[] = rawValues.map((raw, i) => ({
    index: i,
    year: meta[i].year,
    month: meta[i].month,
    dateLabel: meta[i].dateLabel,
    raw,
    loess: loessValues[i],
    theilSen: stats.intercept + stats.slopePerMonth * i,
  }));

  return { points, stats };
}

export function generateDriverSummarySeries(
  dataset: DatasetSpec,
  teleconnectionId: TeleconnectionId,
  dataMode: DataMode = 'historical',
  includeFullHorizon = false
): { points: TimeSeriesPoint[]; stats: TrendAnalysisResult; targetLat: number; targetLon: number } {
  const { poleA } = getEffectivePoles(teleconnectionId, dataset);
  if (poleA) {
    const res = generatePointTimeSeries(
      dataset,
      teleconnectionId,
      poleA.lat,
      poleA.lon,
      dataMode,
      includeFullHorizon
    );
    return { ...res, targetLat: poleA.lat, targetLon: poleA.lon };
  }

  const sampleCoords: [number, number][] =
    dataset.domain === 'land'
      ? [
          [62, 75],
          [38, -105],
          [-6, -60],
          [12, 18],
          [70, -42],
          [-25, 134],
        ]
      : dataset.domain === 'ocean'
      ? [
          [0, -135],
          [36, -60],
          [40, -148],
          [75, 42],
          [-20, 75],
          [-55, 0],
        ]
      : [
          [66, 48],
          [38, -100],
          [0, -120],
          [5, 54],
          [-25, 134],
          [48, 16],
        ];

  const rawValues: number[] = [];
  const meta: { year: number; month: number; dateLabel: string }[] = [];

  const isMonthly = dataMode === 'historical' && !includeFullHorizon;
  const startYear = includeFullHorizon || dataMode === 'historical' ? 2005 : 2025;
  const endYear = dataMode === 'historical' && !includeFullHorizon ? 2024 : 2099;
  const months = isMonthly ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1, 4, 7, 10];
  const stepsPerDecade = isMonthly ? 120 : 40;

  for (let year = startYear; year <= endYear; year++) {
    for (const month of months) {
      let sum = 0;
      let count = 0;
      for (const [slat, slon] of sampleCoords) {
        const v = sampleAnomalyAt(dataset, teleconnectionId, slat, slon, year, month, undefined, dataMode);
        if (!Number.isNaN(v)) {
          sum += v;
          count++;
        }
      }
      rawValues.push(count > 0 ? sum / count : 0);
      meta.push({
        year,
        month,
        dateLabel: `${year}-${String(month).padStart(2, '0')}`,
      });
    }
  }

  const stats = computeMannKendallAndTheilSen(rawValues, stepsPerDecade);
  const loessValues = computeLoess(rawValues, isMonthly ? 0.14 : 0.12);

  const points: TimeSeriesPoint[] = rawValues.map((raw, i) => ({
    index: i,
    year: meta[i].year,
    month: meta[i].month,
    dateLabel: meta[i].dateLabel,
    raw,
    loess: loessValues[i],
    theilSen: stats.intercept + stats.slopePerMonth * i,
  }));

  return {
    points,
    stats,
    targetLat: sampleCoords[0][0],
    targetLon: sampleCoords[0][1],
  };
}

export function generateOpposingPoleSeries(
  dataset: DatasetSpec,
  teleconnectionId: TeleconnectionId,
  dataMode: DataMode = 'historical',
  includeFullHorizon = false
): { points: TimeSeriesPoint[]; stats: TrendAnalysisResult; targetLat: number; targetLon: number } | null {
  const { poleB } = getEffectivePoles(teleconnectionId, dataset);
  if (!poleB) return null;
  const res = generatePointTimeSeries(
    dataset,
    teleconnectionId,
    poleB.lat,
    poleB.lon,
    dataMode,
    includeFullHorizon
  );
  return { ...res, targetLat: poleB.lat, targetLon: poleB.lon };
}

export function buildGlobalAnomalyGrid(
  dataset: DatasetSpec,
  teleconnectionId: TeleconnectionId,
  year: number,
  month: number,
  dataMode: DataMode = 'historical'
): Float32Array {
  const landMask = getLandMaskBuffer();
  const grid = new Float32Array(360 * 180);
  for (let y = 0; y < 180; y++) {
    const lat = 89.5 - y;
    const rowOffset = y * 360;
    for (let x = 0; x < 360; x++) {
      const lon = -179.5 + x;
      const onLand = landMask[rowOffset + x] === 1;
      grid[rowOffset + x] = sampleAnomalyAt(
        dataset,
        teleconnectionId,
        lat,
        lon,
        year,
        month,
        onLand,
        dataMode
      );
    }
  }
  return grid;
}

export function buildSignificanceMaskGrid(
  dataset: DatasetSpec,
  teleconnectionId: TeleconnectionId,
  dataMode: DataMode = 'historical'
): Uint8Array {
  const landMask = getLandMaskBuffer();
  const mask = new Uint8Array(120 * 60);
  const annual = new Float64Array(20);

  for (let y = 0; y < 60; y++) {
    const lat = 88.5 - y * 3;
    const landRow = Math.min(179, Math.max(0, Math.floor(89.5 - lat + 0.5))) * 360;
    for (let x = 0; x < 120; x++) {
      const lon = -178.5 + x * 3;
      const landCol = Math.min(359, Math.max(0, Math.floor(lon + 179.5 + 0.5)));
      const onLand = landMask[landRow + landCol] === 1;

      if ((dataset.domain === 'land' && !onLand) || (dataset.domain === 'ocean' && onLand)) {
        mask[y * 120 + x] = 0;
        continue;
      }

      for (let yrIdx = 0; yrIdx < 20; yrIdx++) {
        const sampleYr =
          dataMode === 'historical' ? 2005 + yrIdx : Math.round(2025 + (yrIdx * 74) / 19);
        const v1 = sampleAnomalyAt(dataset, teleconnectionId, lat, lon, sampleYr, 3, onLand, dataMode);
        const v2 = sampleAnomalyAt(dataset, teleconnectionId, lat, lon, sampleYr, 9, onLand, dataMode);
        annual[yrIdx] = 0.5 * (v1 + v2);
      }

      const p = fastAnnualMannKendallPValue(annual);
      mask[y * 120 + x] = p < 0.05 ? 1 : 0;
    }
  }

  return mask;
}

export function getDatasetById(id: DatasetId): DatasetSpec {
  return DATASETS.find((d) => d.id === id) ?? DATASETS[0];
}

export interface RegionSeriesResult {
  points: TimeSeriesPoint[];
  stats: TrendAnalysisResult;
  centerLat: number;
  centerLon: number;
  validSamples: number;
  totalSamples: number;
  spatialStdDev: number;
  domainMasked: boolean;
}

export function generateRegionAreaWeightedSeries(
  dataset: DatasetSpec,
  teleconnectionId: TeleconnectionId,
  roi: BoundingBoxROI,
  dataMode: DataMode = 'historical',
  includeFullHorizon = false,
  activeYear = 2024,
  activeMonth = 10
): RegionSeriesResult {
  const minLat = Math.max(-88, Math.min(roi.minLat, roi.maxLat));
  const maxLat = Math.min(88, Math.max(roi.minLat, roi.maxLat));
  const minLon = Math.max(-180, Math.min(roi.minLon, roi.maxLon));
  const maxLon = Math.min(180, Math.max(roi.minLon, roi.maxLon));

  const latSteps = 6;
  const lonSteps = 8;
  const sampleCoords: { lat: number; lon: number; weight: number }[] = [];

  for (let i = 0; i < latSteps; i++) {
    const fLat = i / (latSteps - 1);
    const lat = minLat + (maxLat - minLat) * fLat;
    const weight = Math.max(0.05, Math.cos(lat * DEG2RAD));
    for (let j = 0; j < lonSteps; j++) {
      const fLon = j / (lonSteps - 1);
      const lon = minLon + (maxLon - minLon) * fLon;
      sampleCoords.push({ lat, lon, weight });
    }
  }

  const landMask = getLandMaskBuffer();
  const validCoords = sampleCoords.filter((c) => {
    const gx = Math.min(359, Math.max(0, Math.floor(c.lon + 179.5 + 0.5)));
    const gy = Math.min(179, Math.max(0, Math.floor(89.5 - c.lat + 0.5)));
    const onLand = landMask[gy * 360 + gx] === 1;
    if (dataset.domain === 'land' && !onLand) return false;
    if (dataset.domain === 'ocean' && onLand) return false;
    return true;
  });

  const centerLat = (minLat + maxLat) * 0.5;
  const centerLon = (minLon + maxLon) * 0.5;

  if (validCoords.length === 0) {
    const emptyStats = computeMannKendallAndTheilSen([], 120);
    return {
      points: [],
      stats: emptyStats,
      centerLat,
      centerLon,
      validSamples: 0,
      totalSamples: sampleCoords.length,
      spatialStdDev: 0,
      domainMasked: true,
    };
  }

  const isMonthly = dataMode === 'historical' && !includeFullHorizon;
  const startYear = includeFullHorizon || dataMode === 'historical' ? 2005 : 2025;
  const endYear = dataMode === 'historical' && !includeFullHorizon ? 2024 : 2099;
  const months = isMonthly ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1, 4, 7, 10];
  const stepsPerDecade = isMonthly ? 120 : 40;

  const rawValues: number[] = [];
  const meta: { year: number; month: number; dateLabel: string }[] = [];

  for (let yr = startYear; yr <= endYear; yr++) {
    for (const mo of months) {
      let wSum = 0;
      let valSum = 0;
      for (const pt of validCoords) {
        const v = sampleAnomalyAt(
          dataset,
          teleconnectionId,
          pt.lat,
          pt.lon,
          yr,
          mo,
          undefined,
          dataMode
        );
        if (!Number.isNaN(v)) {
          valSum += v * pt.weight;
          wSum += pt.weight;
        }
      }
      rawValues.push(wSum > 0 ? valSum / wSum : 0);
      meta.push({
        year: yr,
        month: mo,
        dateLabel: `${yr}-${String(mo).padStart(2, '0')}`,
      });
    }
  }

  // Compute spatial standard deviation at activeYear/activeMonth
  let activeVals: number[] = [];
  for (const pt of validCoords) {
    const v = sampleAnomalyAt(
      dataset,
      teleconnectionId,
      pt.lat,
      pt.lon,
      activeYear,
      activeMonth,
      undefined,
      dataMode
    );
    if (!Number.isNaN(v)) activeVals.push(v);
  }
  const activeMean =
    activeVals.length > 0 ? activeVals.reduce((s, v) => s + v, 0) / activeVals.length : 0;
  const spatialVar =
    activeVals.length > 1
      ? activeVals.reduce((s, v) => s + (v - activeMean) * (v - activeMean), 0) /
        (activeVals.length - 1)
      : 0;

  const stats = computeMannKendallAndTheilSen(rawValues, stepsPerDecade);
  const loessValues = computeLoess(rawValues, isMonthly ? 0.14 : 0.12);

  const points: TimeSeriesPoint[] = rawValues.map((raw, i) => ({
    index: i,
    year: meta[i].year,
    month: meta[i].month,
    dateLabel: meta[i].dateLabel,
    raw,
    loess: loessValues[i],
    theilSen: stats.intercept + stats.slopePerMonth * i,
  }));

  return {
    points,
    stats,
    centerLat,
    centerLon,
    validSamples: validCoords.length,
    totalSamples: sampleCoords.length,
    spatialStdDev: Math.sqrt(spatialVar),
    domainMasked: false,
  };
}

