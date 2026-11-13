import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Globe,
  Map as MapIcon,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  MoveHorizontal,
  Crosshair,
  Cloud,
} from 'lucide-react';
import {
  DatasetSpec,
  MONTH_ABBR,
  TELECONNECTIONS,
  TeleconnectionId,
  getEffectivePoles,
} from '../data/datasets';
import {
  WORLD_LAND_POLYGONS,
  formatCoord,
} from '../data/worldCoastlines';
import {
  BM_HEIGHT,
  BM_WIDTH,
  getBlueMarbleData,
} from '../engine/blueMarbleTexture';
import {
  computeGeodesicPoints,
  valueToDivergingRGB,
} from '../engine/statistics';

export type ViewMode = '2d' | '3d';

interface MapViewportProps {
  dataset: DatasetSpec;
  teleconnectionId: TeleconnectionId;
  year: number;
  month: number;
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  maskNoise: boolean;
  onToggleMaskNoise: (checked: boolean) => void;
  anomalyGrid: Float32Array;
  compareGrid: Float32Array;
  significanceMask: Uint8Array;
  compareEnabled: boolean;
  onToggleCompare: (enabled: boolean) => void;
  compareYear: number;
  onChangeCompareYear: (y: number) => void;
  probedPoint: { lat: number; lon: number } | null;
  onProbePoint: (lat: number, lon: number) => void;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Deterministic subtle starfield for deep space backdrop
const STARS: { rx: number; ry: number; size: number; alpha: number }[] = [];
for (let i = 0; i < 140; i++) {
  const s1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  const s2 = Math.sin(i * 93.9898 + 19.133) * 24634.6345;
  const s3 = Math.sin(i * 41.1234 + 5.712) * 18421.1234;
  STARS.push({
    rx: s1 - Math.floor(s1),
    ry: s2 - Math.floor(s2),
    size: (s3 - Math.floor(s3)) > 0.82 ? 1.4 : 0.85,
    alpha: 0.25 + (s3 - Math.floor(s3)) * 0.55,
  });
}

function build2DCompositeCanvas(
  grid: Float32Array,
  dataset: DatasetSpec,
  significanceMask: Uint8Array,
  maskNoise: boolean,
  overlayOpacity: number,
  showClouds: boolean
): HTMLCanvasElement {
  const bm = getBlueMarbleData();
  const canvas = document.createElement('canvas');
  canvas.width = BM_WIDTH;
  canvas.height = BM_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(BM_WIDTH, BM_HEIGHT);
  const data = img.data;
  const absMax = Math.max(Math.abs(dataset.min), Math.abs(dataset.max), 1e-6);

  for (let y = 0; y < BM_HEIGHT; y++) {
    const gy = Math.min(179, y >> 1);
    const maskY = Math.min(59, Math.floor(gy / 3));
    for (let x = 0; x < BM_WIDTH; x++) {
      const bmIdx = y * BM_WIDTH + x;
      const rgbIdx = bmIdx * 3;
      const pIdx = bmIdx * 4;

      let r = bm.rgb[rgbIdx];
      let g = bm.rgb[rgbIdx + 1];
      let b = bm.rgb[rgbIdx + 2];

      if (showClouds) {
        const ca = (bm.clouds[bmIdx] / 255) * 0.45;
        r = Math.round(r * (1 - ca) + 248 * ca);
        g = Math.round(g * (1 - ca) + 251 * ca);
        b = Math.round(b * (1 - ca) + 255 * ca);
      }

      const gx = Math.min(359, x >> 1);
      const val = grid[gy * 360 + gx];

      if (!Number.isNaN(val) && overlayOpacity > 0.01) {
        const maskX = Math.min(119, Math.floor(gx / 3));
        const isSignificant = significanceMask[maskY * 120 + maskX] === 1;
        if (!maskNoise || isSignificant) {
          const norm = val / absMax;
          const [ar, ag, ab] = valueToDivergingRGB(norm);
          const alpha = overlayOpacity * Math.min(0.92, Math.abs(norm) * 0.95 + 0.14);
          r = Math.round(r * (1 - alpha) + ar * alpha);
          g = Math.round(g * (1 - alpha) + ag * alpha);
          b = Math.round(b * (1 - alpha) + ab * alpha);
        }
      }

      data[pIdx] = r;
      data[pIdx + 1] = g;
      data[pIdx + 2] = b;
      data[pIdx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

export const MapViewport: React.FC<MapViewportProps> = ({
  dataset,
  teleconnectionId,
  year,
  month,
  viewMode,
  onChangeViewMode,
  maskNoise,
  onToggleMaskNoise,
  anomalyGrid,
  compareGrid,
  significanceMask,
  compareEnabled,
  onToggleCompare,
  compareYear,
  onChangeCompareYear,
  probedPoint,
  onProbePoint,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [splitRatio, setSplitRatio] = useState(0.5);
  const draggingSplitRef = useRef(false);

  // Photorealistic Blue Marble controls
  const [overlayOpacity, setOverlayOpacity] = useState(0.52);
  const [showClouds, setShowClouds] = useState(true);
  const [showGraticules, setShowGraticules] = useState(true);

  const [hoverInfo, setHoverInfo] = useState<{
    lat: number;
    lon: number;
    val: number;
    significant: boolean;
  } | null>(null);

  // Start facing Africa / Red Sea / Indian Ocean just like classic Blue Marble framing
  const globeStateRef = useRef({
    centerLon: 44,
    centerLat: 10,
    velLon: 0,
    velLat: 0,
    targetLon: null as number | null,
    targetLat: null as number | null,
    zoom: 1.0,
    isDragging: false,
    dragMoved: false,
    lastX: 0,
    lastY: 0,
    autoSpin: false,
  });

  const [globeZoomLabel, setGlobeZoomLabel] = useState(1.0);
  const [autoSpin, setAutoSpin] = useState(false);

  const blueMarble = useMemo(() => getBlueMarbleData(), []);

  const primaryTex = useMemo(
    () =>
      build2DCompositeCanvas(
        anomalyGrid,
        dataset,
        significanceMask,
        maskNoise,
        overlayOpacity,
        showClouds
      ),
    [anomalyGrid, dataset, significanceMask, maskNoise, overlayOpacity, showClouds]
  );

  const compareTex = useMemo(
    () =>
      build2DCompositeCanvas(
        compareGrid,
        dataset,
        significanceMask,
        maskNoise,
        overlayOpacity,
        showClouds
      ),
    [compareGrid, dataset, significanceMask, maskNoise, overlayOpacity, showClouds]
  );

  const tele = TELECONNECTIONS[teleconnectionId];
  const effectivePoles = useMemo(
    () => getEffectivePoles(teleconnectionId, dataset),
    [teleconnectionId, dataset]
  );

  const geodesicPts = useMemo(() => {
    if (!effectivePoles.poleA || !effectivePoles.poleB) return [];
    return computeGeodesicPoints(
      effectivePoles.poleA.lat,
      effectivePoles.poleA.lon,
      effectivePoles.poleB.lat,
      effectivePoles.poleB.lon,
      72
    );
  }, [effectivePoles]);

  const isFirstMountRef = useRef(true);
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    globeStateRef.current.targetLon = tele.focusLon;
    globeStateRef.current.targetLat = tele.focusLat;
    globeStateRef.current.velLon = 0;
    globeStateRef.current.velLat = 0;
  }, [tele.focusLat, tele.focusLon]);

  useEffect(() => {
    globeStateRef.current.autoSpin = autoSpin;
  }, [autoSpin]);

  const lookupAt = (lat: number, lon: number) => {
    const normLon = ((lon + 180) % 360 + 360) % 360 - 180;
    const gx = Math.min(359, Math.max(0, Math.floor(normLon + 179.5 + 0.5)));
    const gy = Math.min(179, Math.max(0, Math.floor(89.5 - lat + 0.5)));
    const val = anomalyGrid[gy * 360 + gx];
    const mx = Math.min(119, Math.floor(gx / 3));
    const my = Math.min(59, Math.floor(gy / 3));
    const significant = significanceMask[my * 120 + mx] === 1;
    return { val, significant };
  };

  const get2DMapRect = (cssW: number, cssH: number) => {
    const padX = 28;
    const padY = 24;
    const availW = Math.max(100, cssW - padX * 2);
    const availH = Math.max(80, cssH - padY * 2);
    let mapW = availW;
    let mapH = mapW / 2;
    if (mapH > availH) {
      mapH = availH;
      mapW = mapH * 2;
    }
    const x0 = (cssW - mapW) * 0.5;
    const y0 = (cssH - mapH) * 0.5;
    return { x0, y0, mapW, mapH };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const sphereBufCanvas = document.createElement('canvas');
    const sphereBufCtx = sphereBufCanvas.getContext('2d')!;
    const absMax = Math.max(Math.abs(dataset.min), Math.abs(dataset.max), 1e-6);

    let rafId = 0;
    const startTime = performance.now();

    const drawFrame = (now: number) => {
      const rect = container.getBoundingClientRect();
      const cssW = Math.max(320, Math.floor(rect.width));
      const cssH = Math.max(280, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      const elapsed = prefersReducedMotion ? 0 : (now - startTime) * 0.001;

      if (viewMode === '2d') {
        draw2DMap(ctx, cssW, cssH, elapsed);
      } else {
        update3DCamera();
        draw3DGlobe(ctx, cssW, cssH, elapsed);
      }

      ctx.restore();

      const needsAnimation =
        !prefersReducedMotion &&
        (geodesicPts.length > 0 ||
          (viewMode === '3d' &&
            (globeStateRef.current.autoSpin ||
              Math.abs(globeStateRef.current.velLon) > 0.01 ||
              Math.abs(globeStateRef.current.velLat) > 0.01 ||
              globeStateRef.current.targetLon !== null)));

      if (needsAnimation) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    const update3DCamera = () => {
      const gs = globeStateRef.current;
      if (!gs.isDragging) {
        if (gs.targetLon !== null && gs.targetLat !== null) {
          let dLon = gs.targetLon - gs.centerLon;
          if (dLon > 180) dLon -= 360;
          if (dLon < -180) dLon += 360;
          const dLat = gs.targetLat - gs.centerLat;
          gs.centerLon += dLon * 0.12;
          gs.centerLat += dLat * 0.12;
          if (Math.abs(dLon) < 0.25 && Math.abs(dLat) < 0.25) {
            gs.centerLon = gs.targetLon;
            gs.centerLat = gs.targetLat;
            gs.targetLon = null;
            gs.targetLat = null;
          }
        } else {
          gs.centerLon += gs.velLon;
          gs.centerLat = Math.max(-82, Math.min(82, gs.centerLat + gs.velLat));
          gs.velLon *= 0.92;
          gs.velLat *= 0.92;
          if (gs.autoSpin) {
            gs.centerLon -= 0.16;
          }
        }
        gs.centerLon = (((gs.centerLon + 180) % 360) + 360) % 360 - 180;
      }
    };

    const draw2DMap = (
      ctx: CanvasRenderingContext2D,
      cssW: number,
      cssH: number,
      elapsed: number
    ) => {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, cssW, cssH);

      const { x0, y0, mapW, mapH } = get2DMapRect(cssW, cssH);
      const projX = (lon: number) => x0 + ((lon + 180) / 360) * mapW;
      const projY = (lat: number) => y0 + ((90 - lat) / 180) * mapH;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, mapW, mapH);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;

      if (compareEnabled) {
        const splitX = x0 + splitRatio * mapW;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, splitX - x0, mapH);
        ctx.clip();
        ctx.drawImage(primaryTex, x0, y0, mapW, mapH);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, y0, x0 + mapW - splitX, mapH);
        ctx.clip();
        ctx.drawImage(compareTex, x0, y0, mapW, mapH);
        ctx.restore();
      } else {
        ctx.drawImage(primaryTex, x0, y0, mapW, mapH);
      }

      if (showGraticules) {
        ctx.lineWidth = 0.75;
        for (let lon = -150; lon <= 150; lon += 30) {
          const px = projX(lon);
          ctx.strokeStyle = lon === 0 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.16)';
          ctx.beginPath();
          ctx.moveTo(px, y0);
          ctx.lineTo(px, y0 + mapH);
          ctx.stroke();
        }
        for (let lat = -60; lat <= 60; lat += 30) {
          const py = projY(lat);
          ctx.strokeStyle = lat === 0 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.16)';
          ctx.beginPath();
          ctx.moveTo(x0, py);
          ctx.lineTo(x0 + mapW, py);
          ctx.stroke();
        }
      }

      // Crisp coastline highlights
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.lineWidth = 0.85;
      ctx.lineJoin = 'round';
      for (const poly of WORLD_LAND_POLYGONS) {
        ctx.beginPath();
        for (let i = 0; i < poly.length; i++) {
          const px = projX(poly[i][0]);
          const py = projY(poly[i][1]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Geodesic Arc + Pole A/B
      if (geodesicPts.length > 1 && effectivePoles.poleA && effectivePoles.poleB) {
        ctx.save();
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        for (let i = 0; i < geodesicPts.length; i++) {
          const [lon, lat] = geodesicPts[i];
          const px = projX(lon);
          const py = projY(lat);
          if (i === 0 || Math.abs(lon - geodesicPts[i - 1][0]) > 180) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();

        ctx.strokeStyle = '#22D3EE';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 7]);
        ctx.lineDashOffset = -elapsed * 28;
        ctx.beginPath();
        for (let i = 0; i < geodesicPts.length; i++) {
          const [lon, lat] = geodesicPts[i];
          const px = projX(lon);
          const py = projY(lat);
          if (i === 0 || Math.abs(lon - geodesicPts[i - 1][0]) > 180) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
        ctx.restore();

        drawReticle(ctx, projX(effectivePoles.poleA.lon), projY(effectivePoles.poleA.lat), '#22D3EE', 'Pole A (Surplus)', 'right', true);
        drawReticle(ctx, projX(effectivePoles.poleB.lon), projY(effectivePoles.poleB.lat), '#FB923C', 'Pole B (Deficit)', 'left', true);
      }

      if (probedPoint) {
        drawProbeMarker(ctx, projX(probedPoint.lon), projY(probedPoint.lat));
      }

      if (compareEnabled) {
        const splitX = x0 + splitRatio * mapW;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(splitX, y0);
        ctx.lineTo(splitX, y0 + mapH);
        ctx.stroke();

        ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        const leftTxt = `${MONTH_ABBR[month - 1]} ${year}`;
        const rightTxt = `Compare: ${MONTH_ABBR[month - 1]} ${compareYear}`;

        if (splitX - x0 > 90) {
          ctx.fillStyle = 'rgba(11, 61, 145, 0.92)';
          ctx.fillRect(splitX - 84, y0 + 8, 76, 20);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(leftTxt, splitX - 77, y0 + 21);
        }
        if (x0 + mapW - splitX > 130) {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
          ctx.fillRect(splitX + 8, y0 + 8, 122, 20);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(rightTxt, splitX + 15, y0 + 21);
        }

        const gripY = y0 + mapH * 0.5;
        ctx.fillStyle = '#0B3D91';
        ctx.beginPath();
        ctx.arc(splitX, gripY, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(splitX - 3, gripY - 4);
        ctx.lineTo(splitX - 7, gripY);
        ctx.lineTo(splitX - 3, gripY + 4);
        ctx.moveTo(splitX + 3, gripY - 4);
        ctx.lineTo(splitX + 7, gripY);
        ctx.lineTo(splitX + 3, gripY + 4);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      ctx.restore();

      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, mapW, mapH);

      ctx.fillStyle = '#64748B';
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      for (const lon of [-120, -60, 0, 60, 120]) {
        const label = lon === 0 ? '0°' : lon < 0 ? `${Math.abs(lon)}°W` : `${lon}°E`;
        ctx.fillText(label, projX(lon), y0 + mapH + 13);
      }
      ctx.textAlign = 'right';
      for (const lat of [-60, 0, 60]) {
        const label = lat === 0 ? '0°' : lat < 0 ? `${Math.abs(lat)}°S` : `${lat}°N`;
        ctx.fillText(label, x0 - 5, projY(lat) + 3);
      }
      ctx.textAlign = 'left';
    };

    const draw3DGlobe = (
      ctx: CanvasRenderingContext2D,
      cssW: number,
      cssH: number,
      elapsed: number
    ) => {
      const gs = globeStateRef.current;
      const cx = cssW * 0.5;
      const cy = cssH * 0.5;
      const baseR = Math.min(cssW, cssH) * 0.405 * gs.zoom;

      // 1. Deep Black Orbital Space Backdrop
      ctx.fillStyle = '#020409';
      ctx.fillRect(0, 0, cssW, cssH);

      // Subtle distant stars
      for (const s of STARS) {
        const sx = s.rx * cssW;
        const sy = s.ry * cssH;
        const dx = sx - cx;
        const dy = sy - cy;
        if (dx * dx + dy * dy > baseR * baseR * 1.18) {
          ctx.fillStyle = `rgba(226, 232, 240, ${s.alpha})`;
          ctx.fillRect(sx, sy, s.size, s.size);
        }
      }

      // 2. Luminous Rayleigh Blue Atmospheric Outer Halo (NASA Blue Marble signature)
      const outerGlow = ctx.createRadialGradient(cx, cy, baseR * 0.94, cx, cy, baseR * 1.16);
      outerGlow.addColorStop(0, 'rgba(125, 195, 255, 0.72)');
      outerGlow.addColorStop(0.28, 'rgba(59, 130, 246, 0.45)');
      outerGlow.addColorStop(0.6, 'rgba(29, 78, 216, 0.16)');
      outerGlow.addColorStop(1, 'rgba(2, 4, 9, 0)');
      ctx.fillStyle = outerGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 1.16, 0, Math.PI * 2);
      ctx.fill();

      // 3. Pixel-Exact Bilinear Blue Marble + Anomaly + Cloud + Specular Ocean Sphere
      const texR = Math.min(220, Math.max(130, Math.round(baseR * 0.92)));
      const texSize = texR * 2;
      if (sphereBufCanvas.width !== texSize || sphereBufCanvas.height !== texSize) {
        sphereBufCanvas.width = texSize;
        sphereBufCanvas.height = texSize;
      }

      const imgData = sphereBufCtx.createImageData(texSize, texSize);
      const buf = imgData.data;

      const lam0 = gs.centerLon * DEG2RAD;
      const phi0 = gs.centerLat * DEG2RAD;
      const sinPhi0 = Math.sin(phi0);
      const cosPhi0 = Math.cos(phi0);

      // Solar key light vector (upper-left-front for rich 3D depth)
      const lx = -0.32;
      const ly = 0.28;
      const lz = 0.905;

      const bmRgb = blueMarble.rgb;
      const bmClouds = blueMarble.clouds;
      const bmLand = blueMarble.landMask;

      for (let py = 0; py < texSize; py++) {
        const ny = (texR - py) / texR;
        const ny2 = ny * ny;
        for (let px = 0; px < texSize; px++) {
          const nx = (px - texR) / texR;
          const r2 = nx * nx + ny2;
          if (r2 > 1.0) continue;

          const nz = Math.sqrt(1.0 - r2);
          const sinLat = Math.max(-1, Math.min(1, ny * cosPhi0 + nz * sinPhi0));
          const lat = Math.asin(sinLat) * RAD2DEG;
          const lon = (lam0 + Math.atan2(nx, nz * cosPhi0 - ny * sinPhi0)) * RAD2DEG;
          const normLon = (((lon + 180) % 360) + 360) % 360 - 180;

          // Continuous Blue Marble coordinates (720 x 360)
          const fx = ((normLon + 180) / 360) * BM_WIDTH - 0.5;
          const fy = ((90 - lat) / 180) * BM_HEIGHT - 0.5;
          const x0i = ((Math.floor(fx) % BM_WIDTH) + BM_WIDTH) % BM_WIDTH;
          const x1i = (x0i + 1) % BM_WIDTH;
          const y0i = Math.max(0, Math.min(BM_HEIGHT - 1, Math.floor(fy)));
          const y1i = Math.min(BM_HEIGHT - 1, y0i + 1);
          const wx = fx - Math.floor(fx);
          const wy = Math.max(0, Math.min(1, fy - Math.floor(fy)));

          const i00 = y0i * BM_WIDTH + x0i;
          const i10 = y0i * BM_WIDTH + x1i;
          const i01 = y1i * BM_WIDTH + x0i;
          const i11 = y1i * BM_WIDTH + x1i;

          const w00 = (1 - wx) * (1 - wy);
          const w10 = wx * (1 - wy);
          const w01 = (1 - wx) * wy;
          const w11 = wx * wy;

          let cr =
            bmRgb[i00 * 3] * w00 +
            bmRgb[i10 * 3] * w10 +
            bmRgb[i01 * 3] * w01 +
            bmRgb[i11 * 3] * w11;
          let cg =
            bmRgb[i00 * 3 + 1] * w00 +
            bmRgb[i10 * 3 + 1] * w10 +
            bmRgb[i01 * 3 + 1] * w01 +
            bmRgb[i11 * 3 + 1] * w11;
          let cb =
            bmRgb[i00 * 3 + 2] * w00 +
            bmRgb[i10 * 3 + 2] * w10 +
            bmRgb[i01 * 3 + 2] * w01 +
            bmRgb[i11 * 3 + 2] * w11;

          // Subtle ocean specular highlight
          const isOcean = bmLand[i00] === 0;
          const dotL = Math.max(0, nx * lx + ny * ly + nz * lz);
          let spec = 0;
          if (isOcean && dotL > 0.55) {
            // Blinn-Phong half vector with view=(0,0,1)
            const hx = lx * 0.51;
            const hy = ly * 0.51;
            const hz = (lz + 1) * 0.51;
            const ndoth = Math.max(0, nx * hx + ny * hy + nz * hz);
            spec = Math.pow(ndoth, 28) * 38;
          }

          // Scientific Anomaly Overlay blending
          const gx = Math.min(359, Math.max(0, Math.floor(normLon + 179.5 + 0.5)));
          const gy = Math.min(179, Math.max(0, Math.floor(89.5 - lat + 0.5)));
          const gIdx = gy * 360 + gx;
          const val = anomalyGrid[gIdx];
          if (!Number.isNaN(val) && overlayOpacity > 0.01) {
            const mx = Math.min(119, Math.floor(gx / 3));
            const my = Math.min(59, Math.floor(gy / 3));
            const isSig = significanceMask[my * 120 + mx] === 1;
            if (!maskNoise || isSig) {
              const norm = val / absMax;
              const [ar, ag, ab] = valueToDivergingRGB(norm);
              const strength = overlayOpacity * Math.min(0.9, Math.abs(norm) * 0.95 + 0.14);
              cr = cr * (1 - strength) + ar * strength;
              cg = cg * (1 - strength) + ag * strength;
              cb = cb * (1 - strength) + ab * strength;
            }
          }

          // Wispy swirling clouds
          if (showClouds) {
            const cAlpha =
              ((bmClouds[i00] * w00 +
                bmClouds[i10] * w10 +
                bmClouds[i01] * w01 +
                bmClouds[i11] * w11) /
                255) *
              0.52;
            cr = cr * (1 - cAlpha) + 250 * cAlpha;
            cg = cg * (1 - cAlpha) + 252 * cAlpha;
            cb = cb * (1 - cAlpha) + 255 * cAlpha;
          }

          // Solar diffuse lighting + soft terminator limb falloff
          const diffuse = 0.24 + 0.86 * Math.pow(dotL, 0.72);
          // Inner Rayleigh blue atmospheric limb scattering
          const fresnel = Math.pow(1 - nz, 2.7);
          const atmFactor = fresnel * 0.62;

          const litR = cr * diffuse + spec;
          const litG = cg * diffuse + spec * 0.95;
          const litB = cb * diffuse + spec * 0.9;

          const pIdx = (py * texSize + px) * 4;
          buf[pIdx] = Math.min(255, Math.round(litR * (1 - atmFactor) + 95 * atmFactor));
          buf[pIdx + 1] = Math.min(255, Math.round(litG * (1 - atmFactor) + 168 * atmFactor));
          buf[pIdx + 2] = Math.min(255, Math.round(litB * (1 - atmFactor) + 255 * atmFactor));
          buf[pIdx + 3] = 255;
        }
      }

      sphereBufCtx.putImageData(imgData, 0, 0);

      // Draw spherical bitmap cleanly inside clipped Earth circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sphereBufCanvas, cx - baseR, cy - baseR, baseR * 2, baseR * 2);

      const project3D = (lat: number, lon: number, alt = 1.0) => {
        const phi = lat * DEG2RAD;
        const lam = lon * DEG2RAD;
        const dLam = lam - lam0;
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);
        const cosDLam = Math.cos(dLam);
        const x = cosPhi * Math.sin(dLam);
        const y = cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDLam;
        const z = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDLam;
        return {
          px: cx + x * baseR * alt,
          py: cy - y * baseR * alt,
          z,
        };
      };

      // Optional subtle 3D Graticules
      if (showGraticules) {
        ctx.lineWidth = 0.7;
        for (let lon = -150; lon <= 180; lon += 30) {
          ctx.strokeStyle = lon === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
          ctx.beginPath();
          let started = false;
          for (let lat = -88; lat <= 88; lat += 4) {
            const p = project3D(lat, lon);
            if (p.z > 0) {
              if (!started) {
                ctx.moveTo(p.px, p.py);
                started = true;
              } else {
                ctx.lineTo(p.px, p.py);
              }
            } else {
              started = false;
            }
          }
          ctx.stroke();
        }
        for (let lat = -60; lat <= 60; lat += 30) {
          ctx.strokeStyle = lat === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
          ctx.beginPath();
          let started = false;
          for (let lon = -180; lon <= 180; lon += 4) {
            const p = project3D(lat, lon);
            if (p.z > 0) {
              if (!started) {
                ctx.moveTo(p.px, p.py);
                started = true;
              } else {
                ctx.lineTo(p.px, p.py);
              }
            } else {
              started = false;
            }
          }
          ctx.stroke();
        }
      }

      ctx.restore();

      // Atmospheric bright rim edge
      ctx.strokeStyle = 'rgba(147, 197, 253, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
      ctx.stroke();

      // Elevated 3D Geodesic Arc + Pole A/B Reticles
      if (geodesicPts.length > 1 && effectivePoles.poleA && effectivePoles.poleB) {
        const arcScreenPts: { px: number; py: number; z: number }[] = [];
        for (let i = 0; i < geodesicPts.length; i++) {
          const f = i / (geodesicPts.length - 1);
          const alt = 1.0 + 0.14 * Math.sin(Math.PI * f);
          const [lon, lat] = geodesicPts[i];
          arcScreenPts.push(project3D(lat, lon, alt));
        }

        ctx.save();
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.45)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        let started = false;
        for (const p of arcScreenPts) {
          if (p.z > -0.05) {
            if (!started) {
              ctx.moveTo(p.px, p.py);
              started = true;
            } else {
              ctx.lineTo(p.px, p.py);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();

        ctx.strokeStyle = '#67E8F9';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 6]);
        ctx.lineDashOffset = -elapsed * 30;
        ctx.beginPath();
        started = false;
        for (const p of arcScreenPts) {
          if (p.z > -0.05) {
            if (!started) {
              ctx.moveTo(p.px, p.py);
              started = true;
            } else {
              ctx.lineTo(p.px, p.py);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
        ctx.restore();

        const pA = project3D(effectivePoles.poleA.lat, effectivePoles.poleA.lon, 1.0);
        if (pA.z > 0.04) {
          drawReticle(ctx, pA.px, pA.py, '#22D3EE', 'Pole A (Surplus)', 'right', true);
        }
        const pB = project3D(effectivePoles.poleB.lat, effectivePoles.poleB.lon, 1.0);
        if (pB.z > 0.04) {
          drawReticle(ctx, pB.px, pB.py, '#FB923C', 'Pole B (Deficit)', 'left', true);
        }
      }

      if (probedPoint) {
        const pProbe = project3D(probedPoint.lat, probedPoint.lon, 1.0);
        if (pProbe.z > 0.02) {
          drawProbeMarker(ctx, pProbe.px, pProbe.py);
        }
      }
    };

    rafId = requestAnimationFrame(drawFrame);

    const resizeObs = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(drawFrame);
    });
    resizeObs.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObs.disconnect();
    };
  }, [
    viewMode,
    blueMarble,
    primaryTex,
    compareTex,
    compareEnabled,
    splitRatio,
    year,
    compareYear,
    month,
    tele,
    geodesicPts,
    probedPoint,
    anomalyGrid,
    significanceMask,
    maskNoise,
    overlayOpacity,
    showClouds,
    showGraticules,
    dataset,
    autoSpin,
  ]);

  const pointerToLatLon = (clientX: number, clientY: number): { lat: number; lon: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (viewMode === '2d') {
      const { x0, y0, mapW, mapH } = get2DMapRect(rect.width, rect.height);
      if (x < x0 || x > x0 + mapW || y < y0 || y > y0 + mapH) return null;
      const lon = ((x - x0) / mapW) * 360 - 180;
      const lat = 90 - ((y - y0) / mapH) * 180;
      return { lat, lon };
    } else {
      const gs = globeStateRef.current;
      const cx = rect.width * 0.5;
      const cy = rect.height * 0.5;
      const baseR = Math.min(rect.width, rect.height) * 0.405 * gs.zoom;
      const nx = (x - cx) / baseR;
      const ny = (cy - y) / baseR;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1.0) return null;
      const nz = Math.sqrt(1.0 - r2);
      const lam0 = gs.centerLon * DEG2RAD;
      const phi0 = gs.centerLat * DEG2RAD;
      const sinPhi0 = Math.sin(phi0);
      const cosPhi0 = Math.cos(phi0);
      const sinLat = Math.max(-1, Math.min(1, ny * cosPhi0 + nz * sinPhi0));
      const lat = Math.asin(sinLat) * RAD2DEG;
      const lon = (lam0 + Math.atan2(nx, nz * cosPhi0 - ny * sinPhi0)) * RAD2DEG;
      const normLon = (((lon + 180) % 360) + 360) % 360 - 180;
      return { lat, lon: normLon };
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (viewMode === '2d') {
      if (compareEnabled) {
        const { x0, mapW } = get2DMapRect(rect.width, rect.height);
        const splitX = x0 + splitRatio * mapW;
        if (Math.abs(x - splitX) <= 16) {
          draggingSplitRef.current = true;
          return;
        }
      }
      const coords = pointerToLatLon(e.clientX, e.clientY);
      if (coords) {
        onProbePoint(coords.lat, coords.lon);
      }
    } else {
      const gs = globeStateRef.current;
      gs.isDragging = true;
      gs.dragMoved = false;
      gs.lastX = e.clientX;
      gs.lastY = e.clientY;
      gs.targetLon = null;
      gs.targetLat = null;
      gs.velLon = 0;
      gs.velLat = 0;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (viewMode === '2d' && draggingSplitRef.current) {
      const { x0, mapW } = get2DMapRect(rect.width, rect.height);
      const ratio = Math.max(0.06, Math.min(0.94, (e.clientX - rect.left - x0) / mapW));
      setSplitRatio(ratio);
      return;
    }

    if (viewMode === '3d' && globeStateRef.current.isDragging) {
      const gs = globeStateRef.current;
      const dx = e.clientX - gs.lastX;
      const dy = e.clientY - gs.lastY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) gs.dragMoved = true;
      const sensitivity = 0.38 / gs.zoom;
      gs.velLon = -dx * sensitivity;
      gs.velLat = dy * sensitivity;
      gs.centerLon = (((gs.centerLon + gs.velLon + 180) % 360) + 360) % 360 - 180;
      gs.centerLat = Math.max(-82, Math.min(82, gs.centerLat + gs.velLat));
      gs.lastX = e.clientX;
      gs.lastY = e.clientY;
      return;
    }

    const coords = pointerToLatLon(e.clientX, e.clientY);
    if (coords) {
      const { val, significant } = lookupAt(coords.lat, coords.lon);
      setHoverInfo({ lat: coords.lat, lon: coords.lon, val, significant });
    } else {
      setHoverInfo(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    if (draggingSplitRef.current) {
      draggingSplitRef.current = false;
      return;
    }

    if (viewMode === '3d') {
      const gs = globeStateRef.current;
      const wasClick = gs.isDragging && !gs.dragMoved;
      gs.isDragging = false;
      if (wasClick) {
        const coords = pointerToLatLon(e.clientX, e.clientY);
        if (coords) onProbePoint(coords.lat, coords.lon);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (viewMode !== '3d') return;
    e.preventDefault();
    const gs = globeStateRef.current;
    const nextZoom = Math.max(0.68, Math.min(2.3, gs.zoom - e.deltaY * 0.0012));
    gs.zoom = nextZoom;
    setGlobeZoomLabel(nextZoom);
  };

  const adjustZoom = (delta: number) => {
    const gs = globeStateRef.current;
    const nextZoom = Math.max(0.68, Math.min(2.3, gs.zoom + delta));
    gs.zoom = nextZoom;
    setGlobeZoomLabel(nextZoom);
  };

  const reset3DView = () => {
    const gs = globeStateRef.current;
    gs.zoom = 1.0;
    gs.targetLon = tele.id === 'iod' ? 44 : tele.focusLon;
    gs.targetLat = tele.id === 'iod' ? 10 : tele.focusLat;
    gs.velLon = 0;
    gs.velLat = 0;
    setGlobeZoomLabel(1.0);
  };

  return (
    <section
      aria-label="Geospatial map and 3D globe viewport"
      className="flex-1 min-w-0 flex flex-col bg-slate-50 relative"
    >
      {/* Viewport Toolbar */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* 2D / 3D Mode Toggle */}
          <div
            role="group"
            aria-label="Projection mode"
            className="inline-flex items-center p-0.5 bg-slate-100 rounded-md border border-slate-200"
          >
            <button
              type="button"
              onClick={() => onChangeViewMode('2d')}
              className={`px-2.5 py-1 text-xs font-medium rounded flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                viewMode === '2d'
                  ? 'bg-white text-[#0B3D91] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              2D Planar Map
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('3d')}
              className={`px-2.5 py-1 text-xs font-medium rounded flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                viewMode === '3d'
                  ? 'bg-white text-[#0B3D91] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              3D Globe
            </button>
          </div>

          {/* Mask Scientific Noise Checkbox */}
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={maskNoise}
              onChange={(e) => onToggleMaskNoise(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#0B3D91] rounded cursor-pointer"
            />
            Mask Scientific Noise (p &gt;= 0.05)
          </label>

          {/* Clouds & Grid toggles */}
          <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50 select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={showClouds}
              onChange={(e) => setShowClouds(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#0B3D91] rounded cursor-pointer"
            />
            <Cloud className="w-3.5 h-3.5 text-slate-500" />
            Clouds
          </label>

          <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50 select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={showGraticules}
              onChange={(e) => setShowGraticules(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#0B3D91] rounded cursor-pointer"
            />
            Grid
          </label>
        </div>

        {/* Right Toolbar: Overlay Opacity + Mode Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 whitespace-nowrap">
            <span>Data Overlay</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(overlayOpacity * 100)}
              onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
              className="w-16 nasa-slider"
              aria-label="Anomaly overlay opacity"
            />
            <span className="font-mono tabular-nums w-8 text-slate-800">
              {Math.round(overlayOpacity * 100)}%
            </span>
          </label>

          {viewMode === '2d' ? (
            <div className="flex items-center gap-1.5">
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50 select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={compareEnabled}
                  onChange={(e) => onToggleCompare(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#0B3D91] rounded cursor-pointer"
                />
                <MoveHorizontal className="w-3.5 h-3.5 text-[#0B3D91]" />
                Compare To
              </label>
              {compareEnabled && (
                <select
                  aria-label="Comparison baseline year"
                  value={compareYear}
                  onChange={(e) => onChangeCompareYear(Number(e.target.value))}
                  className="px-2 py-1 text-xs font-mono font-medium bg-white border border-slate-300 rounded-md text-slate-800 focus:outline-none focus:border-[#0B3D91] cursor-pointer"
                >
                  {Array.from({ length: 20 }, (_, i) => 2005 + i).map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAutoSpin((s) => !s)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap cursor-pointer ${
                  autoSpin
                    ? 'bg-[#0B3D91] text-white border-[#0B3D91]'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {autoSpin ? 'Spinning' : 'Auto-Spin'}
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => adjustZoom(-0.2)}
                className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono text-slate-600 w-9 text-center tabular-nums">
                {globeZoomLabel.toFixed(1)}x
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => adjustZoom(0.2)}
                className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Reset globe orientation"
                onClick={reset3DView}
                className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Canvas Stage */}
      <div
        ref={containerRef}
        className="flex-1 relative min-h-[360px] sm:min-h-[440px] select-none overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => setHoverInfo(null)}
          onWheel={handleWheel}
          className={`w-full h-full block touch-none ${
            viewMode === '3d' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
          }`}
        />

        {/* Floating Live Coordinate & Anomaly HUD */}
        <div
          className={`absolute bottom-3 left-3 px-2.5 py-1.5 rounded-md border text-[11px] font-mono tabular-nums pointer-events-none flex items-center gap-2.5 ${
            viewMode === '3d'
              ? 'bg-slate-950/80 border-slate-700 text-slate-100'
              : 'bg-white/95 border-slate-300 text-slate-800 shadow-xs'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5 shrink-0 text-[#06B6D4]" />
          {hoverInfo ? (
            <>
              <span>{formatCoord(hoverInfo.lat, hoverInfo.lon)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {Number.isNaN(hoverInfo.val)
                  ? 'Domain Masked'
                  : `${hoverInfo.val >= 0 ? '+' : ''}${hoverInfo.val.toFixed(dataset.decimals)} ${dataset.unit}`}
              </span>
              {!Number.isNaN(hoverInfo.val) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className={hoverInfo.significant ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {hoverInfo.significant ? 'p < 0.05' : 'p >= 0.05'}
                  </span>
                </>
              )}
            </>
          ) : (
            <span>
              {viewMode === '3d'
                ? 'Drag to spin Blue Marble globe · Scroll to zoom · Click to probe'
                : 'Click map to probe point · Drag curtain to compare years'}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};

function drawReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
  align: 'left' | 'right',
  darkBg = false
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x - 15, y);
  ctx.lineTo(x - 6, y);
  ctx.moveTo(x + 6, y);
  ctx.lineTo(x + 15, y);
  ctx.moveTo(x, y - 15);
  ctx.lineTo(x, y - 6);
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x, y + 15);
  ctx.stroke();

  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const tw = ctx.measureText(label).width;
  const padX = 5;
  const boxW = tw + padX * 2;
  const boxH = 16;
  const lx = align === 'right' ? x + 14 : x - 14 - boxW;
  const ly = y - boxH * 0.5;

  ctx.fillStyle = darkBg ? 'rgba(2, 6, 23, 0.88)' : 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(lx, ly, boxW, boxH);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(lx, ly, boxW, boxH);

  ctx.fillStyle = darkBg ? '#F8FAFC' : '#0F172A';
  ctx.fillText(label, lx + padX, ly + 11.5);
  ctx.restore();
}

function drawProbeMarker(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#0B3D91';
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, 8.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
