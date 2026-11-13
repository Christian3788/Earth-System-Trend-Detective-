# NASA Earth System Data Explorer // Trend Detective

An interactive, self-contained Earth system anomaly explorer and automated non-parametric **Trend Detective** statistical analysis workbench built for the **NASA Space Apps Challenge** (*"Be An Earth System Trend Detective!"*).

The application combines an institutional Earth System Data Explorer (ESDE) variable hierarchy across four planetary spheres with a dual 2D/3D native HTML5 Canvas Blue Marble visualization engine, teleconnection dipole coupling, Historical (`2005–2024`) vs. Projected (`2025–2099`, RCP 4.5 / RCP 8.5) climate pathway analysis, and automated Mann-Kendall / Theil-Sen / LOESS statistical trend detection.

---

## Core Capabilities

### 1. Challenge Alignment: The 4 Trend Detective Questions
Designed around the core scientific questions of Earth system trend analysis:
1. **What Is Changing?** — Distinguishes Satellite Mission observations from Earth System Model / Reanalysis products (and CMIP5 / NEX-GDDP projection pathways), with domain-accurate directional terminology (*Rising/Falling*, *Increasing/Decreasing*, *Thickening/Thinning*).
2. **Where Is It Changing?** — Demonstrates how a single physical teleconnection driver causes opposing regional trends simultaneously (**Pole A Surplus** in cyan vs. **Pole B Deficit** in orange/red), coupled by an animated 3D geodesic arc.
3. **How Much Is It Changing?** — Quantifies decadal slopes (`Theil-Sen` median slope estimator) and full-window deltas (`20-Year Delta` for `2005–2024`; `75-Year Projected Delta` for `2025–2099`), plus side-by-side **Observed vs. Projected** slope comparisons.
4. **Is It Significant?** — Executes a two-tailed **Mann-Kendall rank significance test** (`Z`-score and `p`-value with `α = 0.05` threshold) paired with a 4-tier confidence meter and global spatial noise masking (`p >= 0.05`).

### 2. Historical vs. Projected Climate Modes (`RCP 4.5` & `RCP 8.5`)
- **Historical Observed (`2005–2024`)**: 240 monthly samples per location (`120` steps/decade) anchored to NASA/partner observational and reanalysis baselines.
- **Projected (`2025–2099`)**:
  - **RCP 4.5**: Intermediate stabilization pathway peaking radiative forcing near `4.5 W/m²` after mid-century.
  - **RCP 8.5**: High-emissions pathway reaching `8.5 W/m²` radiative forcing by 2100 with amplified Arctic and dipole extremes.
- **Cross-Regime Comparison**:
  - In **2D Planar Map** mode, the draggable **Compare To** vertical split-screen curtain lets users compare observed baselines (e.g., `2024 (Obs)`) directly against projected horizons (`2030–2099`) under unified legend bounds.
  - In **Time Plot**, users can switch between **Projected Only (`2025–2099`)** and **Full Obs + Proj (`2005–2099`)** with a visual `← Obs | Proj →` boundary marker at `2024/2025`.

### 3. Dual 2D / 3D Canvas Geospatial Engine (Zero External Map Libraries)
- **3D Orthographic Blue Marble Globe**: Procedural `720×360` Earth surface biome texture (`src/engine/blueMarbleTexture.ts`) with bathymetric coastal shelves, mountain hillshading, ocean specular highlights, Rayleigh blue atmospheric limb glow, swirling cloud layer toggle, orbital drag-to-spin inertia, mouse-wheel zoom, and auto-spin.
- **2D Equirectangular Planar Map**: Graticule meridians/parallels, crisp coastline vectors (`src/data/worldCoastlines.ts`), calibrated diverging blue-to-red anomaly overlays, and a draggable split-screen year comparison curtain.
- **Noise Masking (`p >= 0.05`)**: Filters out grid cells failing the Mann-Kendall `α = 0.05` significance test across a global `120×60` mask (`3°` cell resolution).
- **Interactive Point Probing**: Click anywhere on the 2D map or 3D globe to inspect local coordinate values, domain masking (land-only vs. ocean-only missions), and local Mann-Kendall / Theil-Sen statistics.

---

## Earth System Dataset Hierarchy (4 Spheres · 10 Datasets)

| Sphere | Category | Dataset / Mission | Source Type | Unit | Domain | Archive / Partner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Atmosphere** | Temperature & Energy Budget | Surface Air Temperature (`MERRA-2 M2TMNXSLV v5.12.4`) | Earth System Model | `°C` | Global | NASA GES DISC |
| **Atmosphere** | Hydrological Cycle | Precipitation Anomaly (`GPM IMERG Final Run V07B`) | Satellite Mission | `mm/day` | Global | NASA GES DISC |
| **Hydrosphere** | Terrestrial Water | Soil Moisture (`SMAP L3 Radiometer Global 36km`) | Satellite Mission | `m³/m³` | Land | NASA NSIDC DAAC |
| **Hydrosphere** | Surface Water & Ocean Topography | Surface Water Elevation (`SWOT KaRIn L2/L3`) | Satellite Mission | `cm` | Global | NASA PO.DAAC / CNES / CSA / UKSA |
| **Hydrosphere** | Ocean Dynamics | Sea Surface Temperature (`GHRSST Level 4 MUR v4.1`) | Satellite Mission | `°C` | Ocean | NASA PO.DAAC |
| **Biosphere** | Vegetation & Carbon | Vegetation Index / NDVI (`MODIS/Terra MOD13C2 v061`) | Satellite Mission | `NDVI` | Land | NASA LP DAAC |
| **Biosphere** | Coastal & Ocean Productivity | Coastal Chlorophyll-a (`SeaWiFS / MODIS-Aqua L3M`) | Satellite Mission | `mg/m³` | Ocean | NASA OB.DAAC |
| **Cryosphere** | Sea Ice & Snow Cover | Sea Ice Concentration (`NSIDC Sea Ice Index v3 / AMSR2`) | Satellite Mission | `%` | Ocean | NASA NSIDC DAAC |
| **Cryosphere** | SAR Maritime, Ice & Wetlands | SAR Backscatter & Coastal Ice (`CSA RADARSAT RCM`) | Satellite Mission | `dB` | Global | CSA / GEO.ca |
| **Cryosphere** | Ice Sheet & Hydrologic Mass | Land Ice & Water Mass (`GRACE / GRACE-FO RL06.1`) | Satellite Mission | `cm w.e.` | Land | NASA PO.DAAC |

---

## Teleconnection Drivers & Domain-Aware Poles

The top teleconnection bar isolates global planetary drivers and dynamically adjusts **Pole A (Surplus)** and **Pole B (Deficit)** coordinates to respect each dataset's physical domain (e.g., land-only vs. ocean-only sensors):

- **Indian Ocean Dipole (IOD)**: Western Indian Ocean / East Africa (`Pole A`) vs. Eastern Indian Ocean / Sumatra / Australian Outback (`Pole B`).
- **Pacific ENSO**: Niño 3.4 / Eastern Equatorial Pacific (`Pole A`) vs. Western Pacific Warm Pool / Amazon (`Pole B`).
- **Arctic Amplification**: Barents-Kara Arctic Core / Northern Siberia (`Pole A`) vs. Subpolar North Atlantic Cold Anomaly / Western Europe (`Pole B`).
- **None (Global)**: Unfiltered multi-decadal secular planetary baseline across representative latitude bands.

---

## Statistical Engine & Data Portals

### Non-Parametric Time-Series Engine (`src/engine/statistics.ts`)
- **Mann-Kendall Test**: Computes rank statistic $S$, variance $\text{Var}(S)$ with tie handling, normal deviate $Z$, two-tailed $p$-value, and a 4-tier confidence classification:
  - Tier 4: Very High Significance (`p < 0.001`)
  - Tier 3: High Significance (`p < 0.01`)
  - Tier 2: Statistically Significant (`p < 0.05`)
  - Tier 1: Non-Significant / Synoptic Noise (`p >= 0.05`)
- **Theil-Sen Median Slope**: Robust median of all pairwise slopes $\frac{x_j - x_i}{j - i}$, scaled to change per decade and full-horizon delta.
- **LOESS Smoothing**: Local tricube-weighted linear regression smoothing seasonal/interannual trajectories.
- **CSV Export**: Exports header provenance (Data Mode, Dataset, Teleconnection, Slope, Delta, Z-score, p-value) and full point/series data (`Raw_Anomaly`, `LOESS_Smoothed`, `Theil_Sen_Trend`).

### Integrated Space Agency Resources Modal (`Data Portals & Methods`)
Accessible from the header bar, cataloging challenge resources with one-click dataset loading:
- **NASA Data & Resources**: Giovanni (GES DISC), Hydrology Time Series, AppEEARS (LP DAAC), NOAA Climate Data Online (CDO), SeaWiFS Coastal Chlorophyll-a Time-Series methodology.
- **Space Agency Partners**: SWOT Mission (NASA/CNES/CSA/UKSA), CSA RADARSAT Constellation Mission (RCM), GEO.ca Open Geospatial Portal, KNMI Climate Explorer.
- **Statistical & SAR Guidance**: Mann-Kendall & Theil-Sen (`α = 0.05`) testing and C-band SAR ecosystem/coastal change workflows.

---

## Technical Architecture

### Zero-External-CDN Constraint
All geospatial mapping, 3D orbital globe rendering, and interactive time-series charts run offline/sandbox-safe using **native HTML5 Canvas 2D APIs** without third-party CDN dependencies or external mapping SDKs.

### Tech Stack
- **Framework**: React 19 + TypeScript + Vite 8
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`, `@import "tailwindcss";`)
- **Icons**: `lucide-react`
- **Visualization & Compute**: Pure HTML5 Canvas (`MapViewport`, `TimeSeriesCanvas`) and client-side TypeScript statistical/geophysical modules

### Repository Structure
```text
├── index.html                        # Entry HTML & institutional page metadata
├── metadata.json                     # App name, description, and capability flags
├── package.json                      # Dependencies and npm scripts
├── src/
│   ├── App.tsx                       # Root state orchestration (mode, dataset, driver, playback)
│   ├── main.tsx                      # React DOM bootstrap
│   ├── index.css                     # Tailwind CSS v4 import & custom range slider styling
│   ├── data/
│   │   ├── datasets.ts               # 10 datasets, 4 spheres, RCP modes, teleconnections, resources
│   │   └── worldCoastlines.ts        # Continental & inland sea polygons, 360×180 land mask, regions
│   ├── engine/
│   │   ├── blueMarbleTexture.ts      # Procedural 720×360 Blue Marble biomes, hillshade & clouds
│   │   ├── earthData.ts              # Spatiotemporal anomaly synthesis (2005–2099) & grid builders
│   │   └── statistics.ts             # Mann-Kendall, Theil-Sen, LOESS, geodesic & diverging palette
│   └── components/
│       ├── HeaderBar.tsx             # NASA banner, Hist/Proj (RCP 4.5/8.5) toggle, driver presets
│       ├── DatasetSidebar.tsx        # Sphere/Dataset selectors, Year/Month controls & calibrated legend
│       ├── MapViewport.tsx           # 2D Planar + 3D Blue Marble Canvas engine & Compare To curtain
│       ├── AnalysisPanel.tsx         # 3-tab suite: Trend Detective, Identify Point & Time Plot
│       ├── TimeSeriesCanvas.tsx      # Interactive HTML5 Canvas time-series chart with hover inspect
│       └── ResourcesModal.tsx        # NASA, KNMI & CSA partner data portals & methods modal
└── vite.config.ts                    # Vite build configuration
```

---

## Local Development

### Prerequisites
- Node.js `>= 18` (with `npm`)

### Setup & Commands
```bash
# Install dependencies
npm install

# Start the Vite development server on port 3000
npm run dev

# Type-check with TypeScript
npm run lint

# Build production bundle to dist/
npm run build

# Preview production build
npm run preview
```

---

## Disclaimer on Synthetic / Model-Anchored Gridded Fields
For zero-latency, offline-capable interactive exploration inside sandboxed environments without external network tile/API dependencies, spatial anomaly grids and 2005–2099 time series are procedurally synthesized in `src/engine/earthData.ts` to reproduce realistic physical signatures, dipole phase behavior, land/ocean domain constraints, and CMIP5 RCP 4.5 / RCP 8.5 trajectory scaling anchored to each mission's published climatology and units. Use the **Data Portals & Methods** modal in the header to explore operational raw archives via NASA Giovanni, AppEEARS, PO.DAAC, CSA/GEO.ca, and KNMI Climate Explorer.
