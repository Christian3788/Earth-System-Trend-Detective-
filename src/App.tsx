import { useEffect, useMemo, useState } from 'react';
import {
  DATASETS,
  DatasetId,
  SphereId,
  TeleconnectionId,
  getEffectivePoles,
} from './data/datasets';
import {
  buildGlobalAnomalyGrid,
  buildSignificanceMaskGrid,
  generateDriverSummarySeries,
  getDatasetById,
} from './engine/earthData';
import { HeaderBar } from './components/HeaderBar';
import { DatasetSidebar } from './components/DatasetSidebar';
import { MapViewport, ViewMode } from './components/MapViewport';
import { AnalysisPanel, AnalysisTab } from './components/AnalysisPanel';
import { ResourcesModal } from './components/ResourcesModal';

export default function App() {
  const [teleconnectionId, setTeleconnectionId] = useState<TeleconnectionId>('iod');
  const [sphere, setSphere] = useState<SphereId>('atmosphere');
  const [datasetId, setDatasetId] = useState<DatasetId>('merra2_t2m');

  const [year, setYear] = useState<number>(2024);
  const [month, setMonth] = useState<number>(10);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [maskNoise, setMaskNoise] = useState<boolean>(false);
  const [compareEnabled, setCompareEnabled] = useState<boolean>(true);
  const [compareYear, setCompareYear] = useState<number>(2005);

  const [activeTab, setActiveTab] = useState<AnalysisTab>('detective');
  const [resourcesOpen, setResourcesOpen] = useState<boolean>(false);
  const [probedPoint, setProbedPoint] = useState<{ lat: number; lon: number } | null>({
    lat: 4.5,
    lon: 54.0,
  });

  const dataset = useMemo(() => getDatasetById(datasetId), [datasetId]);

  const handleSelectSphere = (newSphere: SphereId) => {
    setSphere(newSphere);
    const firstInSphere = DATASETS.find((d) => d.sphere === newSphere);
    if (firstInSphere) {
      setDatasetId(firstInSphere.id);
      const poles = getEffectivePoles(teleconnectionId, firstInSphere);
      if (poles.poleA) setProbedPoint({ lat: poles.poleA.lat, lon: poles.poleA.lon });
    }
  };

  const handleSelectDataset = (id: DatasetId) => {
    const spec = getDatasetById(id);
    setSphere(spec.sphere);
    setDatasetId(id);
    const poles = getEffectivePoles(teleconnectionId, spec);
    if (poles.poleA) setProbedPoint({ lat: poles.poleA.lat, lon: poles.poleA.lon });
  };

  const handleSelectTeleconnection = (id: TeleconnectionId) => {
    setTeleconnectionId(id);
    const poles = getEffectivePoles(id, dataset);
    if (poles.poleA) {
      setProbedPoint({ lat: poles.poleA.lat, lon: poles.poleA.lon });
    }
  };

  // Temporal playback timer
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setYear((prev) => (prev >= 2024 ? 2005 : prev + 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  // Global 360x180 anomaly snapshot for active Year/Month
  const anomalyGrid = useMemo(
    () => buildGlobalAnomalyGrid(dataset, teleconnectionId, year, month),
    [dataset, teleconnectionId, year, month]
  );

  // Global 360x180 comparison snapshot for Compare To Year/Month
  const compareGrid = useMemo(
    () => buildGlobalAnomalyGrid(dataset, teleconnectionId, compareYear, month),
    [dataset, teleconnectionId, compareYear, month]
  );

  // Global 120x60 Mann-Kendall significance mask (p < 0.05)
  const significanceMask = useMemo(
    () => buildSignificanceMaskGrid(dataset, teleconnectionId),
    [dataset, teleconnectionId]
  );

  // 20-year Driver/Regional Trend Detective statistical engine
  const driverSeries = useMemo(
    () => generateDriverSummarySeries(dataset, teleconnectionId),
    [dataset, teleconnectionId]
  );

  const handleProbePoint = (lat: number, lon: number) => {
    setProbedPoint({ lat, lon });
    setActiveTab('identify');
  };

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-white text-slate-900 lg:overflow-hidden">
      <HeaderBar
        teleconnection={teleconnectionId}
        onSelectTeleconnection={handleSelectTeleconnection}
        onOpenResources={() => setResourcesOpen(true)}
      />

      <main className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <DatasetSidebar
          sphere={sphere}
          onSelectSphere={handleSelectSphere}
          dataset={dataset}
          onSelectDataset={handleSelectDataset}
          year={year}
          onChangeYear={(y) => {
            setIsPlaying(false);
            setYear(y);
          }}
          month={month}
          onChangeMonth={setMonth}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((p) => !p)}
        />

        <MapViewport
          dataset={dataset}
          teleconnectionId={teleconnectionId}
          year={year}
          month={month}
          viewMode={viewMode}
          onChangeViewMode={setViewMode}
          maskNoise={maskNoise}
          onToggleMaskNoise={setMaskNoise}
          anomalyGrid={anomalyGrid}
          compareGrid={compareGrid}
          significanceMask={significanceMask}
          compareEnabled={compareEnabled}
          onToggleCompare={setCompareEnabled}
          compareYear={compareYear}
          onChangeCompareYear={setCompareYear}
          probedPoint={probedPoint}
          onProbePoint={handleProbePoint}
        />

        <AnalysisPanel
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          dataset={dataset}
          teleconnectionId={teleconnectionId}
          year={year}
          month={month}
          driverSeries={driverSeries}
          probedPoint={probedPoint}
          onSelectProbeCoord={(lat, lon) => setProbedPoint({ lat, lon })}
        />
      </main>

      <ResourcesModal
        open={resourcesOpen}
        onClose={() => setResourcesOpen(false)}
        onLoadDataset={handleSelectDataset}
      />
    </div>
  );
}
