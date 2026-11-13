export type SphereId = 'atmosphere' | 'hydrosphere' | 'biosphere' | 'cryosphere';

export type TeleconnectionId = 'iod' | 'enso' | 'arctic' | 'none';

export type DataMode = 'historical' | 'rcp45' | 'rcp85';

export interface DataModeSpec {
  id: DataMode;
  label: string;
  shortLabel: string;
  yearMin: number;
  yearMax: number;
  sourceLabel: string;
  description: string;
}

export const DATA_MODE_META: Record<DataMode, DataModeSpec> = {
  historical: {
    id: 'historical',
    label: 'Historical Observed (2005–2024)',
    shortLabel: 'Historical',
    yearMin: 2005,
    yearMax: 2024,
    sourceLabel: 'Observed Satellite Missions & MERRA-2 Assimilation',
    description:
      'Observed 20-year satellite and reanalysis record (2005–2024) capturing measured regional trends and teleconnection variability.',
  },
  rcp45: {
    id: 'rcp45',
    label: 'Projected · RCP 4.5 (2025–2099)',
    shortLabel: 'RCP 4.5',
    yearMin: 2025,
    yearMax: 2099,
    sourceLabel: 'CMIP5 / NASA NEX-GDDP Intermediate Stabilization (RCP 4.5)',
    description:
      'Intermediate emissions pathway peaking radiative forcing near 4.5 W/m² after mid-century, moderating late-century warming and cryosphere loss.',
  },
  rcp85: {
    id: 'rcp85',
    label: 'Projected · RCP 8.5 (2025–2099)',
    shortLabel: 'RCP 8.5',
    yearMin: 2025,
    yearMax: 2099,
    sourceLabel: 'CMIP5 / NASA NEX-GDDP High-Emissions Baseline (RCP 8.5)',
    description:
      'High-emissions pathway reaching 8.5 W/m² radiative forcing by 2100, driving accelerated Arctic amplification and intensified dipole extremes.',
  },
};

export type DatasetId =
  | 'merra2_t2m'
  | 'gpm_precip'
  | 'smap_soil'
  | 'mur_sst'
  | 'swot_water'
  | 'modis_ndvi'
  | 'seawifs_chl'
  | 'amsr2_ice'
  | 'grace_mass'
  | 'rcm_sar';

export interface DatasetSpec {
  id: DatasetId;
  sphere: SphereId;
  category: string;
  name: string;
  shortName: string;
  mission: string;
  sourceType: 'Satellite Mission' | 'Earth System Model';
  directionTerms: [string, string]; // [positive trend verb, negative trend verb]
  unit: string;
  domain: 'both' | 'land' | 'ocean';
  min: number;
  mid: number;
  max: number;
  decimals: number;
  daacName: string;
  portalHint: string;
  citation: string;
  baselinePeriod: string;
  physicalSummary: string;
}

export interface PoleSpec {
  name: string;
  regionLabel: string;
  lat: number;
  lon: number;
  polarity: 'surplus' | 'deficit';
}

export interface TeleconnectionSpec {
  id: TeleconnectionId;
  label: string;
  shortLabel: string;
  mechanism: string;
  boundingCoords: string;
  focusLat: number;
  focusLon: number;
  poleA: PoleSpec | null;
  poleB: PoleSpec | null;
}

export interface ChallengeResourceItem {
  category: 'NASA Data & Resources' | 'Space Agency Partners (KNMI & CSA)' | 'Statistical & SAR Methodology';
  title: string;
  agency: string;
  summary: string;
  linkedDatasetId?: DatasetId;
}

export const SPHERES: { id: SphereId; label: string }[] = [
  { id: 'atmosphere', label: 'Atmosphere' },
  { id: 'hydrosphere', label: 'Hydrosphere' },
  { id: 'biosphere', label: 'Biosphere' },
  { id: 'cryosphere', label: 'Cryosphere' },
];

export const DATASETS: DatasetSpec[] = [
  {
    id: 'merra2_t2m',
    sphere: 'atmosphere',
    category: 'Temperature & Energy Budget',
    name: 'Surface Air Temperature (MERRA-2)',
    shortName: 'Surface Air Temp Anomaly',
    mission: 'MERRA-2 M2TMNXSLV v5.12.4',
    sourceType: 'Earth System Model',
    directionTerms: ['Rising (Warming)', 'Falling (Cooling)'],
    unit: '°C',
    domain: 'both',
    min: -3.5,
    mid: 0,
    max: 3.5,
    decimals: 2,
    daacName: 'NASA GES DISC',
    portalHint: 'NASA Giovanni · KNMI Climate Explorer · NOAA CDO',
    citation:
      'GMAO (2015), MERRA-2 tavgM_2d_slv_Nx: 2d, Monthly mean, Single-Level Assimilation, Goddard Earth Sciences Data and Information Services Center (GES DISC).',
    baselinePeriod: '1991–2020 Climatology',
    physicalSummary:
      '2-meter air temperature departures driven by greenhouse radiative forcing, land-sea thermal inertia contrast, and large-scale atmospheric Rossby wave teleconnections.',
  },
  {
    id: 'gpm_precip',
    sphere: 'atmosphere',
    category: 'Hydrological Cycle',
    name: 'Precipitation Anomaly (GPM IMERG)',
    shortName: 'Precipitation Anomaly',
    mission: 'GPM IMERG Final Run V07B',
    sourceType: 'Satellite Mission',
    directionTerms: ['Increasing (Wetting)', 'Decreasing (Drying)'],
    unit: 'mm/day',
    domain: 'both',
    min: -4.0,
    mid: 0,
    max: 4.0,
    decimals: 2,
    daacName: 'NASA GES DISC',
    portalHint: 'NASA Giovanni · Hydrology Time Series · NOAA CDO',
    citation:
      'Huffman, G.J. et al. (2023), GPM IMERG Final Precipitation L3 1 month 0.1 degree x 0.1 degree V07, Greenbelt, MD, NASA GES DISC.',
    baselinePeriod: '2005–2020 Climatology',
    physicalSummary:
      'Convective and stratiform rainfall shifts governed by Walker and Hadley circulation displacement, moisture convergence zones, and ocean heat flux anomalies.',
  },
  {
    id: 'smap_soil',
    sphere: 'hydrosphere',
    category: 'Terrestrial Water',
    name: 'Soil Moisture (SMAP)',
    shortName: 'Root-Zone Soil Moisture Anomaly',
    mission: 'SMAP L3 Radiometer Global 36km (SPL3SMP)',
    sourceType: 'Satellite Mission',
    directionTerms: ['Increasing (Wetting)', 'Decreasing (Drying)'],
    unit: 'm³/m³',
    domain: 'land',
    min: -0.18,
    mid: 0,
    max: 0.18,
    decimals: 3,
    daacName: 'NASA NSIDC DAAC',
    portalHint: 'NASA Hydrology Time Series · AppEEARS',
    citation:
      'O’Neill, P.E. et al. (2023), SMAP L3 Radiometer Global Daily 36 km EASE-Grid Soil Moisture, Version 9, Boulder, CO, NASA National Snow and Ice Data Center DAAC.',
    baselinePeriod: '2005–2020 Assimilated Baseline',
    physicalSummary:
      'Top-layer volumetric soil water variability modulated by regional precipitation deficits, vapor pressure deficit, and evaporative demand over continental watersheds.',
  },
  {
    id: 'swot_water',
    sphere: 'hydrosphere',
    category: 'Surface Water & Ocean Topography',
    name: 'Surface Water Elevation (SWOT NASA/CNES/CSA)',
    shortName: 'Surface Water Elevation Anomaly',
    mission: 'SWOT KaRIn L2/L3 Lake, River & Sea Surface Height',
    sourceType: 'Satellite Mission',
    directionTerms: ['Rising (Surplus Storage)', 'Falling (Drawdown)'],
    unit: 'cm',
    domain: 'both',
    min: -32,
    mid: 0,
    max: 32,
    decimals: 1,
    daacName: 'NASA PO.DAAC / CNES / CSA / UKSA',
    portalHint: 'SWOT Mission Portal · Hydrology Time Series',
    citation:
      'NASA / CNES / CSA / UKSA (2024), Surface Water and Ocean Topography (SWOT) Ka-band Radar Interferometer Water Surface Elevation & Ocean Topography.',
    baselinePeriod: '2005–2020 Hydro-Altimetry Baseline',
    physicalSummary:
      'High-resolution water surface elevation anomalies across rivers, lakes, reservoirs, and coastal oceans (90% global surface water coverage) reflecting flood pulses, drought drawdown, and steric ocean rise.',
  },
  {
    id: 'mur_sst',
    sphere: 'hydrosphere',
    category: 'Ocean Dynamics',
    name: 'Sea Surface Temperature (MUR SST)',
    shortName: 'Sea Surface Temp Anomaly',
    mission: 'GHRSST Level 4 MUR Global 0.01° v4.1',
    sourceType: 'Satellite Mission',
    directionTerms: ['Rising (Warming)', 'Falling (Cooling)'],
    unit: '°C',
    domain: 'ocean',
    min: -2.5,
    mid: 0,
    max: 2.5,
    decimals: 2,
    daacName: 'NASA PO.DAAC',
    portalHint: 'NASA PO.DAAC · KNMI Climate Explorer',
    citation:
      'JPL MUR MEaSUREs Project (2015), GHRSST Level 4 MUR Global Foundation Sea Surface Temperature Analysis (v4.1), Pasadena, CA, NASA PO.DAAC.',
    baselinePeriod: '2003–2020 Foundation SST',
    physicalSummary:
      'Upper-ocean thermal anomalies controlled by equatorial thermocline tilt, trade-wind upwelling dynamics, and ocean basin heat uptake.',
  },
  {
    id: 'modis_ndvi',
    sphere: 'biosphere',
    category: 'Vegetation & Carbon',
    name: 'Vegetation Index / NDVI (MODIS Terra)',
    shortName: 'NDVI Greenness Anomaly',
    mission: 'MODIS/Terra MOD13C2 v061',
    sourceType: 'Satellite Mission',
    directionTerms: ['Increasing (Greening)', 'Decreasing (Browning)'],
    unit: 'NDVI',
    domain: 'land',
    min: -0.25,
    mid: 0,
    max: 0.25,
    decimals: 3,
    daacName: 'NASA LP DAAC',
    portalHint: 'NASA AppEEARS · Ecosystem Monitoring',
    citation:
      'Didan, K. (2021), MODIS/Terra Vegetation Indices Monthly L3 Global 0.05Deg CMG V061, Sioux Falls, SD, NASA EOSDIS Land Processes DAAC.',
    baselinePeriod: '2005–2020 Phenology Mean',
    physicalSummary:
      'Photosynthetic canopy vigor shifts responding to hydroclimatic drought stress, growing-season thermal lengthening at high latitudes, and monsoon onset shifts.',
  },
  {
    id: 'seawifs_chl',
    sphere: 'biosphere',
    category: 'Coastal & Ocean Productivity',
    name: 'Coastal Chlorophyll-a (SeaWiFS / MODIS-Aqua)',
    shortName: 'Chlorophyll-a Concentration Anomaly',
    mission: 'SeaWiFS / MODIS-Aqua Ocean Color L3M',
    sourceType: 'Satellite Mission',
    directionTerms: ['Increasing (Bloom Surge)', 'Decreasing (Oligotrophic)'],
    unit: 'mg/m³',
    domain: 'ocean',
    min: -1.8,
    mid: 0,
    max: 1.8,
    decimals: 2,
    daacName: 'NASA OB.DAAC',
    portalHint: 'NASA Giovanni · SeaWiFS Coastal Time-Series',
    citation:
      'NASA Ocean Biology Processing Group (2022), SeaWiFS & MODIS-Aqua Global Chlorophyll-a Concentration in River-Influenced Coastal Regions, NASA OB.DAAC.',
    baselinePeriod: '2005–2020 Ocean Color Climatology',
    physicalSummary:
      'Phytoplankton biomass departures along river-influenced coastal plumes (Amazon, Congo, Ganges, Mississippi) and equatorial upwelling belts driven by nutrient runoff and thermal stratification.',
  },
  {
    id: 'amsr2_ice',
    sphere: 'cryosphere',
    category: 'Sea Ice & Snow Cover',
    name: 'Sea Ice Concentration Anomaly (AMSR2 / SSMIS)',
    shortName: 'Sea Ice Concentration Anomaly',
    mission: 'NSIDC Sea Ice Index v3 (G02135)',
    sourceType: 'Satellite Mission',
    directionTerms: ['Thickening / Expanding', 'Thinning / Retreating'],
    unit: '%',
    domain: 'ocean',
    min: -45,
    mid: 0,
    max: 45,
    decimals: 1,
    daacName: 'NASA NSIDC DAAC',
    portalHint: 'NSIDC · KNMI Climate Explorer',
    citation:
      'Fetterer, F. et al. (2017), Sea Ice Index, Version 3, Boulder, CO, National Snow and Ice Data Center (NASA DAAC).',
    baselinePeriod: '1981–2010 Polar Median',
    physicalSummary:
      'Polar sea-ice fraction decline amplified by ice-albedo positive feedback, warm Atlantic/Pacific inflow anomalies, and meridional heat transport.',
  },
  {
    id: 'rcm_sar',
    sphere: 'cryosphere',
    category: 'SAR Maritime, Ice & Wetlands',
    name: 'SAR Backscatter & Coastal Ice Index (CSA RADARSAT RCM)',
    shortName: 'C-Band SAR Change Anomaly',
    mission: 'CSA RADARSAT Constellation Mission (RCM) C-Band SAR',
    sourceType: 'Satellite Mission',
    directionTerms: ['Increasing (Ice/Inundation)', 'Decreasing (Melt/Retreat)'],
    unit: 'dB',
    domain: 'both',
    min: -4.5,
    mid: 0,
    max: 4.5,
    decimals: 2,
    daacName: 'Canadian Space Agency (CSA) / GEO.ca',
    portalHint: 'CSA RADARSAT RCM · GEO.ca · SAR Tutorial',
    citation:
      'Canadian Space Agency (2024), RADARSAT Constellation Mission (RCM) All-Weather C-Band SAR Maritime Ice, Wetland & Coastal Monitoring Archive, GEO.ca.',
    baselinePeriod: '2005–2020 SAR Reference Backscatter',
    physicalSummary:
      'All-weather, day-and-night C-band Synthetic Aperture Radar backscatter shifts detecting multi-year Arctic sea-ice deformation, boreal wetland inundation, and coastal erosion.',
  },
  {
    id: 'grace_mass',
    sphere: 'cryosphere',
    category: 'Ice Sheet & Hydrologic Mass',
    name: 'Land Ice & Water Mass Anomaly (GRACE / GRACE-FO)',
    shortName: 'Equivalent Water Thickness',
    mission: 'GRACE/GRACE-FO RL06.1 Mascon CRI',
    sourceType: 'Satellite Mission',
    directionTerms: ['Thickening / Accumulating', 'Thinning / Ablating'],
    unit: 'cm w.e.',
    domain: 'land',
    min: -35,
    mid: 0,
    max: 35,
    decimals: 1,
    daacName: 'NASA PO.DAAC',
    portalHint: 'NASA Hydrology Time Series · PO.DAAC',
    citation:
      'Wiese, D.N. et al. (2023), JPL GRACE and GRACE-FO Mascon Ocean, Ice, and Hydrology Equivalent Water Height RL06.1, Pasadena, CA, NASA PO.DAAC.',
    baselinePeriod: '2004–2009 Mascon Reference',
    physicalSummary:
      'Gravimetric mass balance anomalies capturing ice-sheet ablation in Greenland/West Antarctica alongside continental groundwater depletion and flood storage.',
  },
];

export const TELECONNECTIONS: Record<TeleconnectionId, TeleconnectionSpec> = {
  iod: {
    id: 'iod',
    label: 'Indian Ocean Dipole (IOD)',
    shortLabel: 'Indian Ocean Dipole (IOD)',
    mechanism:
      'Positive IOD phases weaken equatorial westerlies and shift warm surface waters westward toward East Africa (Pole A), inducing anomalous convection and flooding while driving cold upwelling, atmospheric subsidence, and drought across Sumatra and Australia (Pole B).',
    boundingCoords: '15°S–15°N, 40°E–120°E (Indian Ocean Basin Dipole)',
    focusLat: 0,
    focusLon: 78,
    poleA: {
      name: 'Pole A · Western Indian Ocean',
      regionLabel: 'Somali Basin / East Africa',
      lat: 4.5,
      lon: 54.0,
      polarity: 'surplus',
    },
    poleB: {
      name: 'Pole B · Eastern Indian Ocean',
      regionLabel: 'Sumatra / Maritime Continent',
      lat: -6.0,
      lon: 103.0,
      polarity: 'deficit',
    },
  },
  enso: {
    id: 'enso',
    label: 'Pacific ENSO',
    shortLabel: 'Pacific ENSO',
    mechanism:
      'El Niño–Southern Oscillation weakens Pacific trade winds, flattening the equatorial thermocline to concentrate warm anomalies in the central-eastern Niño 3.4 corridor (Pole A) while displacing deep convection away from the Western Pacific Warm Pool (Pole B).',
    boundingCoords: '10°S–10°N, 125°E–85°W (Equatorial Pacific Corridor)',
    focusLat: 0,
    focusLon: -145,
    poleA: {
      name: 'Pole A · Niño 3.4 / East Pacific',
      regionLabel: 'Eastern Equatorial Pacific',
      lat: -2.0,
      lon: -115.0,
      polarity: 'surplus',
    },
    poleB: {
      name: 'Pole B · Western Pacific Warm Pool',
      regionLabel: 'Maritime Continent / Coral Sea',
      lat: 2.0,
      lon: 135.0,
      polarity: 'deficit',
    },
  },
  arctic: {
    id: 'arctic',
    label: 'Arctic Amplification',
    shortLabel: 'Arctic Amplification',
    mechanism:
      'Sea-ice retreat lowers polar surface albedo, accelerating Barents-Kara heat flux and tropospheric warming (Pole A) at 3–4x the global mean rate, perturbing the polar jet stream and strengthening cold-blob/subpolar North Atlantic contrast (Pole B).',
    boundingCoords: '50°N–85°N, 55°W–90°E (Barents-Kara & Subpolar Atlantic)',
    focusLat: 66,
    focusLon: 12,
    poleA: {
      name: 'Pole A · Barents-Kara Arctic Core',
      regionLabel: 'High Arctic Basin',
      lat: 75.5,
      lon: 48.0,
      polarity: 'surplus',
    },
    poleB: {
      name: 'Pole B · Subpolar North Atlantic',
      regionLabel: 'North Atlantic Cold Anomaly',
      lat: 53.0,
      lon: -36.0,
      polarity: 'deficit',
    },
  },
  none: {
    id: 'none',
    label: 'None (Global)',
    shortLabel: 'None (Global)',
    mechanism:
      'Unfiltered global secular regime reflecting multi-decadal radiative forcing, continental amplification, and background seasonal hydroclimate variability without isolated dipole locking.',
    boundingCoords: '90°S–90°N, 180°W–180°E (Global Domain)',
    focusLat: 18,
    focusLon: 10,
    poleA: null,
    poleB: null,
  },
};

// Resolves valid Pole A & Pole B coordinates matching the dataset's physical domain (land vs ocean)
export function getEffectivePoles(
  teleconnectionId: TeleconnectionId,
  dataset: DatasetSpec
): { poleA: PoleSpec | null; poleB: PoleSpec | null } {
  const tele = TELECONNECTIONS[teleconnectionId];
  if (!tele.poleA || !tele.poleB) {
    return { poleA: null, poleB: null };
  }

  if (dataset.id === 'grace_mass') {
    return {
      poleA: {
        name: 'Pole A · Okavango / East African Basin',
        regionLabel: 'Southern African Hydrologic Gain',
        lat: -15.0,
        lon: 24.0,
        polarity: 'surplus',
      },
      poleB: {
        name: 'Pole B · Greenland Ice Sheet',
        regionLabel: 'Arctic Ice Sheet Ablation',
        lat: 70.0,
        lon: -42.0,
        polarity: 'deficit',
      },
    };
  }

  if (dataset.id === 'rcm_sar') {
    return {
      poleA: {
        name: 'Pole A · Hudson Bay / Mackenzie Delta',
        regionLabel: 'Boreal Wetland & River Inundation',
        lat: 56.0,
        lon: -86.0,
        polarity: 'surplus',
      },
      poleB: {
        name: 'Pole B · Beaufort / Barents Sea Ice',
        regionLabel: 'Multi-Year Sea-Ice Melt Loss',
        lat: 75.5,
        lon: 48.0,
        polarity: 'deficit',
      },
    };
  }

  if (dataset.id === 'seawifs_chl') {
    if (teleconnectionId === 'iod') {
      return {
        poleA: {
          name: 'Pole A · Arabian Sea / Somali Upwelling',
          regionLabel: 'Western Indian Coastal Bloom',
          lat: 10.0,
          lon: 56.0,
          polarity: 'surplus',
        },
        poleB: {
          name: 'Pole B · Bay of Bengal / Sumatra Plume',
          regionLabel: 'Stratified Eastern Indian Deficit',
          lat: -4.0,
          lon: 98.0,
          polarity: 'deficit',
        },
      };
    }
    if (teleconnectionId === 'enso') {
      return {
        poleA: {
          name: 'Pole A · Western Pacific Warm Pool',
          regionLabel: 'Upwelling Productivity Surge',
          lat: 1.0,
          lon: 142.0,
          polarity: 'surplus',
        },
        poleB: {
          name: 'Pole B · Eastern Equatorial Pacific',
          regionLabel: 'El Niño Thermocline Suppression',
          lat: -2.0,
          lon: -112.0,
          polarity: 'deficit',
        },
      };
    }
  }

  if (dataset.domain === 'land') {
    if (teleconnectionId === 'iod') {
      return {
        poleA: {
          name: 'Pole A · East Africa / Horn',
          regionLabel: 'East African Highland Response',
          lat: 2.0,
          lon: 38.0,
          polarity: 'surplus',
        },
        poleB: {
          name: 'Pole B · Australian Outback',
          regionLabel: 'Central Australia Drying',
          lat: -24.0,
          lon: 134.0,
          polarity: 'deficit',
        },
      };
    }
    if (teleconnectionId === 'enso') {
      return {
        poleA: {
          name: 'Pole A · Coastal Ecuador / Peru',
          regionLabel: 'Andean Pacific Slope Surplus',
          lat: -3.0,
          lon: -78.0,
          polarity: 'surplus',
        },
        poleB: {
          name: 'Pole B · Central Amazon Basin',
          regionLabel: 'Amazon Drought Response',
          lat: -5.0,
          lon: -60.0,
          polarity: 'deficit',
        },
      };
    }
    if (teleconnectionId === 'arctic') {
      return {
        poleA: {
          name: 'Pole A · Northern Siberia',
          regionLabel: 'Boreal Tundra Warming / Greening',
          lat: 67.0,
          lon: 82.0,
          polarity: 'surplus',
        },
        poleB: {
          name: 'Pole B · Western Europe / UK',
          regionLabel: 'Mid-Latitude Jet Contrast',
          lat: 52.0,
          lon: -3.0,
          polarity: 'deficit',
        },
      };
    }
  }

  if (dataset.id === 'amsr2_ice') {
    return {
      poleA: {
        name: 'Pole A · Ross / Antarctic Margin',
        regionLabel: 'Southern Ocean Regional Variance',
        lat: -68.0,
        lon: -170.0,
        polarity: 'surplus',
      },
      poleB: {
        name: 'Pole B · Barents-Kara Sea Ice',
        regionLabel: 'Arctic Sea-Ice Retreat Core',
        lat: 76.0,
        lon: 46.0,
        polarity: 'deficit',
      },
    };
  }

  return { poleA: tele.poleA, poleB: tele.poleB };
}

export const CHALLENGE_RESOURCES: ChallengeResourceItem[] = [
  {
    category: 'NASA Data & Resources',
    title: 'Giovanni (NASA GES DISC)',
    agency: 'NASA Goddard Earth Sciences DISC',
    summary:
      'Menu-driven web analysis environment for atmospheric, hydrological, and ocean-color variables with time-series plotting and CSV/NetCDF export.',
    linkedDatasetId: 'merra2_t2m',
  },
  {
    category: 'NASA Data & Resources',
    title: 'Hydrology Time Series',
    agency: 'NASA GES DISC',
    summary:
      'Dedicated hydrological time-series extraction engine for precipitation, soil moisture, and terrestrial water storage fluxes.',
    linkedDatasetId: 'gpm_precip',
  },
  {
    category: 'NASA Data & Resources',
    title: 'AppEEARS (LP DAAC)',
    agency: 'NASA EOSDIS Land Processes DAAC',
    summary:
      'Application for Extracting and Exploring Analysis Ready Samples—transforms geospatial MODIS/SMAP subsets into point and area time series.',
    linkedDatasetId: 'modis_ndvi',
  },
  {
    category: 'NASA Data & Resources',
    title: 'Climate Data Online (CDO)',
    agency: 'NOAA NCDC',
    summary:
      'Global historical weather, station history, and gridded surface temperature/precipitation archive with interactive map filtering.',
    linkedDatasetId: 'merra2_t2m',
  },
  {
    category: 'NASA Data & Resources',
    title: 'SeaWiFS Chlorophyll in River-Influenced Coastal Regions',
    agency: 'NASA Ocean Biology (OB.DAAC)',
    summary:
      'Demonstrates multi-year satellite chlorophyll time-series construction and non-parametric trend significance testing across river plumes.',
    linkedDatasetId: 'seawifs_chl',
  },
  {
    category: 'Space Agency Partners (KNMI & CSA)',
    title: 'SWOT Mission (Surface Water & Ocean Topography)',
    agency: 'NASA / CNES / CSA / UK Space Agency',
    summary:
      'Surveys 90% of Earth’s surface water using Ka-band radar interferometry to track elevation changes across rivers, lakes, reservoirs, and oceans.',
    linkedDatasetId: 'swot_water',
  },
  {
    category: 'Space Agency Partners (KNMI & CSA)',
    title: 'RADARSAT Constellation Mission (RCM)',
    agency: 'Canadian Space Agency (CSA)',
    summary:
      'Trio of all-weather, day-and-night C-band SAR satellites supporting maritime ice surveillance, disaster response, and coastal/wetland ecosystem monitoring.',
    linkedDatasetId: 'rcm_sar',
  },
  {
    category: 'Space Agency Partners (KNMI & CSA)',
    title: 'GEO.ca Open Geospatial Portal',
    agency: 'Natural Resources Canada / CSA',
    summary:
      'Definitive Canadian open geospatial repository for Arctic sea ice, boreal forest hydrology, and regional environmental change layers.',
    linkedDatasetId: 'rcm_sar',
  },
  {
    category: 'Space Agency Partners (KNMI & CSA)',
    title: 'KNMI Climate Explorer',
    agency: 'Royal Netherlands Meteorological Institute',
    summary:
      'Web-based climate research tool for computing spatial trend fields, teleconnection indices (IOD, ENSO), and local statistical significance.',
    linkedDatasetId: 'mur_sst',
  },
  {
    category: 'Statistical & SAR Methodology',
    title: 'Mann-Kendall & Theil-Sen Trend Testing (α = 0.05)',
    agency: 'Non-Parametric Time-Series Framework',
    summary:
      'Combines rank-based Mann-Kendall Z/p-value significance testing (robust to skewed climate distributions) with Theil-Sen median slopes and LOESS smoothing.',
  },
  {
    category: 'Statistical & SAR Methodology',
    title: 'SAR Ecosystem & Coastal Change Workflow',
    agency: 'CSA Python & QGIS SAR Guidance',
    summary:
      'Applies radiometric calibration and multi-temporal C-band backscatter anomalies to distinguish persistent structural change from synoptic noise.',
    linkedDatasetId: 'rcm_sar',
  },
];

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function getEffectiveBounds(
  dataset: DatasetSpec,
  dataMode: DataMode
): { min: number; mid: number; max: number } {
  if (dataMode === 'historical') {
    return { min: dataset.min, mid: dataset.mid, max: dataset.max };
  }
  const factor = dataMode === 'rcp45' ? 1.3 : 1.75;
  // Cap sea ice concentration anomaly cleanly at [-85, 85]%
  if (dataset.id === 'amsr2_ice') {
    const bound = Math.min(85, Math.round(dataset.max * factor));
    return { min: -bound, mid: 0, max: bound };
  }
  return {
    min: Number((dataset.min * factor).toFixed(dataset.decimals)),
    mid: 0,
    max: Number((dataset.max * factor).toFixed(dataset.decimals)),
  };
}
