import React from 'react';
import { BookOpen, Compass, MessageSquare } from 'lucide-react';
import { DataMode, TELECONNECTIONS, TeleconnectionId } from '../data/datasets';
import trendDetectiveLogo from '../assets/images/trend_detective_logo_1794597112868.jpg';

interface HeaderBarProps {
  teleconnection: TeleconnectionId;
  onSelectTeleconnection: (id: TeleconnectionId) => void;
  dataMode: DataMode;
  onChangeDataMode: (mode: DataMode) => void;
  onOpenResources: () => void;
  onOpenChat: () => void;
  onOpenCaseFiles: () => void;
  activeCaseActive?: boolean;
}

const DRIVER_ORDER: TeleconnectionId[] = ['iod', 'enso', 'arctic', 'none'];

export const HeaderBar: React.FC<HeaderBarProps> = ({
  teleconnection,
  onSelectTeleconnection,
  dataMode,
  onChangeDataMode,
  onOpenResources,
  onOpenChat,
  onOpenCaseFiles,
  activeCaseActive = false,
}) => {
  const isProjected = dataMode !== 'historical';

  return (
    <header className="shrink-0 bg-white border-b border-slate-200">
      {/* Primary Institutional NASA Navy Banner */}
      <div className="bg-[#0B3D91] text-white px-4 lg:px-6 h-12 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src={trendDetectiveLogo}
            alt="NASA Earth System Data Explorer Trend Detective Emblem"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full object-cover shrink-0 border border-white/25"
          />
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-white truncate">
            NASA Earth System Data Explorer // Trend Detective
          </h1>
        </div>

        <div className="flex items-center gap-3.5 shrink-0">
          <span className="hidden md:inline text-xs sm:text-[13px] font-medium text-blue-50 whitespace-nowrap font-mono tabular-nums">
            {dataMode === 'historical'
              ? 'ESDE 2.0 · Observed 2005–2024'
              : dataMode === 'rcp45'
              ? 'ESDE 2.0 · Projected RCP 4.5 (2025–2099)'
              : 'ESDE 2.0 · Projected RCP 8.5 (2025–2099)'}
          </span>
          <button
            type="button"
            onClick={onOpenCaseFiles}
            className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer border ${
              activeCaseActive
                ? 'bg-cyan-400 text-slate-950 border-cyan-300 hover:bg-cyan-300'
                : 'bg-white/15 hover:bg-white/25 text-white border-white/35'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            Case Files
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            className="px-3 py-1.5 text-[13px] font-semibold rounded-md bg-white text-[#0B3D91] hover:bg-blue-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Detective AI
          </button>
          <button
            type="button"
            onClick={onOpenResources}
            className="px-3 py-1.5 text-[13px] font-semibold rounded-md bg-white/15 hover:bg-white/25 text-white border border-white/35 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Data Portals &amp; Methods
          </button>
        </div>
      </div>

      {/* Teleconnection Driver & Data Mode Bar */}
      <div className="bg-slate-50 px-4 lg:px-6 py-2 border-t border-[#092E6E]/10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-slate-800 whitespace-nowrap mr-1">
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
                  className={`px-2.5 py-1.5 text-[13px] font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B3D91] ${
                    active
                      ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                      : 'bg-white text-slate-800 border-slate-300 hover:border-[#0B3D91]/70 hover:text-[#0B3D91]'
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
          <span className="text-[13px] font-bold text-slate-800 whitespace-nowrap">
            Data Mode:
          </span>
          <div
            role="group"
            aria-label="Climate data mode"
            className="inline-flex items-center p-0.5 bg-slate-200/80 rounded-md border border-slate-300"
          >
            <button
              type="button"
              onClick={() => onChangeDataMode('historical')}
              className={`px-2.5 py-1 text-[13px] font-semibold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !isProjected
                  ? 'bg-white text-[#0B3D91] shadow-xs'
                  : 'text-slate-800 hover:text-slate-950'
              }`}
            >
              Historical (2005–2024)
            </button>
            <button
              type="button"
              onClick={() => onChangeDataMode(isProjected ? dataMode : 'rcp45')}
              className={`px-2.5 py-1 text-[13px] font-semibold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isProjected
                  ? 'bg-[#0B3D91] text-white shadow-xs'
                  : 'text-slate-800 hover:text-slate-950'
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
                className={`px-2.5 py-1 text-xs font-mono font-bold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dataMode === 'rcp45'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-800 hover:text-slate-950'
                }`}
              >
                RCP 4.5
              </button>
              <button
                type="button"
                onClick={() => onChangeDataMode('rcp85')}
                className={`px-2.5 py-1 text-xs font-mono font-bold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dataMode === 'rcp85'
                    ? 'bg-red-700 text-white'
                    : 'text-slate-800 hover:text-slate-950'
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
