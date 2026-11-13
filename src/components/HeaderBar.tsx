import React from 'react';
import { BookOpen } from 'lucide-react';
import { DataMode, TELECONNECTIONS, TeleconnectionId } from '../data/datasets';

interface HeaderBarProps {
  teleconnection: TeleconnectionId;
  onSelectTeleconnection: (id: TeleconnectionId) => void;
  dataMode: DataMode;
  onChangeDataMode: (mode: DataMode) => void;
  onOpenResources: () => void;
}

const DRIVER_ORDER: TeleconnectionId[] = ['iod', 'enso', 'arctic', 'none'];

export const HeaderBar: React.FC<HeaderBarProps> = ({
  teleconnection,
  onSelectTeleconnection,
  dataMode,
  onChangeDataMode,
  onOpenResources,
}) => {
  const isProjected = dataMode !== 'historical';

  return (
    <header className="shrink-0 bg-white border-b border-slate-200">
      {/* Primary Institutional NASA Navy Banner */}
      <div className="bg-[#0B3D91] text-white px-4 lg:px-6 h-12 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <circle cx="16" cy="16" r="14" fill="#072B66" stroke="#93C5FD" strokeWidth="1.2" />
            <path
              d="M4.5 20.5C9.5 14.5 21 10 28.5 12"
              stroke="#FC3D21"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M7 11.5C12.5 16.5 20 19 26.5 17.5"
              stroke="#FFFFFF"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeDasharray="2 2"
            />
            <circle cx="24" cy="11" r="1.6" fill="#FFFFFF" />
          </svg>
          <h1 className="text-sm sm:text-base font-semibold tracking-tight text-white truncate">
            NASA Earth System Data Explorer // Trend Detective
          </h1>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <span className="hidden md:inline text-xs text-blue-100 whitespace-nowrap font-mono tabular-nums">
            {dataMode === 'historical'
              ? 'ESDE 2.0 · Observed 2005–2024'
              : dataMode === 'rcp45'
              ? 'ESDE 2.0 · Projected RCP 4.5 (2025–2099)'
              : 'ESDE 2.0 · Projected RCP 8.5 (2025–2099)'}
          </span>
          <button
            type="button"
            onClick={onOpenResources}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-white/12 hover:bg-white/20 text-white border border-white/25 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Data Portals &amp; Methods
          </button>
        </div>
      </div>

      {/* Teleconnection Driver & Data Mode Bar */}
      <div className="bg-slate-50 px-4 lg:px-6 py-2 border-t border-[#092E6E]/10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 whitespace-nowrap mr-1">
            Teleconnection Driver:
          </span>
          <div
            role="group"
            aria-label="Teleconnection driver presets"
            className="flex flex-wrap items-center gap-1.5"
          >
            {DRIVER_ORDER.map((id) => {
              const spec = TELECONNECTIONS[id];
              const active = teleconnection === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectTeleconnection(id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B3D91] ${
                    active
                      ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-[#0B3D91]/60 hover:text-[#0B3D91]'
                  }`}
                >
                  {spec.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Historical vs Projected (RCP 4.5 / 8.5) Data Mode Switch */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">
            Data Mode:
          </span>
          <div
            role="group"
            aria-label="Climate data mode"
            className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-md border border-slate-300"
          >
            <button
              type="button"
              onClick={() => onChangeDataMode('historical')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !isProjected
                  ? 'bg-white text-[#0B3D91] shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Historical (2005–2024)
            </button>
            <button
              type="button"
              onClick={() => onChangeDataMode(isProjected ? dataMode : 'rcp45')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isProjected
                  ? 'bg-[#0B3D91] text-white shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Projected (2025–2099)
            </button>
          </div>

          {isProjected && (
            <div
              role="group"
              aria-label="Representative Concentration Pathway"
              className="inline-flex items-center p-0.5 bg-white rounded-md border border-slate-300"
            >
              <button
                type="button"
                onClick={() => onChangeDataMode('rcp45')}
                className={`px-2 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dataMode === 'rcp45'
                    ? 'bg-amber-600 text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                RCP 4.5
              </button>
              <button
                type="button"
                onClick={() => onChangeDataMode('rcp85')}
                className={`px-2 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dataMode === 'rcp85'
                    ? 'bg-red-700 text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                RCP 8.5
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
