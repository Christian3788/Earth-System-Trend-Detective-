import React, { useMemo, useState } from 'react';
import { Download, Crosshair, TrendingUp, BarChart3, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  DatasetSpec,
  MONTH_ABBR,
  TELECONNECTIONS,
  TeleconnectionId,
  getEffectivePoles,
} from '../data/datasets';
import { formatCoord, getRegionName } from '../data/worldCoastlines';
import {
  generateOpposingPoleSeries,
  generatePointTimeSeries,
  sampleAnomalyAt,
} from '../engine/earthData';
import {
  TimeSeriesPoint,
  TrendAnalysisResult,
  formatPValue,
} from '../engine/statistics';
import { TimeSeriesCanvas } from './TimeSeriesCanvas';

export type AnalysisTab = 'detective' | 'identify' | 'timeplot';

interface AnalysisPanelProps {
  activeTab: AnalysisTab;
  onChangeTab: (t: AnalysisTab) => void;
  dataset: DatasetSpec;
  teleconnectionId: TeleconnectionId;
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
}

type PlotTarget = 'driver' | 'poleB' | 'both' | 'probe';

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  activeTab,
  onChangeTab,
  dataset,
  teleconnectionId,
  year,
  month,
  driverSeries,
  probedPoint,
  onSelectProbeCoord,
}) => {
  const [plotTarget, setPlotTarget] = useState<PlotTarget>('driver');

  const tele = TELECONNECTIONS[teleconnectionId];
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
      month
    );
  }, [dataset, teleconnectionId, effectivePoles, year, month]);

  const poleBVal = useMemo(() => {
    if (!effectivePoles.poleB) return null;
    return sampleAnomalyAt(
      dataset,
      teleconnectionId,
      effectivePoles.poleB.lat,
      effectivePoles.poleB.lon,
      year,
      month
    );
  }, [dataset, teleconnectionId, effectivePoles, year, month]);

  // Pole B 20-year statistical series
  const poleBSeries = useMemo(
    () => generateOpposingPoleSeries(dataset, teleconnectionId),
    [dataset, teleconnectionId]
  );

  // Probed point inspection & 20-year statistics
  const probeAnalysis = useMemo(() => {
    if (!probedPoint) return null;
    const observed = sampleAnomalyAt(
      dataset,
      teleconnectionId,
      probedPoint.lat,
      probedPoint.lon,
      year,
      month
    );
    const domainMasked = Number.isNaN(observed);
    const series = domainMasked
      ? null
      : generatePointTimeSeries(dataset, teleconnectionId, probedPoint.lat, probedPoint.lon);

    return {
      lat: probedPoint.lat,
      lon: probedPoint.lon,
      region: getRegionName(probedPoint.lat, probedPoint.lon),
      observed,
      domainMasked,
      series,
    };
  }, [probedPoint, dataset, teleconnectionId, year, month]);

  // Resolve active Time Plot series
  const activePlotData = useMemo(() => {
    if (plotTarget === 'probe' && probeAnalysis && !probeAnalysis.domainMasked && probeAnalysis.series) {
      return {
        label: `Probed Point (${formatCoord(probeAnalysis.lat, probeAnalysis.lon)})`,
        points: probeAnalysis.series.points,
        comparePoints: null,
        stats: probeAnalysis.series.stats,
      };
    }
    if (plotTarget === 'poleB' && effectivePoles.poleB && poleBSeries) {
      return {
        label: effectivePoles.poleB.name,
        points: poleBSeries.points,
        comparePoints: null,
        stats: poleBSeries.stats,
      };
    }
    if (plotTarget === 'both' && effectivePoles.poleA && effectivePoles.poleB && poleBSeries) {
      return {
        label: `Opposing Poles: ${effectivePoles.poleA.regionLabel} vs. ${effectivePoles.poleB.regionLabel}`,
        points: driverSeries.points,
        comparePoints: poleBSeries.points,
        stats: driverSeries.stats,
      };
    }
    return {
      label: effectivePoles.poleA ? effectivePoles.poleA.name : 'Global Sampling Composite',
      points: driverSeries.points,
      comparePoints: null,
      stats: driverSeries.stats,
    };
  }, [plotTarget, probeAnalysis, effectivePoles, poleBSeries, driverSeries]);

  const formatSigned = (val: number, dec = dataset.decimals) => {
    const sign = val >= 0 ? '+' : '';
    return `${sign}${val.toFixed(dec)}`;
  };

  const getDirectionVerb = (val: number) =>
    val >= 0 ? dataset.directionTerms[0] : dataset.directionTerms[1];

  const handleExportCsv = () => {
    const { points, stats, label } = activePlotData;
    const headerLines = [
      `# NASA Earth System Data Explorer - Trend Detective Export`,
      `# Dataset: ${dataset.name} (${dataset.sourceType}, ${dataset.mission})`,
      `# Teleconnection Driver: ${tele.label}`,
      `# Target Series: ${label}`,
      `# Unit: ${dataset.unit}`,
      `# Theil-Sen Slope: ${formatSigned(stats.slopePerDecade, dataset.decimals + 1)} ${dataset.unit}/decade`,
      `# 20-Year Delta (2005-2024): ${formatSigned(stats.delta20Yr, dataset.decimals + 1)} ${dataset.unit}`,
      `# Mann-Kendall Z-Score: ${stats.zScore.toFixed(3)}`,
      `# Mann-Kendall p-Value: ${stats.pValue.toExponential(4)}`,
      `Date,Year,Month,Raw_Anomaly,LOESS_Smoothed,Theil_Sen_Trend,Unit`,
    ];

    const rows = points.map(
      (pt) =>
        `${pt.dateLabel},${pt.year},${pt.month},${pt.raw.toFixed(4)},${pt.loess.toFixed(4)},${pt.theilSen.toFixed(4)},${dataset.unit}`
    );

    const csv = [...headerLines, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nasa_esde_${dataset.id}_${teleconnectionId}_2005_2024.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const { stats } = driverSeries;

  return (
    <aside
      aria-label="NASA ESDE Analysis and Trend Detective suite"
      className="w-full lg:w-[376px] xl:w-[404px] shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-slate-200 flex flex-col lg:overflow-hidden"
    >
      {/* Tab Navigation Bar */}
      <div
        role="tablist"
        aria-label="Analysis suite tabs"
        className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 shrink-0"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'detective'}
          onClick={() => onChangeTab('detective')}
          className={`px-3 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'detective'
              ? 'border-[#0B3D91] text-[#0B3D91] bg-white'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5 shrink-0" />
          Trend Detective
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'identify'}
          onClick={() => onChangeTab('identify')}
          className={`px-3 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'identify'
              ? 'border-[#0B3D91] text-[#0B3D91] bg-white'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5 shrink-0" />
          Identify Point
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'timeplot'}
          onClick={() => onChangeTab('timeplot')}
          className={`px-3 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'timeplot'
              ? 'border-[#0B3D91] text-[#0B3D91] bg-white'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 shrink-0" />
          Time Plot
        </button>
      </div>

      {/* Scrollable Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'detective' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Automated Trend Detective Report</span>
              <span className="font-mono tabular-nums">N = {stats.n} mo</span>
            </div>

            {/* Q1: What is changing */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0B3D91]">
                01. What Is Changing
              </div>
              <div className="text-sm font-semibold text-slate-900">{dataset.name}</div>
              <div className="text-xs text-slate-600">
                <span>{dataset.sourceType}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>Unit: <span className="font-mono font-medium text-slate-800">{dataset.unit}</span></span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>Driver: <span className="font-medium text-slate-800">{tele.label}</span></span>
              </div>
              <p className="text-xs leading-relaxed text-slate-600 pt-1">
                {tele.id === 'none' ? dataset.physicalSummary : tele.mechanism}
              </p>
            </div>

            {/* Q2: Where it is changing */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0B3D91]">
                02. Where It Is Changing
              </div>
              <div className="text-xs text-slate-700 font-mono tabular-nums">
                {tele.boundingCoords}
              </div>

              {effectivePoles.poleA && effectivePoles.poleB ? (
                <div className="space-y-2 pt-1">
                  <div className="text-[11px] text-slate-500">
                    Same physical process drives opposite regional responses:
                  </div>
                  <div className="p-2.5 rounded border border-slate-200 bg-white flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-cyan-700 truncate">
                        {effectivePoles.poleA.name}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {formatCoord(effectivePoles.poleA.lat, effectivePoles.poleA.lon)}
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {poleAVal !== null && !Number.isNaN(poleAVal)
                        ? `${formatSigned(poleAVal)} ${dataset.unit}`
                        : '—'}
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-slate-200 bg-white flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-orange-700 truncate">
                        {effectivePoles.poleB.name}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {formatCoord(effectivePoles.poleB.lat, effectivePoles.poleB.lon)}
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {poleBVal !== null && !Number.isNaN(poleBVal)
                        ? `${formatSigned(poleBVal)} ${dataset.unit}`
                        : '—'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-600 pt-0.5">
                  Composite baseline sampled across representative planetary climate bands ({formatCoord(driverSeries.targetLat, driverSeries.targetLon)} primary index).
                </div>
              )}
            </div>

            {/* Q3: How much */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0B3D91]">
                03. How Much (2005–2024)
              </div>
              {effectivePoles.poleA && effectivePoles.poleB && poleBSeries ? (
                <div className="space-y-2">
                  <div className="p-2.5 rounded border border-slate-200 bg-white space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-cyan-700">Pole A · {getDirectionVerb(stats.slopePerDecade)}</span>
                      <span className="font-mono text-slate-500">Δ {formatSigned(stats.delta20Yr)} {dataset.unit}</span>
                    </div>
                    <div className="text-base font-mono font-bold text-slate-900 tabular-nums">
                      {formatSigned(stats.slopePerDecade, dataset.decimals)}
                      <span className="text-[11px] font-normal text-slate-500 ml-1">
                        {dataset.unit} / decade
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-slate-200 bg-white space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-orange-700">Pole B · {getDirectionVerb(poleBSeries.stats.slopePerDecade)}</span>
                      <span className="font-mono text-slate-500">Δ {formatSigned(poleBSeries.stats.delta20Yr)} {dataset.unit}</span>
                    </div>
                    <div className="text-base font-mono font-bold text-slate-900 tabular-nums">
                      {formatSigned(poleBSeries.stats.slopePerDecade, dataset.decimals)}
                      <span className="text-[11px] font-normal text-slate-500 ml-1">
                        {dataset.unit} / decade
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-[11px] text-slate-500">20-Year Total Delta</div>
                    <div className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-0.5">
                      {formatSigned(stats.delta20Yr, dataset.decimals)}
                      <span className="text-[11px] font-normal text-slate-500 ml-1">
                        {dataset.unit}
                      </span>
                    </div>
                  </div>
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-[11px] text-slate-500">Theil-Sen Slope</div>
                    <div className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-0.5">
                      {formatSigned(stats.slopePerDecade, dataset.decimals)}
                      <span className="text-[11px] font-normal text-slate-500 ml-1">
                        /dec
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Q4: Is it significant */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0B3D91]">
                  04. Is It Significant? (Mann-Kendall)
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    stats.significant ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {stats.significant ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5" />
                  )}
                  {stats.significant ? 'Significant' : 'Non-Significant'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded border border-slate-200 bg-white">
                  <div className="text-[11px] text-slate-500">
                    {effectivePoles.poleA ? 'Pole A Z / p-Value' : 'Mann-Kendall Z'}
                  </div>
                  <div className="text-sm font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                    {stats.zScore >= 0 ? '+' : ''}
                    {stats.zScore.toFixed(2)} · p {formatPValue(stats.pValue)}
                  </div>
                </div>
                {effectivePoles.poleB && poleBSeries ? (
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-[11px] text-slate-500">Pole B Z / p-Value</div>
                    <div className="text-sm font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {poleBSeries.stats.zScore >= 0 ? '+' : ''}
                      {poleBSeries.stats.zScore.toFixed(2)} · p {formatPValue(poleBSeries.stats.pValue)}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-[11px] text-slate-500">Two-Tailed p-Value</div>
                    <div className="text-sm font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {formatPValue(stats.pValue)}
                    </div>
                  </div>
                )}
              </div>

              {/* 4-Tier Confidence Meter */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">4-Tier Confidence Meter</span>
                  <span className="font-mono text-[11px] font-semibold text-slate-800">
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
                <div className="text-xs font-medium text-slate-700">
                  {stats.confidenceLabel}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'identify' && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 leading-relaxed">
              Click any coordinate on the 2D planar map or 3D globe to inspect local satellite observations and compute a point-level Mann-Kendall significance test.
            </div>

            {effectivePoles.poleA && effectivePoles.poleB && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onSelectProbeCoord(effectivePoles.poleA!.lat, effectivePoles.poleA!.lon)}
                  className="px-2.5 py-2 text-xs font-medium rounded-md border border-slate-200 bg-white text-cyan-800 hover:bg-cyan-50/70 transition-colors cursor-pointer whitespace-nowrap truncate"
                >
                  Probe Pole A
                </button>
                <button
                  type="button"
                  onClick={() => onSelectProbeCoord(effectivePoles.poleB!.lat, effectivePoles.poleB!.lon)}
                  className="px-2.5 py-2 text-xs font-medium rounded-md border border-slate-200 bg-white text-orange-800 hover:bg-orange-50/70 transition-colors cursor-pointer whitespace-nowrap truncate"
                >
                  Probe Pole B
                </button>
              </div>
            )}

            {probeAnalysis ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-lg border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Selected Coordinate</span>
                    <span className="font-mono">{MONTH_ABBR[month - 1]} {year}</span>
                  </div>
                  <div className="text-base font-mono font-bold text-slate-900 tabular-nums">
                    {formatCoord(probeAnalysis.lat, probeAnalysis.lon)}
                  </div>
                  <div className="text-xs text-slate-600">{probeAnalysis.region}</div>
                </div>

                {probeAnalysis.domainMasked ? (
                  <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 text-xs text-amber-900 space-y-1">
                    <div className="font-semibold">Domain Masked Location</div>
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
                        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70">
                          <div className="text-[11px] text-slate-500">Observed Anomaly</div>
                          <div className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-0.5">
                            {formatSigned(probeAnalysis.observed)}
                            <span className="text-[11px] font-normal text-slate-500 ml-1">
                              {dataset.unit}
                            </span>
                          </div>
                        </div>
                        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70">
                          <div className="text-[11px] text-slate-500">
                            {getDirectionVerb(probeAnalysis.series.stats.slopePerDecade)}
                          </div>
                          <div className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-0.5">
                            {formatSigned(probeAnalysis.series.stats.slopePerDecade)}
                            <span className="text-[11px] font-normal text-slate-500 ml-1">
                              /dec
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-700">
                            Local Statistical Significance
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              probeAnalysis.series.stats.significant
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {probeAnalysis.series.stats.significant
                              ? 'Significant (p < 0.05)'
                              : 'Noise (p >= 0.05)'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs font-mono text-slate-600 tabular-nums">
                          <span>
                            Z = {probeAnalysis.series.stats.zScore >= 0 ? '+' : ''}
                            {probeAnalysis.series.stats.zScore.toFixed(2)}
                          </span>
                          <span>
                            p = {formatPValue(probeAnalysis.series.stats.pValue)}
                          </span>
                          <span>
                            20-Yr Δ = {formatSigned(probeAnalysis.series.stats.delta20Yr)} {dataset.unit}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setPlotTarget('probe');
                          onChangeTab('timeplot');
                        }}
                        className="w-full px-3 py-2 text-xs font-semibold rounded-md bg-[#0B3D91] text-white hover:bg-[#092E6E] transition-colors cursor-pointer"
                      >
                        Plot 20-Year Time Series for This Point
                      </button>
                    </>
                  )
                )}
              </div>
            ) : (
              <div className="p-6 text-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500">
                No coordinate probed yet. Click anywhere on the map or globe.
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeplot' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {activePlotData.label}
                </div>
                <div className="text-[11px] text-slate-500">
                  240 Monthly Observations (2005–2024) · {dataset.unit}
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[#0B3D91] text-white hover:bg-[#092E6E] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>

            {/* Series Target Switcher */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPlotTarget('driver')}
                className={`px-2.5 py-1 text-xs font-medium rounded border cursor-pointer transition-colors ${
                  plotTarget === 'driver'
                    ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {effectivePoles.poleA ? 'Pole A (Surplus)' : 'Global Composite'}
              </button>
              {effectivePoles.poleB && (
                <>
                  <button
                    type="button"
                    onClick={() => setPlotTarget('poleB')}
                    className={`px-2.5 py-1 text-xs font-medium rounded border cursor-pointer transition-colors ${
                      plotTarget === 'poleB'
                        ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Pole B (Deficit)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlotTarget('both')}
                    className={`px-2.5 py-1 text-xs font-medium rounded border cursor-pointer transition-colors ${
                      plotTarget === 'both'
                        ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
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
                  className={`px-2.5 py-1 text-xs font-medium rounded border cursor-pointer transition-colors ${
                    plotTarget === 'probe'
                      ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Probed Point
                </button>
              )}
            </div>

            <TimeSeriesCanvas
              points={activePlotData.points}
              comparePoints={activePlotData.comparePoints}
              dataset={dataset}
              activeYear={year}
              activeMonth={month}
            />

            {/* Summary statistics table beneath plot */}
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 grid grid-cols-3 gap-2 text-center font-mono tabular-nums">
              <div>
                <div className="text-[10px] font-sans text-slate-500">Slope / Decade</div>
                <div className="text-xs font-bold text-slate-900 mt-0.5">
                  {formatSigned(activePlotData.stats.slopePerDecade)} {dataset.unit}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-sans text-slate-500">Mann-Kendall Z</div>
                <div className="text-xs font-bold text-slate-900 mt-0.5">
                  {activePlotData.stats.zScore >= 0 ? '+' : ''}
                  {activePlotData.stats.zScore.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-sans text-slate-500">p-Value</div>
                <div className="text-xs font-bold text-slate-900 mt-0.5">
                  {formatPValue(activePlotData.stats.pValue)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
