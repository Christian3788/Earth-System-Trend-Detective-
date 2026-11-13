import * as THREE from 'three';

export interface ProceduralModelHandle {
  group: THREE.Group;
  dispose: () => void;
}

export function createSolarCellTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 256, 128);
  grad.addColorStop(0, '#0c234a');
  grad.addColorStop(0.5, '#133a75');
  grad.addColorStop(1, '#091b38');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  // Fine photovoltaic wafer grid & silver busbars
  ctx.strokeStyle = 'rgba(147, 197, 253, 0.35)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 256; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  for (let y = 0; y <= 128; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 252, 124);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createKaptonBumpTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(128, 128);
  const d = img.data;

  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const idx = (y * 128 + x) * 4;
      const crinkle =
        Math.sin(x * 0.37 + Math.cos(y * 0.29) * 2.1) * 0.45 +
        Math.cos(y * 0.43 - Math.sin(x * 0.31) * 1.8) * 0.35 +
        Math.sin((x + y) * 0.61) * 0.2;
      const v = Math.max(0, Math.min(255, Math.round(128 + crinkle * 110)));
      d[idx] = v;
      d[idx + 1] = v;
      d[idx + 2] = v;
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createEarthRoughnessTexture(
  landMask: Uint8Array,
  bmWidth: number,
  bmHeight: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = bmWidth;
  canvas.height = bmHeight;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(bmWidth, bmHeight);
  const d = img.data;

  for (let i = 0; i < bmWidth * bmHeight; i++) {
    const isLand = landMask[i] === 1;
    // Oceans have lower roughness (specular sheen ~0.26) while continents stay matte (~0.84)
    const rVal = isLand ? 214 : 66;
    const p = i * 4;
    d[p] = rVal;
    d[p + 1] = rVal;
    d[p + 2] = rVal;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createDashedFlowTexture(
  primaryHex: string,
  secondaryHex: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, primaryHex);
  grad.addColorStop(0.5, '#e0f2fe');
  grad.addColorStop(1, secondaryHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 32);

  // Dark dash notches so UV offset visibly streams along the 3D geodesic tube
  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  for (let x = 0; x < 256; x += 32) {
    ctx.fillRect(x, 0, 10, 32);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(6, 1);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Composite 10-part Earth Observation Satellite Observatory (NASA SWOT / GPM class).
 * Assembled across 3 silhouette scales (bus, instrument deck/wings, optical/antenna accents).
 */
export function createEarthObservationSatellite(
  maxAnisotropy: number,
  isSoftwareGl: boolean
): ProceduralModelHandle {
  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const kaptonBump = createKaptonBumpTexture(maxAnisotropy);
  const solarTex = createSolarCellTexture(maxAnisotropy);
  textures.push(kaptonBump, solarTex);

  const goldFoilMat = new THREE.MeshStandardMaterial({
    color: 0xd9a429,
    metalness: 0.9,
    roughness: 0.28,
    bumpMap: kaptonBump,
    bumpScale: 0.008,
  });
  const titaniumMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.85,
    roughness: 0.26,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.15,
    roughness: 0.82,
  });
  const ceramicWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    metalness: 0.08,
    roughness: 0.72,
  });
  const solarWingMat = new THREE.MeshStandardMaterial({
    map: solarTex,
    metalness: 0.62,
    roughness: 0.18,
  });
  const sapphireLensMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    metalness: 0.08,
    roughness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    ior: 1.75,
    emissive: 0x0369a1,
    emissiveIntensity: 0.45,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x22d3ee,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.1,
  });

  materials.push(
    goldFoilMat,
    titaniumMat,
    carbonMat,
    ceramicWhiteMat,
    solarWingMat,
    sapphireLensMat,
    beaconMat
  );

  // 1. Primary Hexagonal Bus Hull (ExtrudeGeometry with bevels)
  const hexShape = new THREE.Shape();
  const busR = 0.036;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * busR;
    const y = Math.sin(a) * busR;
    if (i === 0) hexShape.moveTo(x, y);
    else hexShape.lineTo(x, y);
  }
  hexShape.closePath();

  const busGeo = new THREE.ExtrudeGeometry(hexShape, {
    depth: 0.062,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
  });
  busGeo.center();
  busGeo.rotateX(Math.PI / 2);
  geometries.push(busGeo);

  const busMesh = new THREE.Mesh(busGeo, goldFoilMat);
  busMesh.castShadow = !isSoftwareGl;
  busMesh.receiveShadow = !isSoftwareGl;
  root.add(busMesh);

  // 2. Titanium Structural Payload Collar (LatheGeometry)
  const collarPts = [
    new THREE.Vector2(0.024, -0.008),
    new THREE.Vector2(0.039, -0.008),
    new THREE.Vector2(0.041, 0.0),
    new THREE.Vector2(0.037, 0.01),
    new THREE.Vector2(0.024, 0.01),
  ];
  const collarGeo = new THREE.LatheGeometry(collarPts, 24);
  geometries.push(collarGeo);

  const collarMesh = new THREE.Mesh(collarGeo, titaniumMat);
  collarMesh.position.y = -0.034;
  root.add(collarMesh);

  // 3. Nadir Optical / KaRIn Radar Telescope Baffle (LatheGeometry stepped barrel)
  const bafflePts = [
    new THREE.Vector2(0.016, 0),
    new THREE.Vector2(0.023, 0),
    new THREE.Vector2(0.026, -0.022),
    new THREE.Vector2(0.021, -0.024),
    new THREE.Vector2(0.018, -0.004),
  ];
  const baffleGeo = new THREE.LatheGeometry(bafflePts, 24);
  geometries.push(baffleGeo);

  const baffleMesh = new THREE.Mesh(baffleGeo, carbonMat);
  baffleMesh.position.y = -0.038;
  root.add(baffleMesh);

  // 4. Sapphire Optical Aperture Lens
  const lensGeo = new THREE.CylinderGeometry(0.017, 0.017, 0.005, 20);
  geometries.push(lensGeo);
  const lensMesh = new THREE.Mesh(lensGeo, sapphireLensMat);
  lensMesh.position.y = -0.056;
  root.add(lensMesh);

  // 5. High-Gain Parabolic Dish (LatheGeometry) + Feed Horn
  const dishPts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.012, 0.002),
    new THREE.Vector2(0.024, 0.008),
    new THREE.Vector2(0.032, 0.016),
    new THREE.Vector2(0.034, 0.015),
    new THREE.Vector2(0.023, 0.006),
    new THREE.Vector2(0.0, -0.002),
  ];
  const dishGeo = new THREE.LatheGeometry(dishPts, 24);
  geometries.push(dishGeo);

  const dishGroup = new THREE.Group();
  dishGroup.position.set(0, 0.044, 0.014);
  dishGroup.rotation.x = 0.48;
  const dishMesh = new THREE.Mesh(dishGeo, ceramicWhiteMat);
  dishGroup.add(dishMesh);

  const hornGeo = new THREE.CylinderGeometry(0.002, 0.0035, 0.02, 10);
  geometries.push(hornGeo);
  const hornMesh = new THREE.Mesh(hornGeo, titaniumMat);
  hornMesh.position.y = 0.011;
  dishGroup.add(hornMesh);
  root.add(dishGroup);

  // 6 & 7. Port & Starboard Solar Array Trusses (TubeGeometry) & Beveled Photovoltaic Wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(-0.024, -0.058);
  wingShape.lineTo(0.024, -0.058);
  wingShape.lineTo(0.024, 0.058);
  wingShape.lineTo(-0.024, 0.058);
  wingShape.closePath();

  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.003,
    bevelEnabled: true,
    bevelThickness: 0.001,
    bevelSize: 0.001,
    bevelSegments: 1,
  });
  wingGeo.center();
  wingGeo.rotateZ(Math.PI / 2);
  wingGeo.rotateX(Math.PI / 2);
  geometries.push(wingGeo);

  const leftBoomCurve = new THREE.LineCurve3(
    new THREE.Vector3(-0.032, 0.004, 0),
    new THREE.Vector3(-0.155, 0.004, 0)
  );
  const rightBoomCurve = new THREE.LineCurve3(
    new THREE.Vector3(0.032, 0.004, 0),
    new THREE.Vector3(0.155, 0.004, 0)
  );
  const leftBoomGeo = new THREE.TubeGeometry(leftBoomCurve, 4, 0.003, 8, false);
  const rightBoomGeo = new THREE.TubeGeometry(rightBoomCurve, 4, 0.003, 8, false);
  geometries.push(leftBoomGeo, rightBoomGeo);

  root.add(new THREE.Mesh(leftBoomGeo, titaniumMat));
  root.add(new THREE.Mesh(rightBoomGeo, titaniumMat));

  const leftWing = new THREE.Mesh(wingGeo, solarWingMat);
  leftWing.position.set(-0.098, 0.006, 0);
  leftWing.castShadow = !isSoftwareGl;
  root.add(leftWing);

  const rightWing = new THREE.Mesh(wingGeo, solarWingMat);
  rightWing.position.set(0.098, 0.006, 0);
  rightWing.castShadow = !isSoftwareGl;
  root.add(rightWing);

  // 8. Thermal Radiator Fins (aft)
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.015, -0.012);
  finShape.lineTo(0.015, -0.012);
  finShape.lineTo(0.012, 0.012);
  finShape.lineTo(-0.012, 0.012);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.003,
    bevelEnabled: true,
    bevelThickness: 0.0008,
    bevelSize: 0.0008,
    bevelSegments: 1,
  });
  finGeo.center();
  geometries.push(finGeo);

  const radiatorFin = new THREE.Mesh(finGeo, ceramicWhiteMat);
  radiatorFin.position.set(0, 0.01, -0.039);
  root.add(radiatorFin);

  // 9. S-Band Telemetry Whip & 10. Navigation Strobe Crown
  const whipGeo = new THREE.CylinderGeometry(0.0014, 0.0022, 0.036, 8);
  const strobeGeo = new THREE.OctahedronGeometry(0.0045, 0);
  geometries.push(whipGeo, strobeGeo);

  const whipMesh = new THREE.Mesh(whipGeo, titaniumMat);
  whipMesh.position.set(0.016, 0.052, -0.016);
  root.add(whipMesh);

  const strobeMesh = new THREE.Mesh(strobeGeo, beaconMat);
  strobeMesh.position.set(0.016, 0.072, -0.016);
  root.add(strobeMesh);

  return {
    group: root,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}

/**
 * Composite 4-part Regional Pole Telemetry Beacon anchored at bottom-center (y = 0)
 * so it sits flush on Earth's surface normal at Pole A / Pole B.
 */
export function createPoleBeacon(accentColorHex: number): ProceduralModelHandle {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const collarMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.85,
    roughness: 0.25,
  });
  const alloyMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.78,
    roughness: 0.32,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColorHex,
    emissive: accentColorHex,
    emissiveIntensity: 0.95,
    metalness: 0.25,
    roughness: 0.25,
  });
  materials.push(collarMat, alloyMat, accentMat);

  // 1. Surface Flange Collar (LatheGeometry sitting at y = 0)
  const flangePts = [
    new THREE.Vector2(0.012, 0),
    new THREE.Vector2(0.026, 0),
    new THREE.Vector2(0.023, 0.006),
    new THREE.Vector2(0.011, 0.008),
  ];
  const flangeGeo = new THREE.LatheGeometry(flangePts, 20);
  geometries.push(flangeGeo);
  group.add(new THREE.Mesh(flangeGeo, collarMat));

  // 2. Telemetry Mast
  const mastGeo = new THREE.CylinderGeometry(0.0035, 0.0055, 0.068, 12);
  geometries.push(mastGeo);
  const mast = new THREE.Mesh(mastGeo, alloyMat);
  mast.position.y = 0.036;
  group.add(mast);

  // 3. Surface Sensor Halo Ring
  const ringGeo = new THREE.TorusGeometry(0.034, 0.0032, 10, 28);
  ringGeo.rotateX(Math.PI / 2);
  geometries.push(ringGeo);
  const ring = new THREE.Mesh(ringGeo, accentMat);
  ring.position.y = 0.004;
  group.add(ring);

  // 4. Crown Diamond Tip
  const crownGeo = new THREE.OctahedronGeometry(0.012, 0);
  geometries.push(crownGeo);
  const crown = new THREE.Mesh(crownGeo, accentMat);
  crown.position.y = 0.078;
  group.add(crown);

  return {
    group,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

/**
 * Composite 3-part User Probe Pin anchored flush at bottom-center (y = 0).
 */
export function createProbeBeacon(): ProceduralModelHandle {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.7,
    metalness: 0.35,
    roughness: 0.28,
  });
  const pinMat = new THREE.MeshStandardMaterial({
    color: 0x0b3d91,
    metalness: 0.75,
    roughness: 0.25,
  });
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfbbf24,
    emissiveIntensity: 0.9,
    metalness: 0.1,
    roughness: 0.2,
  });
  materials.push(ringMat, pinMat, tipMat);

  const ringGeo = new THREE.TorusGeometry(0.025, 0.0028, 10, 24);
  ringGeo.rotateX(Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.0028, 0.0018, 0.052, 10);
  const headGeo = new THREE.SphereGeometry(0.011, 14, 12);
  geometries.push(ringGeo, stemGeo, headGeo);

  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.003;
  group.add(ring);

  const stem = new THREE.Mesh(stemGeo, pinMat);
  stem.position.y = 0.027;
  group.add(stem);

  const head = new THREE.Mesh(headGeo, tipMat);
  head.position.y = 0.056;
  group.add(head);

  return {
    group,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
