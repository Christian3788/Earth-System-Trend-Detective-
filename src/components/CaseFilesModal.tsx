import React from 'react';
import { Compass, Play, X } from 'lucide-react';
import { CASE_FILES, CaseFileSpec } from '../data/datasets';

interface CaseFilesModalProps {
  open: boolean;
  onClose: () => void;
  onLaunchCase: (caseFile: CaseFileSpec) => void;
  activeCaseId: string | null;
}

export const CaseFilesModal: React.FC<CaseFilesModalProps> = ({
  open,
  onClose,
  onLaunchCase,
  activeCaseId,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-files-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="bg-[#0B3D91] text-white px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Compass className="w-5 h-5 shrink-0 text-cyan-300" />
            <h2 id="case-files-modal-title" className="text-base font-bold tracking-tight truncate">
              Guided Trend Detective Case Files
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close case files modal"
            className="p-1.5 rounded hover:bg-white/15 text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <p className="text-[13px] text-slate-800 leading-relaxed">
            Launch a multi-step Earth science investigation. Each Case File configures the satellites, teleconnection driver, climate pathway, and target region so you can trace <strong>what is changing</strong>, <strong>where opposing poles split</strong>, <strong>how much</strong>, and <strong>whether it is statistically significant</strong>.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {CASE_FILES.map((cf) => {
              const isActive = activeCaseId === cf.id;
              return (
                <div
                  key={cf.id}
                  className={`p-4 rounded-lg border flex flex-col justify-between gap-3 transition-colors ${
                    isActive
                      ? 'border-[#0B3D91] bg-blue-50/50'
                      : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-mono font-bold tracking-wider text-[#0B3D91]">
                      {cf.badge} · {cf.steps.length} STEPS
                    </div>
                    <h3 className="text-sm font-bold text-slate-950 leading-snug">
                      {cf.title}
                    </h3>
                    <p className="text-[13px] text-slate-800 leading-relaxed">
                      {cf.subtitle}
                    </p>
                    <div className="text-xs font-semibold text-slate-700 pt-0.5">
                      {cf.partners}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onLaunchCase(cf);
                      onClose();
                    }}
                    className="w-full px-3 py-2 text-[13px] font-bold rounded-md bg-[#0B3D91] text-white hover:bg-[#092E6E] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {isActive ? 'Restart Case Mission' : 'Launch Investigation'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
