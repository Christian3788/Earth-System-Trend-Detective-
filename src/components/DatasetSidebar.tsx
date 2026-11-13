import React, { useMemo } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DATASETS,
  DATA_MODE_META,
  DataMode,
  DatasetId,
  DatasetSpec,
  MONTH_NAMES,
  SPHERES,
  SphereId,
  getEffectiveBounds,
} from '../data/datasets';

interface DatasetSidebarProps {
  sphere: SphereId;
  onSelectSphere: (s: SphereId) => void;
  dataset: DatasetSpec;
  onSelectDataset: (id: DatasetId) => void;
  dataMode: DataMode;
  year: number;
  onChangeYear: (y: number) => void;
  month: number;
  onChangeMonth: (m: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export const DatasetSidebar: React.FC<DatasetSidebarProps> = ({
  sphere,
  onSelectSphere,
  dataset,
  onSelectDataset,
  dataMode,
  year,
  onChangeYear,
  month,
  onChangeMonth,
  isPlaying,
  onTogglePlay,
}) => {
  const modeMeta = DATA_MODE_META[dataMode];
  const bounds = useMemo(() => getEffectiveBounds(dataset, dataMode), [dataset, dataMode]);
  const midYear = Math.round((modeMeta.yearMin + modeMeta.yearMax) / 2);
  const sphereDatasets = useMemo(
    () => DATASETS.filter((d) => d.sphere === sphere),
    [sphere]
  );

  const categories = useMemo(() => {
    const unique: string[] = [];
    for (const d of sphereDatasets) {
      if (!unique.includes(d.category)) unique.push(d.category);
    }
    return unique;
  }, [sphereDatasets]);

  const activeCategory = dataset.category;

  const categoryDatasets = useMemo(
    () => sphereDatasets.filter((d) => d.category === activeCategory),
    [sphereDatasets, activeCategory]
  );

  const handleCategoryChange = (newCat: string) => {
    const first = sphereDatasets.find((d) => d.category === newCat);
    if (first) onSelectDataset(first.id);
  };

  const formatBound = (val: number) => {
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(dataset.decimals)}`;
  };

  return (
    <aside
      aria-label="Dataset hierarchy and legend"
      className="w-full lg:w-80 xl:w-[336px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col lg:overflow-y-auto"
    >
      {/* Section 1: Sphere Selector */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            1. Earth System Sphere
          </h2>
          <span className="text-xs text-slate-400">ESDE Hierarchy</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5" role="tablist" aria-label="Earth System Spheres">
          {SPHERES.map((s) => {
            const active = sphere === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectSphere(s.id)}
                className={`px-3 py-2 text-xs font-medium rounded-md border text-left transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0B3D91] ${
                  active
                    ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 2: Dynamic Category & Mission Dataset */}
      <div className="p-4 border-b border-slate-200 space-y-3.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          2. Category &amp; Mission Dataset
        </h2>

        <div>
          <label
            htmlFor="esde-category-select"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Observable Category
          </label>
          <select
            id="esde-category-select"
            value={activeCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="w-full px-2.5 py-2 text-xs font-medium text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#0B3D91] cursor-pointer"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="esde-dataset-select"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Mission Product
          </label>
          <select
            id="esde-dataset-select"
            value={dataset.id}
            onChange={(e) => onSelectDataset(e.target.value as DatasetId)}
            className="w-full px-2.5 py-2 text-xs font-medium text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#0B3D91] cursor-pointer"
          >
            {categoryDatasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {/* Quick Switch List of all datasets within active sphere */}
        <div className="pt-1">
          <div className="text-[11px] font-medium text-slate-500 mb-1.5">
            Available in {SPHERES.find((s) => s.id === sphere)?.label}
          </div>
          <div className="space-y-1">
            {sphereDatasets.map((d) => {
              const selected = d.id === dataset.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onSelectDataset(d.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-md border text-xs transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[#0B3D91]/6 border-[#0B3D91] text-[#0B3D91] font-semibold'
                      : 'bg-slate-50/70 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="truncate">{d.name}</div>
                  <div className="text-[11px] font-normal text-slate-500 mt-0.5 truncate">
                    {d.sourceType} · {d.mission} · {d.unit}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 3: Temporal Range Controls */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            3. Temporal Selection
          </h2>
          <span className="text-xs font-mono font-semibold text-[#0B3D91] tabular-nums">
            {year}-{String(month).padStart(2, '0')}
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-slate-700 mb-1.5">
            <label htmlFor="esde-year-slider" className="font-medium">
              {dataMode === 'historical' ? 'Observation Year' : 'Projected Model Year'}
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous year"
                disabled={year <= modeMeta.yearMin}
                onClick={() => onChangeYear(Math.max(modeMeta.yearMin, year - 1))}
                className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono font-semibold text-slate-900 px-1.5 tabular-nums">
                {year}
              </span>
              <button
                type="button"
                aria-label="Next year"
                disabled={year >= modeMeta.yearMax}
                onClick={() => onChangeYear(Math.min(modeMeta.yearMax, year + 1))}
                className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <input
            id="esde-year-slider"
            type="range"
            min={modeMeta.yearMin}
            max={modeMeta.yearMax}
            step={1}
            value={year}
            onChange={(e) => onChangeYear(Number(e.target.value))}
            className="w-full nasa-slider"
          />
          <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-1 tabular-nums">
            <span>{modeMeta.yearMin}</span>
            <span>{midYear}</span>
            <span>{modeMeta.yearMax}</span>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor="esde-month-select"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Month
            </label>
            <select
              id="esde-month-select"
              value={month}
              onChange={(e) => onChangeMonth(Number(e.target.value))}
              className="w-full px-2.5 py-2 text-xs font-medium text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#0B3D91] cursor-pointer"
            >
              {MONTH_NAMES.map((mName, idx) => (
                <option key={mName} value={idx + 1}>
                  {mName}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onTogglePlay}
            className={`px-3 py-2 text-xs font-medium rounded-md border flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              isPlaying
                ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Animate
              </>
            )}
          </button>
        </div>
      </div>

      {/* Section 4: Scientific Legend & Provenance */}
      <div className="p-4 space-y-3 mt-auto bg-slate-50/60">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            4. Calibrated Legend
          </h2>
          <span className="text-xs font-mono font-semibold text-slate-700">
            Unit: {dataset.unit}
          </span>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-800 mb-1.5">
            {dataset.shortName}
          </div>
          <div
            className="h-3.5 w-full rounded border border-slate-300"
            style={{
              background:
                'linear-gradient(to right, rgb(23,55,130) 0%, rgb(37,99,235) 17%, rgb(96,165,250) 34%, rgb(248,250,252) 50%, rgb(251,191,36) 67%, rgb(239,68,68) 84%, rgb(153,27,27) 100%)',
            }}
            role="img"
            aria-label={`Diverging color bar from ${formatBound(bounds.min)} to ${formatBound(bounds.max)} ${dataset.unit}`}
          />
          <div className="flex justify-between text-[11px] font-mono text-slate-700 mt-1 tabular-nums">
            <span>{formatBound(bounds.min)}</span>
            <span>{bounds.mid.toFixed(dataset.decimals)}</span>
            <span>{formatBound(bounds.max)}</span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-0.5">
            <span>Negative Anomaly</span>
            <span>Neutral</span>
            <span>Positive Anomaly</span>
          </div>
        </div>

        <div className="pt-2.5 border-t border-slate-200 space-y-1">
          <div className="text-[11px] font-semibold text-slate-700">
            Data Provenance · {dataset.daacName}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            {dataMode === 'historical' ? dataset.citation : `${modeMeta.sourceLabel} · ${dataset.citation}`}
          </p>
          <div className="text-[11px] text-slate-500 pt-0.5">
            Baseline: <span className="font-mono">{dataset.baselinePeriod}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            Archives &amp; Tools: <span className="text-slate-700 font-medium">{dataset.portalHint}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
