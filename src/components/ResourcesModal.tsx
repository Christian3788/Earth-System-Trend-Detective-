import React from 'react';
import { X, ArrowRight, BookOpen } from 'lucide-react';
import { CHALLENGE_RESOURCES, DatasetId } from '../data/datasets';

interface ResourcesModalProps {
  open: boolean;
  onClose: () => void;
  onLoadDataset: (id: DatasetId) => void;
}

const CATEGORIES: Array<
  'NASA Data & Resources' | 'Space Agency Partners (KNMI & CSA)' | 'Statistical & SAR Methodology'
> = [
  'NASA Data & Resources',
  'Space Agency Partners (KNMI & CSA)',
  'Statistical & SAR Methodology',
];

export const ResourcesModal: React.FC<ResourcesModalProps> = ({
  open,
  onClose,
  onLoadDataset,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resources-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[86vh] bg-white rounded-lg border border-slate-200 shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#0B3D91] text-white px-5 py-3.5 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <BookOpen className="w-4 h-4 shrink-0 text-blue-100" />
            <h2 id="resources-modal-title" className="text-base font-bold truncate">
              NASA &amp; Space Agency Partner Data Portals and Methodology
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close resources dialog"
            className="p-1 rounded text-blue-50 hover:text-white hover:bg-white/15 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <p className="text-[13px] leading-relaxed text-slate-800">
            Reference archives, mission products, and statistical trend-testing methods integrated into this Earth System Trend Detective workbench. Select any linked product below to load its corresponding mission or model dataset directly in the Explorer.
          </p>

          {CATEGORIES.map((cat) => {
            const items = CHALLENGE_RESOURCES.filter((r) => r.category === cat);
            return (
              <section key={cat} className="space-y-2.5">
                <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#0B3D91] border-b border-slate-200 pb-1.5">
                  {cat}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {items.map((item) => (
                    <div
                      key={item.title}
                      className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex flex-col justify-between gap-2.5"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-bold text-slate-950">
                          {item.title}
                        </div>
                        <div className="text-xs font-semibold text-slate-700">{item.agency}</div>
                        <p className="text-[13px] leading-relaxed text-slate-800 pt-0.5">
                          {item.summary}
                        </p>
                      </div>

                      {item.linkedDatasetId && (
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              onLoadDataset(item.linkedDatasetId!);
                              onClose();
                            }}
                            className="inline-flex items-center gap-1 text-[13px] font-bold text-[#0B3D91] hover:underline cursor-pointer"
                          >
                            Load Dataset in Explorer
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
