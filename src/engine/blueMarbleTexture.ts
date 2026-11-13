import { computeIsLandRaw } from '../data/worldCoastlines';

export const BM_WIDTH = 720;
export const BM_HEIGHT = 360;
const DEG2RAD = Math.PI / 180;

export interface BlueMarbleData {
  width: number;
  height: number;
  rgb: Uint8Array; // 720 * 360 * 3 (natural Blue Marble surface without clouds)
  clouds: Uint8Array; // 720 * 360 (0..255 cloud opacity)
  landMask: Uint8Array; // 720 * 360 (0 or 1)
  canvas: HTMLCanvasElement; // Ready-to-draw 2D image
}

// Fast deterministic 3D value noise on unit sphere (zero seam, zero polar pinching)
function hash3(ix: number, iy: number, iz: number): number {
  let n = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const fz = smoothstep(z - iz);

  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);

  const nx00 = n000 + (n100 - n000) * fx;
  const nx10 = n010 + (n110 - n010) * fx;
  const nx01 = n001 + (n101 - n001) * fx;
  const nx11 = n011 + (n111 - n011) * fx;

  const nxy0 = nx00 + (nx10 - nx00) * fy;
  const nxy1 = nx01 + (nx11 - nx01) * fy;

  return nxy0 + (nxy1 - nxy0) * fz;
}

function fbm3D(x: number, y: number, z: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise3D(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return val / norm;
}

function gaussian2D(lat: number, lon: number, cLat: number, cLon: number, sLat: number, sLon: number): number {
  const dLat = (lat - cLat) / sLat;
  let dLon = lon - cLon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  dLon /= sLon;
  return Math.exp(-0.5 * (dLat * dLat + dLon * dLon));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpRGB(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): [number, number, number] {
  const f = Math.max(0, Math.min(1, t));
  return [
    c1[0] + (c2[0] - c1[0]) * f,
    c1[1] + (c2[1] - c1[1]) * f,
    c1[2] + (c2[2] - c1[2]) * f,
  ];
}

let cachedBlueMarble: BlueMarbleData | null = null;

export function getBlueMarbleData(): BlueMarbleData {
  if (cachedBlueMarble) return cachedBlueMarble;

  const W = BM_WIDTH;
  const H = BM_HEIGHT;
  const total = W * H;

  const landMask = new Uint8Array(total);
  const waterDist = new Float32Array(total);
  const landDist = new Float32Array(total);
  const elev = new Float32Array(total);
  const rgb = new Uint8Array(total * 3);
  const clouds = new Uint8Array(total);

  // 1. Rasterize 0.5-deg land mask
  for (let y = 0; y < H; y++) {
    const lat = 89.75 - y * 0.5;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const lon = -179.75 + x * 0.5;
      const land = computeIsLandRaw(lat, lon) ? 1 : 0;
      landMask[row + x] = land;
      waterDist[row + x] = land === 1 ? 0 : 999;
      landDist[row + x] = land === 0 ? 0 : 999;
    }
  }

  // 2. Fast 2-pass distance-to-coast transform (for coastal shelves & anti-aliased shores)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const xl = (x - 1 + W) % W;
      if (waterDist[idx] > 0) {
        let d = waterDist[idx];
        d = Math.min(d, waterDist[y * W + xl] + 1);
        if (y > 0) d = Math.min(d, waterDist[(y - 1) * W + x] + 1);
        waterDist[idx] = d;
      }
      if (landDist[idx] > 0) {
        let d = landDist[idx];
        d = Math.min(d, landDist[y * W + xl] + 1);
        if (y > 0) d = Math.min(d, landDist[(y - 1) * W + x] + 1);
        landDist[idx] = d;
      }
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const idx = y * W + x;
      const xr = (x + 1) % W;
      if (waterDist[idx] > 0) {
        let d = waterDist[idx];
        d = Math.min(d, waterDist[y * W + xr] + 1);
        if (y < H - 1) d = Math.min(d, waterDist[(y + 1) * W + x] + 1);
        waterDist[idx] = d;
      }
      if (landDist[idx] > 0) {
        let d = landDist[idx];
        d = Math.min(d, landDist[y * W + xr] + 1);
        if (y < H - 1) d = Math.min(d, landDist[(y + 1) * W + x] + 1);
        landDist[idx] = d;
      }
    }
  }

  // 3. Precompute terrain heightfield & biome coloring + cloud wisps
  for (let y = 0; y < H; y++) {
    const lat = 89.75 - y * 0.5;
    const phi = lat * DEG2RAD;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const row = y * W;

    for (let x = 0; x < W; x++) {
      const idx = row + x;
      const lon = -179.75 + x * 0.5;
      const lam = lon * DEG2RAD;

      const sx = cosPhi * Math.cos(lam);
      const sy = cosPhi * Math.sin(lam);
      const sz = sinPhi;

      const nLarge = fbm3D(sx * 3.8 + 4.1, sy * 3.8 + 1.7, sz * 3.8 + 2.9, 4);
      const nDetail = fbm3D(sx * 14.0 + 9.2, sy * 14.0 + 3.4, sz * 14.0 + 7.1, 3);

      // Major mountain ranges for authentic terrain elevation
      const himalayas = gaussian2D(lat, lon, 32, 86, 6, 14);
      const andes = gaussian2D(lat, lon, -18, -68, 22, 4);
      const rockies = gaussian2D(lat, lon, 45, -112, 16, 6);
      const ethiopia = gaussian2D(lat, lon, 9, 39, 5, 5);
      const alps = gaussian2D(lat, lon, 46.5, 10, 3, 6);
      const mountain = Math.min(1, himalayas * 1.1 + andes * 0.8 + rockies * 0.7 + ethiopia * 0.65 + alps * 0.6);

      elev[idx] = landMask[idx] === 1 ? nDetail * 0.45 + mountain * 0.85 : 0;

      // Cloud synthesis (swirled trade wind & mid-latitude cyclone bands)
      const swirl = 0.25 * Math.sin(lat * 0.08 + nLarge * 3.5);
      const c1 = fbm3D((sx + swirl) * 5.2 + 12.3, (sy - swirl) * 5.2 + 5.7, sz * 6.0 + 1.4, 4);
      const c2 = fbm3D(sx * 13.5 + 2.1, sy * 13.5 + 8.9, sz * 14.5 + 4.2, 3);
      const itczBoost = 0.1 * Math.exp(-Math.pow((lat - 4) / 10, 2));
      const stormTrackBoost = 0.08 * Math.exp(-Math.pow((Math.abs(lat) - 48) / 14, 2));
      const cloudRaw = c1 * 0.65 + c2 * 0.35 + itczBoost + stormTrackBoost;
      const cloudAlpha = Math.max(0, Math.min(1, (cloudRaw - 0.56) / 0.28));
      clouds[idx] = Math.round(cloudAlpha * 215);
    }
  }

  // 4. Shade Blue Marble RGB using terrain relief, biomes, and ocean bathymetry
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const pxData = img.data;

  for (let y = 0; y < H; y++) {
    const lat = 89.75 - y * 0.5;
    const absLat = Math.abs(lat);
    const phi = lat * DEG2RAD;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const row = y * W;

    for (let x = 0; x < W; x++) {
      const idx = row + x;
      const lon = -179.75 + x * 0.5;
      const lam = lon * DEG2RAD;
      const sx = cosPhi * Math.cos(lam);
      const sy = cosPhi * Math.sin(lam);
      const sz = sinPhi;

      const nBiome = fbm3D(sx * 6.5 + 2.2, sy * 6.5 + 5.1, sz * 6.5 + 8.3, 4);
      const nMicro = fbm3D(sx * 22.0 + 1.1, sy * 22.0 + 4.4, sz * 22.0 + 9.7, 2);

      let r = 0, g = 0, b = 0;

      if (landMask[idx] === 0) {
        // Ocean: deep sapphire abyssal ocean -> turquoise shallow continental shelf
        const dCoast = waterDist[idx];
        const shelf = Math.exp(-dCoast / 2.2);
        const abyssal: [number, number, number] = [6, 30, 74];
        const midOcean: [number, number, number] = [10, 48, 108];
        const shallowShelf: [number, number, number] = [24, 128, 174];

        const baseOcean = lerpRGB(abyssal, midOcean, 0.35 + 0.5 * nBiome);
        const oceanCol = lerpRGB(baseOcean, shallowShelf, shelf * 0.72);

        // Polar sea ice tint in very high arctic / antarctic winter margins
        const polarIce = absLat > 78 ? Math.min(1, (absLat - 78) / 8) * (0.4 + 0.6 * nBiome) : 0;
        const finalOcean = lerpRGB(oceanCol, [218, 232, 244], polarIce * 0.85);
        r = finalOcean[0];
        g = finalOcean[1];
        b = finalOcean[2];
      } else {
        // Land Biomes
        // Aridity kernels (Sahara, Arabia, Iran/Central Asia, Gobi, Australia, Kalahari, SW North America, Atacama)
        const sahara = gaussian2D(lat, lon, 23, 12, 9, 25);
        const arabia = gaussian2D(lat, lon, 22, 46, 8, 11);
        const iranThar = gaussian2D(lat, lon, 29, 64, 7, 12);
        const gobi = gaussian2D(lat, lon, 41, 96, 6, 16);
        const australia = gaussian2D(lat, lon, -24, 132, 8, 13);
        const kalahari = gaussian2D(lat, lon, -23, 20, 7, 7);
        const swUsa = gaussian2D(lat, lon, 32, -110, 7, 9);
        const atacama = gaussian2D(lat, lon, -22, -69, 9, 3);

        const desertWeight = Math.min(
          1,
          sahara * 1.35 +
            arabia * 1.35 +
            iranThar * 1.0 +
            gobi * 0.95 +
            australia * 1.15 +
            kalahari * 0.85 +
            swUsa * 0.8 +
            atacama * 0.9 +
            (nBiome - 0.5) * 0.25
        );

        // Tropical rainforest kernels (Congo, Amazon, SE Asia/Indonesia)
        const congo = gaussian2D(lat, lon, 0, 21, 8, 12);
        const amazon = gaussian2D(lat, lon, -4, -61, 10, 14);
        const seAsia = gaussian2D(lat, lon, 1, 112, 10, 22);
        const rainforestWeight = Math.min(1, congo * 1.2 + amazon * 1.2 + seAsia * 1.1);

        // Ice sheet / polar snow (Greenland, Antarctica, high Arctic, Himalayas)
        const greenland = lat > 60 && lon > -75 && lon < -12 ? 1.0 : 0.0;
        const antarctica = lat < -63 ? 1.0 : 0.0;
        const arcticSnow = absLat > 69 ? Math.min(1, (absLat - 69) / 9) : 0;
        const himalayaPeak = gaussian2D(lat, lon, 32, 85, 4, 11) * (0.45 + 0.55 * nMicro);
        const iceWeight = Math.min(1, Math.max(greenland * 0.95, antarctica, arcticSnow * 0.8, himalayaPeak));

        // Base temperate / boreal forest color
        const forestDark: [number, number, number] = [28, 76, 36];
        const forestMid: [number, number, number] = [56, 102, 48];
        const savanna: [number, number, number] = [126, 134, 68];
        const desertSand: [number, number, number] = [212, 168, 108];
        const desertRock: [number, number, number] = [184, 130, 78];
        const rainforest: [number, number, number] = [22, 68, 30];
        const snowIce: [number, number, number] = [238, 244, 250];

        // Start from latitude-based vegetation
        const latGreenFactor = Math.max(0, 1 - absLat / 68);
        let landCol = lerpRGB(forestDark, forestMid, 0.35 + 0.55 * nBiome);
        landCol = lerpRGB(landCol, savanna, (1 - latGreenFactor) * 0.25 + (nMicro - 0.4) * 0.3);

        // Apply rainforest
        landCol = lerpRGB(landCol, rainforest, rainforestWeight * 0.88);

        // Apply desert sand & rock variation
        const desertCol = lerpRGB(desertRock, desertSand, 0.35 + 0.65 * nMicro);
        landCol = lerpRGB(landCol, desertCol, desertWeight);

        // Apply polar & alpine ice
        landCol = lerpRGB(landCol, snowIce, iceWeight);

        // Directional hillshade relief
        const xr = (x + 1) % W;
        const xl = (x - 1 + W) % W;
        const yu = Math.max(0, y - 1);
        const yd = Math.min(H - 1, y + 1);
        const dx = elev[y * W + xr] - elev[y * W + xl];
        const dy = elev[yd * W + x] - elev[yu * W + x];
        const hill = 1.0 + Math.max(-0.24, Math.min(0.24, (-dx * 0.8 - dy * 0.8) * 1.4));

        // Coastal beach / cliff edge softening
        const edgeBlend = landDist[idx] <= 1.2 ? 0.92 : 1.0;

        r = Math.min(255, Math.max(0, landCol[0] * hill * edgeBlend));
        g = Math.min(255, Math.max(0, landCol[1] * hill * edgeBlend));
        b = Math.min(255, Math.max(0, landCol[2] * hill * edgeBlend));
      }

      const rgbIdx = idx * 3;
      rgb[rgbIdx] = Math.round(r);
      rgb[rgbIdx + 1] = Math.round(g);
      rgb[rgbIdx + 2] = Math.round(b);

      // Composite clouds lightly onto 2D reference canvas as well
      const pIdx = idx * 4;
      const ca = (clouds[idx] / 255) * 0.55;
      pxData[pIdx] = Math.round(lerp(r, 248, ca));
      pxData[pIdx + 1] = Math.round(lerp(g, 251, ca));
      pxData[pIdx + 2] = Math.round(lerp(b, 255, ca));
      pxData[pIdx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  cachedBlueMarble = {
    width: W,
    height: H,
    rgb,
    clouds,
    landMask,
    canvas,
  };
  return cachedBlueMarble;
}
