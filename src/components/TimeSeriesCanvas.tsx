import React, { useEffect, useRef, useState } from 'react';
import { DatasetSpec } from '../data/datasets';
import { PettittResult, TimeSeriesPoint } from '../engine/statistics';

export interface SecondaryOverlaySpec {
  points: TimeSeriesPoint[];
  label: string;
  unit: string;
  lagSteps: number;
}

interface TimeSeriesCanvasProps {
  points: TimeSeriesPoint[];
  comparePoints?: TimeSeriesPoint[] | null;
  secondaryOverlay?: SecondaryOverlaySpec | null;
  pettittMarker?: PettittResult | null;
  dataset: DatasetSpec;
  activeYear: number;
  activeMonth: number;
  unitOverride?: string;
}

export const TimeSeriesCanvas: React.FC<TimeSeriesCanvasProps> = ({
  points,
  comparePoints,
  secondaryOverlay,
  pettittMarker,
  dataset,
  activeYear,
  activeMonth,
  unitOverride,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const activeIdx = React.useMemo(() => {
    if (points.length === 0) return 0;
    const targetVal = activeYear * 12 + activeMonth;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs(points[i].year * 12 + points[i].month - targetVal);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [points, activeYear, activeMonth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length === 0) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const cssW = Math.max(260, Math.floor(rect.width));
      const cssH = 240;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, cssW, cssH);

      const padL = 46;
      const padR = 14;
      const padT = 16;
      const padB = 28;
      const plotW = cssW - padL - padR;
      const plotH = cssH - padT - padB;

      let minY = 0;
      let maxY = 0;
      for (const p of points) {
        if (p.raw < minY) minY = p.raw;
        if (p.raw > maxY) maxY = p.raw;
        if (p.theilSen < minY) minY = p.theilSen;
        if (p.theilSen > maxY) maxY = p.theilSen;
      }
      if (comparePoints) {
        for (const p of comparePoints) {
          if (p.raw < minY) minY = p.raw;
          if (p.raw > maxY) maxY = p.raw;
          if (p.theilSen < minY) minY = p.theilSen;
          if (p.theilSen > maxY) maxY = p.theilSen;
        }
      }

      const span = Math.max(maxY - minY, Math.abs(dataset.max - dataset.min) * 0.25, 1e-4);
      const yMin = minY - span * 0.12;
      const yMax = maxY + span * 0.12;

      const xFor = (idx: number) => padL + (idx / (points.length - 1)) * plotW;
      const yFor = (val: number) => padT + ((yMax - val) / (yMax - yMin)) * plotH;

      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(padL, padT, plotW, plotH);

      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const val = yMin + ((yMax - yMin) * i) / 4;
        const py = yFor(val);
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, py);
        ctx.lineTo(padL + plotW, py);
        ctx.stroke();

        ctx.fillStyle = '#334155';
        ctx.fillText(val.toFixed(dataset.decimals), padL - 6, py + 4);
      }

      if (0 > yMin && 0 < yMax) {
        const y0 = yFor(0);
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, y0);
        ctx.lineTo(padL + plotW, y0);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.textAlign = 'center';
      const firstYear = points[0].year;
      const lastYear = points[points.length - 1].year;
      const labelYears =
        lastYear <= 2024
          ? [2005, 2010, 2015, 2020, 2024]
          : firstYear >= 2025
          ? [2025, 2040, 2060, 2080, 2099]
          : [2005, 2024, 2050, 2075, 2099];

      for (const yr of labelYears) {
        let idx = points.findIndex((pt) => pt.year >= yr);
        if (idx === -1) idx = points.length - 1;
        const px = xFor(idx);
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT + plotH);
        ctx.stroke();

        ctx.fillStyle = '#334155';
        ctx.fillText(String(yr), px, padT + plotH + 16);
      }

      // Regime boundary marker when viewing full 2005-2099 trajectory
      if (firstYear <= 2024 && lastYear >= 2025) {
        const boundaryIdx = points.findIndex((pt) => pt.year >= 2025);
        if (boundaryIdx > 0) {
          const bx = xFor(boundaryIdx - 0.5);
          ctx.save();
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(bx, padT);
          ctx.lineTo(bx, padT + plotH);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#1E293B';
          ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('Proj →', bx + 4, padT + 12);
          ctx.textAlign = 'right';
          ctx.fillText('← Obs', bx - 4, padT + 12);
          ctx.restore();
        }
      }

      // Pettitt change-point regime shift marker
      if (pettittMarker && pettittMarker.significant && pettittMarker.index > 1 && pettittMarker.index < points.length - 1) {
        const pxShift = xFor(pettittMarker.index);
        ctx.save();
        ctx.strokeStyle = '#7C3AED';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(pxShift, padT);
        ctx.lineTo(pxShift, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        const tag = `Shift ${pettittMarker.dateLabel}`;
        ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        const tw = ctx.measureText(tag).width + 8;
        const alignRight = pxShift + tw + 6 > padL + plotW;
        const rx = alignRight ? pxShift - tw - 3 : pxShift + 3;
        ctx.fillStyle = 'rgba(124, 58, 237, 0.92)';
        ctx.fillRect(rx, padT + 2, tw, 15);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.fillText(tag, rx + 4, padT + 13);
        ctx.restore();
      }

      const actX = xFor(activeIdx);
      ctx.strokeStyle = 'rgba(11, 61, 145, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(actX, padT);
      ctx.lineTo(actX, padT + plotH);
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, plotW, plotH);
      ctx.clip();

      if (comparePoints && comparePoints.length === points.length) {
        // Pole B raw subtle trace
        ctx.strokeStyle = 'rgba(234, 88, 12, 0.32)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < comparePoints.length; i++) {
          const px = xFor(i);
          const py = yFor(comparePoints[i].raw);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Pole B LOESS
        ctx.strokeStyle = '#EA580C';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < comparePoints.length; i++) {
          const px = xFor(i);
          const py = yFor(comparePoints[i].loess);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Pole B Theil-Sen trendline
        ctx.strokeStyle = '#9A3412';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(xFor(0), yFor(comparePoints[0].theilSen));
        ctx.lineTo(
          xFor(comparePoints.length - 1),
          yFor(comparePoints[comparePoints.length - 1].theilSen)
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Primary Raw Monthly Observations
      ctx.strokeStyle = comparePoints ? 'rgba(6, 182, 212, 0.38)' : '#94A3B8';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const px = xFor(i);
        const py = yFor(points[i].raw);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Primary LOESS Seasonal Smoothing Curve
      ctx.strokeStyle = comparePoints ? '#0891B2' : '#0B3D91';
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const px = xFor(i);
        const py = yFor(points[i].loess);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Primary Theil-Sen Slope Trendline
      ctx.strokeStyle = comparePoints ? '#0B3D91' : '#DC2626';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xFor(0), yFor(points[0].theilSen));
      ctx.lineTo(xFor(points.length - 1), yFor(points[points.length - 1].theilSen));
      ctx.stroke();
      ctx.setLineDash([]);

      // Secondary Cross-Sphere Correlated Variable (z-score mapped onto primary plot range)
      if (secondaryOverlay && secondaryOverlay.points.length === points.length && !comparePoints) {
        const secVals = secondaryOverlay.points.map((p) => p.loess);
        const secMean = secVals.reduce((s, v) => s + v, 0) / secVals.length;
        const secStd = Math.max(
          1e-6,
          Math.sqrt(secVals.reduce((s, v) => s + (v - secMean) * (v - secMean), 0) / secVals.length)
        );
        const priVals = points.map((p) => p.loess);
        const priMean = priVals.reduce((s, v) => s + v, 0) / priVals.length;
        const priStd = Math.max(
          1e-6,
          Math.sqrt(priVals.reduce((s, v) => s + (v - priMean) * (v - priMean), 0) / priVals.length)
        );

        ctx.strokeStyle = '#0D9488';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < points.length; i++) {
          const srcIdx = i + secondaryOverlay.lagSteps;
          if (srcIdx < 0 || srcIdx >= secondaryOverlay.points.length) continue;
          const zVal = (secondaryOverlay.points[srcIdx].loess - secMean) / secStd;
          const mappedY = priMean + zVal * priStd;
          const px = xFor(i);
          const py = yFor(mappedY);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }

      ctx.fillStyle = comparePoints ? '#0891B2' : '#0B3D91';
      ctx.beginPath();
      ctx.arc(actX, yFor(points[activeIdx].loess), 3.5, 0, Math.PI * 2);
      ctx.fill();

      if (hoverIdx !== null && points[hoverIdx]) {
        const hp = points[hoverIdx];
        const hx = xFor(hoverIdx);
        const hy = yFor(hp.raw);

        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, padT);
        ctx.lineTo(hx, padT + plotH);
        ctx.stroke();

        ctx.fillStyle = '#06B6D4';
        ctx.beginPath();
        ctx.arc(hx, yFor(hp.loess), 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.arc(hx, hy, 3, 0, Math.PI * 2);
        ctx.fill();

        if (comparePoints && comparePoints[hoverIdx]) {
          ctx.fillStyle = '#EA580C';
          ctx.beginPath();
          ctx.arc(hx, yFor(comparePoints[hoverIdx].loess), 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();

      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1;
      ctx.strokeRect(padL, padT, plotW, plotH);

      ctx.restore();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [points, comparePoints, secondaryOverlay, pettittMarker, dataset, activeIdx, hoverIdx]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 46;
    const padR = 14;
    const plotW = rect.width - padL - padR;
    const relX = e.clientX - rect.left - padL;
    if (relX < 0 || relX > plotW) {
      setHoverIdx(null);
      return;
    }
    const idx = Math.round((relX / plotW) * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const inspectPt = hoverIdx !== null ? points[hoverIdx] : points[activeIdx];
  const inspectCompare =
    comparePoints && (hoverIdx !== null ? comparePoints[hoverIdx] : comparePoints[activeIdx]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="w-full">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          className="w-full h-[240px] block cursor-crosshair rounded border border-slate-200"
        />
      </div>

      {inspectPt && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded text-xs font-mono tabular-nums text-slate-800">
          <span className="font-bold text-slate-950">
            {hoverIdx !== null ? 'Inspect:' : 'Selected:'} {inspectPt.dateLabel}
          </span>
          {inspectCompare ? (
            <div className="flex items-center gap-3">
              <span>
                Pole A:{' '}
                <strong className="text-cyan-800">
                  {inspectPt.loess >= 0 ? '+' : ''}
                  {inspectPt.loess.toFixed(dataset.decimals)}
                </strong>
              </span>
              <span>
                Pole B:{' '}
                <strong className="text-orange-800">
                  {inspectCompare.loess >= 0 ? '+' : ''}
                  {inspectCompare.loess.toFixed(dataset.decimals)}
                </strong>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span>
                Raw:{' '}
                <strong className="text-slate-950">
                  {inspectPt.raw >= 0 ? '+' : ''}
                  {inspectPt.raw.toFixed(dataset.decimals)}
                </strong>
              </span>
              <span>
                LOESS:{' '}
                <strong className="text-[#0B3D91]">
                  {inspectPt.loess >= 0 ? '+' : ''}
                  {inspectPt.loess.toFixed(dataset.decimals)}
                </strong>
              </span>
              <span>
                Trend:{' '}
                <strong className="text-[#DC2626]">
                  {inspectPt.theilSen >= 0 ? '+' : ''}
                  {inspectPt.theilSen.toFixed(dataset.decimals)}
                </strong>
              </span>
            </div>
          )}
        </div>
      )}

      {comparePoints ? (
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-800 px-0.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-[#0891B2] inline-block" aria-hidden="true" />
            Pole A LOESS (Surplus)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-[#EA580C] inline-block" aria-hidden="true" />
            Pole B LOESS (Deficit)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 border-t-2 border-dashed border-slate-700 inline-block" aria-hidden="true" />
            Theil-Sen Slopes
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3.5 text-xs font-medium text-slate-800 px-0.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-slate-500 inline-block" aria-hidden="true" />
            {points[points.length - 1]?.year > 2024 ? 'Raw Samples' : 'Raw Monthly'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-[#0B3D91] inline-block" aria-hidden="true" />
            LOESS ({unitOverride ?? dataset.unit})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 border-t-2 border-dashed border-[#DC2626] inline-block" aria-hidden="true" />
            Theil-Sen Slope
          </span>
          {secondaryOverlay && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-teal-800">
              <span className="w-3.5 h-0.5 bg-[#0D9488] inline-block" aria-hidden="true" />
              {secondaryOverlay.label} (z-scaled)
            </span>
          )}
          {pettittMarker?.significant && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-violet-800">
              <span className="w-3.5 h-0.5 border-t-2 border-dashed border-[#7C3AED] inline-block" aria-hidden="true" />
              Regime Shift ({pettittMarker.dateLabel})
            </span>
          )}
        </div>
      )}
    </div>
  );
};
