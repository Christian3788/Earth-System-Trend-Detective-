import React, { useMemo, useRef, useState } from 'react';
import {
  Download,
  Crosshair,
  TrendingUp,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  FileText,
  Upload,
  GitCompareArrows,
  Layers,
  X,
} from 'lucide-react';
import {
  BoundingBoxROI,
  DATASETS,
  DATA_MODE_META,
  DataMode,
  DatasetId,
  DatasetSpec,
  MONTH_ABBR,
  SENTINEL_REGIONS,
  TELECONNECTIONS,
  TeleconnectionId,
  getEffectivePoles,
} from '../data/datasets';
import { formatCoord, getRegionName } from '../data/worldCoastlines';
import {
  generateDriverSummarySeries,
  generateOpposingPoleSeries,
  generatePointTimeSeries,
  generateRegionAreaWeightedSeries,
  getDatasetById,
  sampleAnomalyAt,
} from '../engine/earthData';
import {
  ParsedExternalCsv,
  TimeSeriesPoint,
  TrendAnalysisResult,
  computeCrossCorrelation,
  computePettittChangePoint,
  computeSeasonalBreakdown,
  formatPValue,
  parseUserCsvTimeSeries,
} from '../engine/statistics';
import { TimeSeriesCanvas } from './TimeSeriesCanvas';
import { ChatbotPanel, ChatMessage } from './ChatbotPanel';

export type AnalysisTab = 'detective' | 'identify' | 'timeplot' | 'chat';

interface AnalysisPanelProps {
  activeTab: AnalysisTab;
  onChangeTab: (t: AnalysisTab) => void;
  dataset: DatasetSpec;
  teleconnectionId: TeleconnectionId;
  dataMode: DataMode;
  year: number;
  month: number;
  driverSeries: {
    points: TimeSeriesPoint[];
    stats: TrendAnalysisResult;
    targetLat: number;
    targetLon: number;
  };
  probedPoint: { lat: number; lon: number } | null;
  onSelectProbeCoord: (lat: number, lon: number) => void;
  activeRoi: BoundingBoxROI | null;
  onSelectRoi: (roi: BoundingBoxROI | null) => void;
}

type PlotTarget = 'driver' | 'poleB' | 'both' | 'probe' | 'roi' | 'customCsv';

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  activeTab,
  onChangeTab,
  dataset,
  teleconnectionId,
  dataMode,
  year,
  month,
  driverSeries,
  probedPoint,
  onSelectProbeCoord,
  activeRoi,
  onSelectRoi,
}) => {
  const [plotTarget, setPlotTarget] = useState<PlotTarget>('driver');
  const [includeFullHorizon, setIncludeFullHorizon] = useState<boolean>(false);
  const [compareDatasetId, setCompareDatasetId] = useState<DatasetId | 'none'>('none');
  const [lagSteps, setLagSteps] = useState<number>(0);
  const [customCsv, setCustomCsv] = useState<ParsedExternalCsv | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const tele = TELECONNECTIONS[teleconnectionId];
  const modeMeta = DATA_MODE_META[dataMode];
  const useFullHorizon = dataMode !== 'historical' && includeFullHorizon;

  const effectivePoles = useMemo(
    () => getEffectivePoles(teleconnectionId, dataset),
    [teleconnectionId, dataset]
  );

  // Live Pole A / Pole B values at current year/month
  const poleAVal = useMemo(() => {
    if (!effectivePoles.poleA) return null;
    return sampleAnomalyAt(
      dataset,
      teleconnectionId,
      effectivePoles.poleA.lat,
      effectivePoles.poleA.lon,
      year,
      month,
      undefined,
      dataMode
    );
  }, [dataset, teleconnectionId, effectivePoles, year, month, dataMode]);

  const poleBVal = useMemo(() => {
    if (!effectivePoles.poleB) return null;
    return sampleAnomalyAt(
      dataset,
      teleconnectionId,
      effectivePoles.poleB.lat,
      effectivePoles.poleB.lon,
      year,
      month,
      undefined,
      dataMode
    );
  }, [dataset, teleconnectionId, effectivePoles, year, month, dataMode]);

  // Historical baseline driver series for Observed vs. Projected comparison
  const historicalBaselineSeries = useMemo(() => {
    if (dataMode === 'historical') return null;
    return generateDriverSummarySeries(dataset, teleconnectionId, 'historical', false);
  }, [dataset, teleconnectionId, dataMode]);

  // Driver series (supports Full 2005-2099 continuity in Time Plot)
  const plotDriverSeries = useMemo(() => {
    if (!useFullHorizon) return driverSeries;
    return generateDriverSummarySeries(dataset, teleconnectionId, dataMode, true);
  }, [useFullHorizon, driverSeries, dataset, teleconnectionId, dataMode]);

  // Pole B statistical series
  const poleBSeries = useMemo(
    () => generateOpposingPoleSeries(dataset, teleconnectionId, dataMode, false),
    [dataset, teleconnectionId, dataMode]
  );

  const plotPoleBSeries = useMemo(() => {
    if (!useFullHorizon) return poleBSeries;
    return generateOpposingPoleSeries(dataset, teleconnectionId, dataMode, true);
  }, [useFullHorizon, poleBSeries, dataset, teleconnectionId, dataMode]);

  // Probed point inspection & statistical series
  const probeAnalysis = useMemo(() => {
    if (!probedPoint) return null;
    const observed = sampleAnomalyAt(
      dataset,
      teleconnectionId,
      probedPoint.lat,
      probedPoint.lon,
      year,
      month,
      undefined,
      dataMode
    );
    const domainMasked = Number.isNaN(observed);
    const series = domainMasked
      ? null
      : generatePointTimeSeries(
          dataset,
          teleconnectionId,
          probedPoint.lat,
          probedPoint.lon,
          dataMode,
          useFullHorizon
        );
    const histSeries =
      domainMasked || dataMode === 'historical'
        ? null
        : generatePointTimeSeries(
            dataset,
            teleconnectionId,
            probedPoint.lat,
            probedPoint.lon,
            'historical',
            false
          );

    return {
      lat: probedPoint.lat,
      lon: probedPoint.lon,
      region: getRegionName(probedPoint.lat, probedPoint.lon),
      observed,
      domainMasked,
      series,
      histSeries,
    };
  }, [probedPoint, dataset, teleconnectionId, year, month, dataMode, useFullHorizon]);

  // Pettitt regime shift + Seasonal breakdown for active driver series
  const driverPettitt = useMemo(
    () => computePettittChangePoint(driverSeries.points),
    [driverSeries.points]
  );
  const seasonalStats = useMemo(
    () => computeSeasonalBreakdown(driverSeries.points),
    [driverSeries.points]
  );

  // Area-weighted regional ROI analysis
  const roiAnalysis = useMemo(() => {
    if (!activeRoi) return null;
    const res = generateRegionAreaWeightedSeries(
      dataset,
      teleconnectionId,
      activeRoi,
      dataMode,
      useFullHorizon,
      year,
      month
    );
    const pettitt = res.domainMasked ? null : computePettittChangePoint(res.points);
    return { roi: activeRoi, ...res, pettitt };
  }, [activeRoi, dataset, teleconnectionId, dataMode, useFullHorizon, year, month]);

  // Resolve active Time Plot series
  const activePlotData = useMemo(() => {
    if (plotTarget === 'customCsv' && customCsv) {
      return {
        label: `Imported CSV · ${customCsv.title}`,
        points: customCsv.points,
        comparePoints: null,
        stats: customCsv.stats,
        pettitt: customCsv.pettitt,
        unitOverride: customCsv.unit,
      };
    }
    if (plotTarget === 'roi' && roiAnalysis && !roiAnalysis.domainMasked && roiAnalysis.points.length > 0) {
      return {
        label: `Area-Weighted ROI · ${roiAnalysis.roi.label}`,
        points: roiAnalysis.points,
        comparePoints: null,
        stats: roiAnalysis.stats,
        pettitt: roiAnalysis.pettitt,
        unitOverride: undefined,
      };
    }
    if (plotTarget === 'probe' && probeAnalysis && !probeAnalysis.domainMasked && probeAnalysis.series) {
      return {
        label: `Probed Point (${formatCoord(probeAnalysis.lat, probeAnalysis.lon)})`,
        points: probeAnalysis.series.points,
        comparePoints: null,
        stats: probeAnalysis.series.stats,
        pettitt: computePettittChangePoint(probeAnalysis.series.points),
        unitOverride: undefined,
      };
    }
    if (plotTarget === 'poleB' && effectivePoles.poleB && plotPoleBSeries) {
      return {
        label: effectivePoles.poleB.name,
        points: plotPoleBSeries.points,
        comparePoints: null,
        stats: plotPoleBSeries.stats,
        pettitt: computePettittChangePoint(plotPoleBSeries.points),
        unitOverride: undefined,
      };
    }
    if (plotTarget === 'both' && effectivePoles.poleA && effectivePoles.poleB && plotPoleBSeries) {
      return {
        label: `Opposing Poles: ${effectivePoles.poleA.regionLabel} vs. ${effectivePoles.poleB.regionLabel}`,
        points: plotDriverSeries.points,
        comparePoints: plotPoleBSeries.points,
        stats: plotDriverSeries.stats,
        pettitt: computePettittChangePoint(plotDriverSeries.points),
        unitOverride: undefined,
      };
    }
    return {
      label: effectivePoles.poleA ? effectivePoles.poleA.name : 'Global Sampling Composite',
      points: plotDriverSeries.points,
      comparePoints: null,
      stats: plotDriverSeries.stats,
      pettitt: computePettittChangePoint(plotDriverSeries.points),
      unitOverride: undefined,
    };
  }, [plotTarget, customCsv, roiAnalysis, probeAnalysis, effectivePoles, plotPoleBSeries, plotDriverSeries]);

  // Cross-Sphere Correlation & Lead/Lag Overlay
  const crossCorrelation = useMemo(() => {
    if (
      compareDatasetId === 'none' ||
      compareDatasetId === dataset.id ||
      activePlotData.comparePoints ||
      plotTarget === 'customCsv'
    ) {
      return null;
    }
    const secSpec = getDatasetById(compareDatasetId);
    let secPoints: TimeSeriesPoint[] = [];

    if (plotTarget === 'roi' && activeRoi) {
      const r = generateRegionAreaWeightedSeries(
        secSpec,
        teleconnectionId,
        activeRoi,
        dataMode,
        useFullHorizon,
        year,
        month
      );
      if (r.domainMasked) return null;
      secPoints = r.points;
    } else if (plotTarget === 'probe' && probedPoint) {
      const p = generatePointTimeSeries(
        secSpec,
        teleconnectionId,
        probedPoint.lat,
        probedPoint.lon,
        dataMode,
        useFullHorizon
      );
      secPoints = p.points;
    } else if (plotTarget === 'poleB' && effectivePoles.poleB) {
      const p = generatePointTimeSeries(
        secSpec,
        teleconnectionId,
        effectivePoles.poleB.lat,
        effectivePoles.poleB.lon,
        dataMode,
        useFullHorizon
      );
      secPoints = p.points;
    } else {
      const targetLat = effectivePoles.poleA?.lat ?? driverSeries.targetLat;
      const targetLon = effectivePoles.poleA?.lon ?? driverSeries.targetLon;
      const p = generatePointTimeSeries(
        secSpec,
        teleconnectionId,
        targetLat,
        targetLon,
        dataMode,
        useFullHorizon
      );
      secPoints = p.points;
    }

    if (secPoints.length !== activePlotData.points.length) return null;
    const result = computeCrossCorrelation(activePlotData.points, secPoints, lagSteps, 6);
    return {
      spec: secSpec,
      points: secPoints,
      result,
    };
  }, [
    compareDatasetId,
    dataset.id,
    activePlotData.comparePoints,
    activePlotData.points,
    plotTarget,
    activeRoi,
    teleconnectionId,
    dataMode,
    useFullHorizon,
    year,
    month,
    probedPoint,
    effectivePoles,
    driverSeries.targetLat,
    driverSeries.targetLon,
    lagSteps,
  ]);

  const formatSigned = (val: number, dec = dataset.decimals) => {
    const sign = val >= 0 ? '+' : '';
    return `${sign}${val.toFixed(dec)}`;
  };

  const getDirectionVerb = (val: number) =>
    val >= 0 ? dataset.directionTerms[0] : dataset.directionTerms[1];

  const handleExportCsv = () => {
    const { points, stats, label, unitOverride } = activePlotData;
    const unitStr = unitOverride ?? dataset.unit;
    const windowStr = useFullHorizon
      ? '2005-2099'
      : dataMode === 'historical'
      ? '2005-2024'
      : '2025-2099';
    const deltaLabel = useFullHorizon
      ? '95-Year Delta (2005-2099)'
      : dataMode === 'historical'
      ? '20-Year Delta (2005-2024)'
      : '75-Year Projected Delta (2025-2099)';

    const headerLines = [
      `# NASA Earth System Data Explorer - Trend Detective Export`,
      `# Data Mode: ${modeMeta.label}`,
      `# Dataset: ${dataset.name} (${dataset.sourceType}, ${dataset.mission})`,
      `# Teleconnection Driver: ${tele.label}`,
      `# Target Series: ${label}`,
      `# Unit: ${unitStr}`,
      `# Theil-Sen Slope: ${formatSigned(stats.slopePerDecade, dataset.decimals + 1)} ${unitStr}/decade`,
      `# ${deltaLabel}: ${formatSigned(stats.delta20Yr, dataset.decimals + 1)} ${unitStr}`,
      `# Mann-Kendall Z-Score: ${stats.zScore.toFixed(3)}`,
      `# Mann-Kendall p-Value: ${stats.pValue.toExponential(4)}`,
      `Date,Year,Month,Raw_Anomaly,LOESS_Smoothed,Theil_Sen_Trend,Unit`,
    ];

    const rows = points.map(
      (pt) =>
        `${pt.dateLabel},${pt.year},${pt.month},${pt.raw.toFixed(4)},${pt.loess.toFixed(4)},${pt.theilSen.toFixed(4)},${unitStr}`
    );

    const csv = [...headerLines, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nasa_esde_${dataset.id}_${teleconnectionId}_${dataMode}_${windowStr.replace('-', '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportBriefing = () => {
    const { stats } = driverSeries;
    const lines = [
      `# NASA Earth System Data Explorer — Trend Detective Science Briefing`,
      ``,
      `**Generated:** ${new Date().toISOString().slice(0, 16)} UTC`,
      `**Active Date:** ${MONTH_ABBR[month - 1]} ${year} (${modeMeta.label})`,
      `**Variable:** ${dataset.name} (${dataset.sourceType} · ${dataset.mission})`,
      `**Archive / Portals:** ${dataset.daacName} · ${dataset.portalHint}`,
      `**Citation:** ${dataset.citation}`,
      ``,
      `## 01. What Is Changing`,
      `${dataset.physicalSummary}`,
      ``,
      `## 02. Where It Is Changing (${tele.label})`,
      `- **Bounding Domain:** ${tele.boundingCoords}`,
      `- **Mechanism:** ${tele.mechanism}`,
      effectivePoles.poleA
        ? `- **Pole A (Surplus):** ${effectivePoles.poleA.name} (${formatCoord(effectivePoles.poleA.lat, effectivePoles.poleA.lon)})`
        : '',
      effectivePoles.poleB && poleBSeries
        ? `- **Pole B (Deficit):** ${effectivePoles.poleB.name} (${formatCoord(effectivePoles.poleB.lat, effectivePoles.poleB.lon)}) · Slope: ${formatSigned(poleBSeries.stats.slopePerDecade)} ${dataset.unit}/dec (Z=${poleBSeries.stats.zScore.toFixed(2)}, p=${formatPValue(poleBSeries.stats.pValue)})`
        : '',
      roiAnalysis && !roiAnalysis.domainMasked
        ? `- **Active Area-Weighted ROI:** ${roiAnalysis.roi.label} · Slope: ${formatSigned(roiAnalysis.stats.slopePerDecade)} ${dataset.unit}/dec (Z=${roiAnalysis.stats.zScore.toFixed(2)}, p=${formatPValue(roiAnalysis.stats.pValue)}, Spatial ±1σ = ${roiAnalysis.spatialStdDev.toFixed(dataset.decimals)} ${dataset.unit})`
        : '',
      ``,
      `## 03. How Much & Statistical Significance`,
      `- **Theil-Sen Decadal Slope:** ${formatSigned(stats.slopePerDecade)} ${dataset.unit}/decade`,
      `- **Horizon Delta:** ${formatSigned(stats.delta20Yr)} ${dataset.unit}`,
      `- **Mann-Kendall Test:** Z = ${stats.zScore >= 0 ? '+' : ''}${stats.zScore.toFixed(2)}, two-tailed p = ${formatPValue(stats.pValue)}`,
      `- **Confidence Verdict:** ${stats.confidenceLabel}`,
      driverPettitt
        ? `- **Pettitt Change-Point Test:** ${driverPettitt.significant ? `Regime shift detected at ${driverPettitt.dateLabel} (Δ=${formatSigned(driverPettitt.shiftMagnitude)} ${dataset.unit}, p=${formatPValue(driverPettitt.pValue)})` : `Gradual trend (no statistically significant abrupt break, p=${formatPValue(driverPettitt.pValue)})`}`
        : '',
      ``,
      `## 04. Seasonal Sub-Trend Breakdown`,
      ...seasonalStats.map(
        (s) =>
          `- **${s.label}:** ${formatSigned(s.slopePerDecade)} ${dataset.unit}/dec (p=${formatPValue(s.pValue)}${s.significant ? ', significant' : ', noise'})`
      ),
      crossCorrelation
        ? `\n## 05. Cross-Sphere Correlation\n- **Compared Variable:** ${crossCorrelation.spec.name}\n- **Lag:** ${crossCorrelation.result.lagSteps} steps | **Pearson r:** ${crossCorrelation.result.r.toFixed(3)} (R²=${crossCorrelation.result.rSquared.toFixed(3)}, p=${formatPValue(crossCorrelation.result.pValue)})\n- **Peak Lag:** ${crossCorrelation.result.optimalLagSteps} steps (r=${crossCorrelation.result.optimalR.toFixed(3)})`
        : '',
    ].filter(Boolean);

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trend_detective_briefing_${dataset.id}_${teleconnectionId}_${dataMode}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUploadCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const parsed = parseUserCsvTimeSeries(txt, file.name);
      setCustomCsv(parsed);
      setCsvError(null);
      setPlotTarget('customCsv');
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Unable to parse CSV file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleLoadSampleExternalCsv = () => {
    // Representative Giovanni-style monthly coastal chlorophyll & temperature sample
    const sample = [
      'Date,Chlorophyll_Anomaly,mg/m3',
      '2015-01,0.12',
      '2015-06,0.18',
      '2016-01,0.08',
      '2016-06,0.22',
      '2017-01,0.25',
      '2017-06,0.31',
      '2018-01,0.29',
      '2018-06,0.39',
      '2019-01,0.44',
      '2019-06,0.58',
      '2020-01,0.52',
      '2020-06,0.61',
      '2021-01,0.59',
      '2021-06,0.67',
      '2022-01,0.64',
      '2022-06,0.74',
      '2023-01,0.79',
      '2023-06,0.86',
      '2024-01,0.83',
      '2024-06,0.92',
    ].join('\n');
    const parsed = parseUserCsvTimeSeries(sample, 'Giovanni_Sample_Plume.csv');
    setCustomCsv(parsed);
    setCsvError(null);
    setPlotTarget('customCsv');
  };

  const { stats } = driverSeries;
  const horizonSpanLabel = dataMode === 'historical' ? '2005–2024' : '2025–2099';
  const horizonDeltaLabel =
    dataMode === 'historical' ? '20-Year Total Delta' : '75-Year Projected Delta';
  const horizonDeltaShort = dataMode === 'historical' ? '20-Yr Δ' : '75-Yr Δ';

  return (
    <aside
      aria-label="NASA ESDE Analysis and Trend Detective suite"
      className="w-full lg:w-[392px] xl:w-[424px] shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-slate-200 flex flex-col lg:overflow-hidden"
    >
      {/* Tab Navigation Bar */}
      <div
        role="tablist"
        aria-label="Analysis suite tabs"
        className="grid grid-cols-4 border-b border-slate-200 bg-slate-50 shrink-0"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'detective'}
          onClick={() => onChangeTab('detective')}
          className={`px-1.5 py-3 text-xs font-bold flex items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'detective'
              ? 'border-[#0B3D91] text-[#0B3D91] bg-white'
              : 'border-transparent text-slate-700 hover:text-slate-950 hover:bg-slate-100/80'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5 shrink-0" />
          Detective
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'identify'}
          onClick={() => onChangeTab('identify')}
          className={`px-1.5 py-3 text-xs font-bold flex items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'identify'
              ? 'border-[#0B3D91] text-[#0B3D91] bg-white'
              : 'border-transparent text-slate-700 hover:text-slate-950 hover:bg-slate-100/80'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5 shrink-0" />
          Identify
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'timeplot'}
          onClick={() => onChangeTab('timeplot')}
          className={`px-1.5 py-3 text-xs font-bold flex items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'timeplot'
              ? 'border-[#0B3D91] text-[#0B3D91] bg-white'
              : 'border-transparent text-slate-700 hover:text-slate-950 hover:bg-slate-100/80'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 shrink-0" />
          Time Plot
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'chat'}
          onClick={() => onChangeTab('chat')}
          className={`px-1.5 py-3 text-xs font-bold flex items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'chat'
              ? 'border-[#0B3D91] text-[#0B3D91] bg-white'
              : 'border-transparent text-slate-700 hover:text-slate-950 hover:bg-slate-100/80'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
          Ask AI
        </button>
      </div>

      {/* Tab Body */}
      <div
        className={
          activeTab === 'chat'
            ? 'flex-1 min-h-0 flex flex-col p-4 overflow-hidden'
            : 'flex-1 overflow-y-auto p-4 space-y-4'
        }
      >
        {activeTab === 'detective' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>Trend Detective · {modeMeta.shortLabel}</span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                N = {stats.n} {dataMode === 'historical' ? 'mo' : 'qtr'}
              </span>
            </div>

            {/* Q1: What is changing */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/80 space-y-1.5">
              <div className="text-xs font-bold uppercase tracking-wider text-[#0B3D91]">
                01. What Is Changing
              </div>
              <div className="text-[15px] font-bold text-slate-950">{dataset.name}</div>
              <div className="text-[13px] text-slate-800">
                <span>
                  {dataMode === 'historical' ? dataset.sourceType : 'CMIP5 / NEX-GDDP Model'}
                </span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>Unit: <span className="font-mono font-bold text-slate-950">{dataset.unit}</span></span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>Driver: <span className="font-semibold text-slate-950">{tele.label}</span></span>
              </div>
              <p className="text-[13px] leading-relaxed text-slate-800 pt-1">
                {dataMode === 'historical'
                  ? tele.id === 'none'
                    ? dataset.physicalSummary
                    : tele.mechanism
                  : modeMeta.description}
              </p>
            </div>

            {/* Q2: Where it is changing */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/80 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-[#0B3D91]">
                02. Where It Is Changing
              </div>
              <div className="text-[13px] font-semibold text-slate-900 font-mono tabular-nums">
                {tele.boundingCoords}
              </div>

              {effectivePoles.poleA && effectivePoles.poleB ? (
                <div className="space-y-2 pt-1">
                  <div className="text-xs font-medium text-slate-700">
                    Same physical process drives opposite regional responses:
                  </div>
                  <div className="p-2.5 rounded border border-slate-200 bg-white flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-cyan-800 truncate">
                        {effectivePoles.poleA.name}
                      </div>
                      <div className="text-xs font-mono font-medium text-slate-700 tabular-nums">
                        {formatCoord(effectivePoles.poleA.lat, effectivePoles.poleA.lon)}
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-[13px] font-bold text-slate-950 tabular-nums">
                      {poleAVal !== null && !Number.isNaN(poleAVal)
                        ? `${formatSigned(poleAVal)} ${dataset.unit}`
                        : '—'}
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-slate-200 bg-white flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-orange-800 truncate">
                        {effectivePoles.poleB.name}
                      </div>
                      <div className="text-xs font-mono font-medium text-slate-700 tabular-nums">
                        {formatCoord(effectivePoles.poleB.lat, effectivePoles.poleB.lon)}
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-[13px] font-bold text-slate-950 tabular-nums">
                      {poleBVal !== null && !Number.isNaN(poleBVal)
                        ? `${formatSigned(poleBVal)} ${dataset.unit}`
                        : '—'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[13px] text-slate-800 pt-0.5">
                  Composite baseline sampled across representative planetary climate bands ({formatCoord(driverSeries.targetLat, driverSeries.targetLon)} primary index).
                </div>
              )}
            </div>

            {/* Q3: How much */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/80 space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-[#0B3D91]">
                03. How Much ({horizonSpanLabel})
              </div>
              {effectivePoles.poleA && effectivePoles.poleB && poleBSeries ? (
                <div className="space-y-2">
                  <div className="p-2.5 rounded border border-slate-200 bg-white space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-cyan-800">Pole A · {getDirectionVerb(stats.slopePerDecade)}</span>
                      <span className="font-mono font-semibold text-slate-700">Δ {formatSigned(stats.delta20Yr)} {dataset.unit}</span>
                    </div>
                    <div className="text-[17px] font-mono font-bold text-slate-950 tabular-nums">
                      {formatSigned(stats.slopePerDecade, dataset.decimals)}
                      <span className="text-xs font-medium text-slate-700 ml-1">
                        {dataset.unit} / decade
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-slate-200 bg-white space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-orange-800">Pole B · {getDirectionVerb(poleBSeries.stats.slopePerDecade)}</span>
                      <span className="font-mono font-semibold text-slate-700">Δ {formatSigned(poleBSeries.stats.delta20Yr)} {dataset.unit}</span>
                    </div>
                    <div className="text-[17px] font-mono font-bold text-slate-950 tabular-nums">
                      {formatSigned(poleBSeries.stats.slopePerDecade, dataset.decimals)}
                      <span className="text-xs font-medium text-slate-700 ml-1">
                        {dataset.unit} / decade
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-xs font-semibold text-slate-700">{horizonDeltaLabel}</div>
                    <div className="text-lg font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                      {formatSigned(stats.delta20Yr, dataset.decimals)}
                      <span className="text-xs font-medium text-slate-700 ml-1">
                        {dataset.unit}
                      </span>
                    </div>
                  </div>
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-xs font-semibold text-slate-700">Theil-Sen Slope</div>
                    <div className="text-lg font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                      {formatSigned(stats.slopePerDecade, dataset.decimals)}
                      <span className="text-xs font-medium text-slate-700 ml-1">
                        /dec
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {historicalBaselineSeries && (
                <div className="p-2.5 rounded border border-slate-200 bg-white space-y-1.5">
                  <div className="text-xs font-bold text-slate-800">
                    Observed vs. Projected Trajectory Comparison
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200">
                      <div className="font-medium text-slate-700">Observed (2005–2024)</div>
                      <div className="font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                        {formatSigned(historicalBaselineSeries.stats.slopePerDecade, dataset.decimals)} {dataset.unit}/dec
                      </div>
                    </div>
                    <div className="p-2 rounded bg-blue-50/70 border border-blue-200">
                      <div className="text-[#0B3D91] font-bold">{modeMeta.shortLabel} (2025–2099)</div>
                      <div className="font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                        {formatSigned(stats.slopePerDecade, dataset.decimals)} {dataset.unit}/dec
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Q4: Is it significant */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-[#0B3D91]">
                  04. Is It Significant? (Mann-Kendall)
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-[13px] font-bold ${
                    stats.significant ? 'text-emerald-800' : 'text-amber-800'
                  }`}
                >
                  {stats.significant ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <AlertCircle className="w-4 h-4" />
                  )}
                  {stats.significant ? 'Significant' : 'Non-Significant'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded border border-slate-200 bg-white">
                  <div className="text-xs font-semibold text-slate-700">
                    {effectivePoles.poleA ? 'Pole A Z / p-Value' : 'Mann-Kendall Z'}
                  </div>
                  <div className="text-sm font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                    {stats.zScore >= 0 ? '+' : ''}
                    {stats.zScore.toFixed(2)} · p {formatPValue(stats.pValue)}
                  </div>
                </div>
                {effectivePoles.poleB && poleBSeries ? (
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-xs font-semibold text-slate-700">Pole B Z / p-Value</div>
                    <div className="text-sm font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                      {poleBSeries.stats.zScore >= 0 ? '+' : ''}
                      {poleBSeries.stats.zScore.toFixed(2)} · p {formatPValue(poleBSeries.stats.pValue)}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-xs font-semibold text-slate-700">Two-Tailed p-Value</div>
                    <div className="text-sm font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                      {formatPValue(stats.pValue)}
                    </div>
                  </div>
                )}
              </div>

              {/* 4-Tier Confidence Meter */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-semibold text-slate-800">4-Tier Confidence Meter</span>
                  <span className="font-mono text-xs font-bold text-slate-950">
                    Tier {stats.confidenceTier} / 4
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5" aria-label={`Confidence Tier ${stats.confidenceTier} of 4`}>
                  {[1, 2, 3, 4].map((tier) => {
                    const filled = tier <= stats.confidenceTier;
                    const barColor = !filled
                      ? 'bg-slate-200'
                      : stats.confidenceTier === 1
                      ? 'bg-amber-500'
                      : stats.confidenceTier === 2
                      ? 'bg-sky-500'
                      : stats.confidenceTier === 3
                      ? 'bg-blue-600'
                      : 'bg-emerald-600';
                    return (
                      <div
                        key={tier}
                        className={`h-2 rounded-xs transition-colors ${barColor}`}
                      />
                    );
                  })}
                </div>
                <div className="text-[13px] font-semibold text-slate-800">
                  {stats.confidenceLabel}
                </div>
              </div>

              {/* Pettitt Change-Point / Regime Shift */}
              {driverPettitt && (
                <div className="p-2.5 rounded border border-slate-200 bg-white space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-violet-900">Pettitt Regime-Shift Test</span>
                    <span className="font-mono font-bold text-slate-800">
                      p = {formatPValue(driverPettitt.pValue)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-800">
                    {driverPettitt.significant ? (
                      <>
                        Abrupt shift detected near{' '}
                        <strong className="font-mono text-violet-900">{driverPettitt.dateLabel}</strong>{' '}
                        (mean step {formatSigned(driverPettitt.shiftMagnitude)} {dataset.unit})
                      </>
                    ) : (
                      'Gradual monotonic trajectory (no significant step break).'
                    )}
                  </div>
                </div>
              )}

              {/* Seasonal Sub-Trend Breakdown */}
              <div className="space-y-1.5 pt-1">
                <div className="text-xs font-bold text-slate-800">
                  Seasonal Sub-Trends ({dataset.unit}/dec)
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {seasonalStats.map((st) => (
                    <div
                      key={st.season}
                      className="p-1.5 rounded border border-slate-200 bg-white text-center"
                    >
                      <div className="text-[11px] font-bold text-slate-700">{st.season}</div>
                      <div className="text-xs font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                        {formatSigned(st.slopePerDecade, dataset.decimals)}
                      </div>
                      <div
                        className={`text-[10px] font-semibold ${
                          st.significant ? 'text-emerald-800' : 'text-slate-500'
                        }`}
                      >
                        {st.significant ? 'p<.05' : 'noise'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleExportBriefing}
                className="px-3 py-2.5 text-[13px] font-bold rounded-md border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-[#0B3D91]" />
                Briefing (.md)
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingPrompt(
                    `Provide an Earth system Trend Detective briefing for ${dataset.name} under ${tele.label} (${modeMeta.shortLabel}).`
                  );
                  onChangeTab('chat');
                }}
                className="px-3 py-2.5 text-[13px] font-bold rounded-md border border-[#0B3D91] bg-blue-50/70 text-[#0B3D91] hover:bg-[#0B3D91] hover:text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MessageSquare className="w-4 h-4" />
                Ask AI
              </button>
            </div>
          </div>
        )}

        {activeTab === 'identify' && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-[13px] font-medium text-slate-800 leading-relaxed">
              Click any coordinate on the 2D planar map or 3D globe to inspect local satellite observations and compute a point-level Mann-Kendall significance test.
            </div>

            {effectivePoles.poleA && effectivePoles.poleB && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onSelectProbeCoord(effectivePoles.poleA!.lat, effectivePoles.poleA!.lon)}
                  className="px-2.5 py-2 text-[13px] font-semibold rounded-md border border-slate-300 bg-white text-cyan-800 hover:bg-cyan-50/70 transition-colors cursor-pointer whitespace-nowrap truncate"
                >
                  Probe Pole A
                </button>
                <button
                  type="button"
                  onClick={() => onSelectProbeCoord(effectivePoles.poleB!.lat, effectivePoles.poleB!.lon)}
                  className="px-2.5 py-2 text-[13px] font-semibold rounded-md border border-slate-300 bg-white text-orange-800 hover:bg-orange-50/70 transition-colors cursor-pointer whitespace-nowrap truncate"
                >
                  Probe Pole B
                </button>
              </div>
            )}

            {/* Sentinel Regions & Area-Weighted Bounding Box Analyzer */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/80 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-teal-800">
                  <Layers className="w-3.5 h-3.5" />
                  Area-Weighted Regions (ROI)
                </div>
                {activeRoi && (
                  <button
                    type="button"
                    onClick={() => onSelectRoi(null)}
                    className="text-xs font-semibold text-slate-700 hover:text-slate-950 inline-flex items-center gap-0.5 cursor-pointer"
                  >
                    Clear <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {SENTINEL_REGIONS.map((reg) => {
                  const selected = activeRoi?.id === reg.id;
                  return (
                    <button
                      key={reg.id}
                      type="button"
                      onClick={() => onSelectRoi(selected ? null : reg)}
                      className={`px-2 py-1 text-xs font-semibold rounded border transition-colors cursor-pointer ${
                        selected
                          ? 'bg-teal-700 text-white border-teal-700'
                          : 'bg-white text-slate-800 border-slate-300 hover:border-teal-600'
                      }`}
                    >
                      {reg.label}
                    </button>
                  );
                })}
              </div>

              {roiAnalysis && (
                <div className="p-2.5 rounded border border-teal-200 bg-white space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-slate-950 truncate">
                      {roiAnalysis.roi.label}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-slate-700 shrink-0">
                      {roiAnalysis.validSamples}/{roiAnalysis.totalSamples} cells
                    </span>
                  </div>
                  {roiAnalysis.domainMasked ? (
                    <div className="text-xs text-amber-800 font-medium">
                      No valid {dataset.domain} grid cells fall inside this bounding box.
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-1.5 text-xs font-mono tabular-nums">
                        <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-sans font-semibold text-slate-700">Area Slope</div>
                          <div className="font-bold text-slate-950">
                            {formatSigned(roiAnalysis.stats.slopePerDecade)}/dec
                          </div>
                        </div>
                        <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-sans font-semibold text-slate-700">Spatial ±1σ</div>
                          <div className="font-bold text-slate-950">
                            {roiAnalysis.spatialStdDev.toFixed(dataset.decimals)} {dataset.unit}
                          </div>
                        </div>
                        <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-sans font-semibold text-slate-700">MK p-Val</div>
                          <div className="font-bold text-slate-950">
                            {formatPValue(roiAnalysis.stats.pValue)}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPlotTarget('roi');
                          onChangeTab('timeplot');
                        }}
                        className="w-full px-2.5 py-1.5 text-xs font-bold rounded bg-teal-700 text-white hover:bg-teal-800 transition-colors cursor-pointer"
                      >
                        Plot Area-Weighted Regional Time Series
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {probeAnalysis ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-lg border border-slate-200 bg-white space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>Selected Coordinate</span>
                    <span className="font-mono text-slate-900">{MONTH_ABBR[month - 1]} {year}</span>
                  </div>
                  <div className="text-base font-mono font-bold text-slate-950 tabular-nums">
                    {formatCoord(probeAnalysis.lat, probeAnalysis.lon)}
                  </div>
                  <div className="text-[13px] font-medium text-slate-800">{probeAnalysis.region}</div>
                </div>

                {probeAnalysis.domainMasked ? (
                  <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/80 text-[13px] text-amber-950 space-y-1">
                    <div className="font-bold">Domain Masked Location</div>
                    <p className="leading-relaxed">
                      {dataset.name} applies only over{' '}
                      {dataset.domain === 'land' ? 'continental landmasses' : 'oceanic basins'}.
                      Click a {dataset.domain} coordinate to inspect local anomaly values.
                    </p>
                  </div>
                ) : (
                  probeAnalysis.series && (
                    <>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/80">
                          <div className="text-xs font-semibold text-slate-700">
                            {dataMode === 'historical' ? 'Observed Anomaly' : `${modeMeta.shortLabel} Anomaly`}
                          </div>
                          <div className="text-lg font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                            {formatSigned(probeAnalysis.observed)}
                            <span className="text-xs font-medium text-slate-700 ml-1">
                              {dataset.unit}
                            </span>
                          </div>
                        </div>
                        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/80">
                          <div className="text-xs font-semibold text-slate-700">
                            {getDirectionVerb(probeAnalysis.series.stats.slopePerDecade)}
                          </div>
                          <div className="text-lg font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                            {formatSigned(probeAnalysis.series.stats.slopePerDecade)}
                            <span className="text-xs font-medium text-slate-700 ml-1">
                              /dec
                            </span>
                          </div>
                        </div>
                      </div>

                      {probeAnalysis.histSeries && (
                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="p-2.5 rounded-lg border border-slate-200 bg-white">
                            <div className="text-xs font-semibold text-slate-700">Hist Slope (2005–2024)</div>
                            <div className="text-sm font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                              {formatSigned(probeAnalysis.histSeries.stats.slopePerDecade)} {dataset.unit}/dec
                            </div>
                          </div>
                          <div className="p-2.5 rounded-lg border border-blue-200 bg-blue-50/60">
                            <div className="text-xs text-[#0B3D91] font-bold">
                              {modeMeta.shortLabel} (2025–2099)
                            </div>
                            <div className="text-sm font-mono font-bold text-slate-950 tabular-nums mt-0.5">
                              {formatSigned(probeAnalysis.series.stats.slopePerDecade)} {dataset.unit}/dec
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-bold text-slate-800">
                            Local Statistical Significance
                          </span>
                          <span
                            className={`text-[13px] font-bold ${
                              probeAnalysis.series.stats.significant
                                ? 'text-emerald-800'
                                : 'text-amber-800'
                            }`}
                          >
                            {probeAnalysis.series.stats.significant
                              ? 'Significant (p < 0.05)'
                              : 'Noise (p >= 0.05)'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[13px] font-mono font-semibold text-slate-800 tabular-nums">
                          <span>
                            Z = {probeAnalysis.series.stats.zScore >= 0 ? '+' : ''}
                            {probeAnalysis.series.stats.zScore.toFixed(2)}
                          </span>
                          <span>
                            p = {formatPValue(probeAnalysis.series.stats.pValue)}
                          </span>
                          <span>
                            {horizonDeltaShort} = {formatSigned(probeAnalysis.series.stats.delta20Yr)} {dataset.unit}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setPlotTarget('probe');
                          onChangeTab('timeplot');
                        }}
                        className="w-full px-3 py-2.5 text-[13px] font-bold rounded-md bg-[#0B3D91] text-white hover:bg-[#092E6E] transition-colors cursor-pointer"
                      >
                        Plot {dataMode === 'historical' ? '20-Year' : modeMeta.shortLabel} Time Series for This Point
                      </button>
                    </>
                  )
                )}
              </div>
            ) : (
              <div className="p-6 text-center rounded-lg border border-dashed border-slate-300 text-[13px] font-medium text-slate-700">
                No coordinate probed yet. Click anywhere on the map or globe.
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeplot' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-slate-950 truncate">
                  {activePlotData.label}
                </div>
                <div className="text-xs font-medium text-slate-700">
                  {activePlotData.points.length}{' '}
                  {dataMode === 'historical'
                    ? 'Monthly Observations (2005–2024)'
                    : useFullHorizon
                    ? `Quarterly Obs + ${modeMeta.shortLabel} (2005–2099)`
                    : `Quarterly ${modeMeta.shortLabel} Projections (2025–2099)`}{' '}
                  · {dataset.unit}
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-1.5 text-xs font-bold rounded-md bg-[#0B3D91] text-white hover:bg-[#092E6E] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>

            {dataMode !== 'historical' && (
              <div
                role="group"
                aria-label="Time series horizon"
                className="grid grid-cols-2 p-0.5 bg-slate-100 rounded-md border border-slate-200"
              >
                <button
                  type="button"
                  onClick={() => setIncludeFullHorizon(false)}
                  className={`px-2 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                    !includeFullHorizon
                      ? 'bg-white text-[#0B3D91] shadow-xs'
                      : 'text-slate-800 hover:text-slate-950'
                  }`}
                >
                  Projected Only (2025–2099)
                </button>
                <button
                  type="button"
                  onClick={() => setIncludeFullHorizon(true)}
                  className={`px-2 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                    includeFullHorizon
                      ? 'bg-white text-[#0B3D91] shadow-xs'
                      : 'text-slate-800 hover:text-slate-950'
                  }`}
                >
                  Full Obs + Proj (2005–2099)
                </button>
              </div>
            )}

            {/* Series Target Switcher */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPlotTarget('driver')}
                className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer transition-colors ${
                  plotTarget === 'driver'
                    ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                    : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {effectivePoles.poleA ? 'Pole A (Surplus)' : 'Global Composite'}
              </button>
              {effectivePoles.poleB && (
                <>
                  <button
                    type="button"
                    onClick={() => setPlotTarget('poleB')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer transition-colors ${
                      plotTarget === 'poleB'
                        ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Pole B (Deficit)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlotTarget('both')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer transition-colors ${
                      plotTarget === 'both'
                        ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Pole A vs. Pole B
                  </button>
                </>
              )}
              {probeAnalysis && !probeAnalysis.domainMasked && (
                <button
                  type="button"
                  onClick={() => setPlotTarget('probe')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer transition-colors ${
                    plotTarget === 'probe'
                      ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                      : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Probed Point
                </button>
              )}
              {roiAnalysis && !roiAnalysis.domainMasked && (
                <button
                  type="button"
                  onClick={() => setPlotTarget('roi')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer transition-colors ${
                    plotTarget === 'roi'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-teal-900 border-teal-300 hover:bg-teal-50'
                  }`}
                >
                  Area ROI
                </button>
              )}
              {customCsv && (
                <button
                  type="button"
                  onClick={() => setPlotTarget('customCsv')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer transition-colors ${
                    plotTarget === 'customCsv'
                      ? 'bg-violet-700 text-white border-violet-700'
                      : 'bg-white text-violet-900 border-violet-300 hover:bg-violet-50'
                  }`}
                >
                  Imported CSV
                </button>
              )}
            </div>

            <TimeSeriesCanvas
              points={activePlotData.points}
              comparePoints={activePlotData.comparePoints}
              secondaryOverlay={
                crossCorrelation
                  ? {
                      points: crossCorrelation.points,
                      label: crossCorrelation.spec.shortName,
                      unit: crossCorrelation.spec.unit,
                      lagSteps,
                    }
                  : null
              }
              pettittMarker={activePlotData.pettitt}
              dataset={dataset}
              activeYear={year}
              activeMonth={month}
              unitOverride={activePlotData.unitOverride}
            />

            {/* Summary statistics table beneath plot */}
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/80 grid grid-cols-3 gap-2 text-center font-mono tabular-nums">
              <div>
                <div className="text-[11px] font-sans font-semibold text-slate-700">Slope / Decade</div>
                <div className="text-[13px] font-bold text-slate-950 mt-0.5">
                  {formatSigned(activePlotData.stats.slopePerDecade)}{' '}
                  {activePlotData.unitOverride ?? dataset.unit}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-sans font-semibold text-slate-700">Mann-Kendall Z</div>
                <div className="text-[13px] font-bold text-slate-950 mt-0.5">
                  {activePlotData.stats.zScore >= 0 ? '+' : ''}
                  {activePlotData.stats.zScore.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-sans font-semibold text-slate-700">p-Value</div>
                <div className="text-[13px] font-bold text-slate-950 mt-0.5">
                  {formatPValue(activePlotData.stats.pValue)}
                </div>
              </div>
            </div>

            {/* Cross-Sphere Correlation & Lag Explorer */}
            {!activePlotData.comparePoints && plotTarget !== 'customCsv' && (
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/80 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="cross-sphere-select"
                    className="flex items-center gap-1.5 text-xs font-bold text-teal-900"
                  >
                    <GitCompareArrows className="w-3.5 h-3.5" />
                    Cross-Sphere Correlation
                  </label>
                  <select
                    id="cross-sphere-select"
                    value={compareDatasetId}
                    onChange={(e) => setCompareDatasetId(e.target.value as DatasetId | 'none')}
                    className="px-2 py-1 text-xs font-semibold bg-white border border-slate-300 rounded text-slate-950 max-w-[190px] cursor-pointer"
                  >
                    <option value="none">None (Single Variable)</option>
                    {DATASETS.filter((d) => d.id !== dataset.id).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.shortName} ({d.sphere})
                      </option>
                    ))}
                  </select>
                </div>

                {crossCorrelation && (
                  <div className="space-y-2 pt-0.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800">
                        Lead / Lag:{' '}
                        <strong className="font-mono text-teal-900">
                          {lagSteps === 0
                            ? '0 steps (Sync)'
                            : lagSteps > 0
                            ? `+${lagSteps} steps (${dataset.shortName} leads)`
                            : `${lagSteps} steps (${crossCorrelation.spec.shortName} leads)`}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setLagSteps(crossCorrelation.result.optimalLagSteps)}
                        className="text-[11px] font-bold text-[#0B3D91] hover:underline cursor-pointer shrink-0"
                      >
                        Peak Lag ({crossCorrelation.result.optimalLagSteps >= 0 ? '+' : ''}
                        {crossCorrelation.result.optimalLagSteps})
                      </button>
                    </div>
                    <input
                      type="range"
                      min={-6}
                      max={6}
                      step={1}
                      value={lagSteps}
                      onChange={(e) => setLagSteps(Number(e.target.value))}
                      aria-label="Cross-sphere lag steps"
                      className="w-full nasa-slider"
                    />
                    <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-xs bg-white p-2 rounded border border-slate-200 tabular-nums">
                      <div>
                        <div className="text-[10px] font-sans font-semibold text-slate-700">Pearson r</div>
                        <div className="font-bold text-teal-900">
                          {crossCorrelation.result.r >= 0 ? '+' : ''}
                          {crossCorrelation.result.r.toFixed(3)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-sans font-semibold text-slate-700">Shared R²</div>
                        <div className="font-bold text-slate-950">
                          {(crossCorrelation.result.rSquared * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-sans font-semibold text-slate-700">p-Value</div>
                        <div className="font-bold text-slate-950">
                          {formatPValue(crossCorrelation.result.pValue)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bring Your Own NASA/NOAA CSV Analyzer */}
            <div className="p-3 rounded-lg border border-slate-200 bg-white space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-[#0B3D91]" />
                  External CSV Analyzer (Giovanni / CDO)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleLoadSampleExternalCsv}
                    className="px-2 py-1 text-[11px] font-semibold rounded border border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100 cursor-pointer"
                  >
                    Sample
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 text-[11px] font-bold rounded bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
                  >
                    Upload CSV
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleUploadCsvFile}
                  className="hidden"
                />
              </div>
              {csvError && <p className="text-xs font-semibold text-red-700">{csvError}</p>}
              {customCsv && (
                <div className="text-xs text-slate-800 flex items-center justify-between gap-2 pt-0.5">
                  <span className="truncate font-medium">
                    Loaded: <strong>{customCsv.title}</strong> ({customCsv.points.length} pts)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomCsv(null);
                      if (plotTarget === 'customCsv') setPlotTarget('driver');
                    }}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-950 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'chat' && (
          <ChatbotPanel
            messages={chatMessages}
            onChangeMessages={setChatMessages}
            dataset={dataset}
            teleconnectionId={teleconnectionId}
            dataMode={dataMode}
            year={year}
            month={month}
            driverStats={driverSeries.stats}
            poleAVal={poleAVal}
            poleBVal={poleBVal}
            poleBStats={poleBSeries ? poleBSeries.stats : null}
            historicalSlope={
              historicalBaselineSeries
                ? historicalBaselineSeries.stats.slopePerDecade
                : null
            }
            probedInfo={
              probeAnalysis
                ? {
                    lat: probeAnalysis.lat,
                    lon: probeAnalysis.lon,
                    region: probeAnalysis.region,
                    observed: probeAnalysis.observed,
                    domainMasked: probeAnalysis.domainMasked,
                    stats: probeAnalysis.series ? probeAnalysis.series.stats : null,
                  }
                : null
            }
            pendingPrompt={pendingPrompt}
            onClearPendingPrompt={() => setPendingPrompt(null)}
            pettittSummary={
              driverPettitt
                ? driverPettitt.significant
                  ? `Regime shift detected near ${driverPettitt.dateLabel} (step ${formatSigned(driverPettitt.shiftMagnitude)} ${dataset.unit}, p=${formatPValue(driverPettitt.pValue)})`
                  : `No significant abrupt break (p=${formatPValue(driverPettitt.pValue)})`
                : undefined
            }
            roiSummary={
              roiAnalysis && !roiAnalysis.domainMasked
                ? `${roiAnalysis.roi.label}: Slope ${formatSigned(roiAnalysis.stats.slopePerDecade)} ${dataset.unit}/dec, Z=${roiAnalysis.stats.zScore.toFixed(2)}, p=${formatPValue(roiAnalysis.stats.pValue)}, Spatial ±1σ=${roiAnalysis.spatialStdDev.toFixed(dataset.decimals)} ${dataset.unit}`
                : undefined
            }
            correlationSummary={
              crossCorrelation
                ? `${dataset.shortName} vs ${crossCorrelation.spec.shortName} at lag ${crossCorrelation.result.lagSteps} steps: Pearson r=${crossCorrelation.result.r.toFixed(3)} (R²=${(crossCorrelation.result.rSquared * 100).toFixed(1)}%, p=${formatPValue(crossCorrelation.result.pValue)}), peak lag=${crossCorrelation.result.optimalLagSteps} (r=${crossCorrelation.result.optimalR.toFixed(3)})`
                : undefined
            }
            customCsvSummary={
              customCsv
                ? `${customCsv.title} (${customCsv.points.length} pts): Slope=${formatSigned(customCsv.stats.slopePerDecade)} ${customCsv.unit}/dec, MK Z=${customCsv.stats.zScore.toFixed(2)}, p=${formatPValue(customCsv.stats.pValue)}`
                : undefined
            }
          />
        )}
      </div>
    </aside>
  );
};
