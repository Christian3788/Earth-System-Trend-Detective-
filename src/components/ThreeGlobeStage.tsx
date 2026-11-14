import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Maximize2,
  Minimize2,
  Orbit,
  RotateCcw,
  Satellite,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  DATA_MODE_META,
  DataMode,
  DatasetSpec,
  MONTH_ABBR,
  PoleSpec,
  TELECONNECTIONS,
  TeleconnectionId,
} from '../data/datasets';
import { BM_HEIGHT, BM_WIDTH, getBlueMarbleData } from '../engine/blueMarbleTexture';
import {
  createDashedFlowTexture,
  createEarthObservationSatellite,
  createEarthRoughnessTexture,
  createPoleBeacon,
  createProbeBeacon,
} from '../engine/satelliteModels';
import { computeGeodesicPoints } from '../engine/statistics';

interface ThreeGlobeStageProps {
  primaryTex: HTMLCanvasElement;
  dataset: DatasetSpec;
  dataMode: DataMode;
  teleconnectionId: TeleconnectionId;
  year: number;
  month: number;
  poleA: PoleSpec | null;
  poleB: PoleSpec | null;
  probedPoint: { lat: number; lon: number } | null;
  showClouds: boolean;
  onToggleClouds: (v: boolean) => void;
  showGraticules: boolean;
  onToggleGraticules: (v: boolean) => void;
  onHoverLatLon: (coords: { lat: number; lon: number } | null) => void;
  onProbeLatLon: (lat: number, lon: number) => void;
  onWebglUnavailable?: () => void;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// Pre-allocated scratch math helpers (zero GC inside animation loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _satUp = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _dummy = new THREE.Object3D();

function latLonToVec3(lat: number, lon: number, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const latRad = lat * DEG2RAD;
  const lonRad = lon * DEG2RAD;
  const cosLat = Math.cos(latRad);
  out.set(
    radius * cosLat * Math.cos(lonRad),
    radius * Math.sin(latRad),
    -radius * cosLat * Math.sin(lonRad)
  );
  return out;
}

function vec3ToLatLon(localPoint: THREE.Vector3): { lat: number; lon: number } {
  _v3.copy(localPoint).normalize();
  const lat = Math.asin(Math.max(-1, Math.min(1, _v3.y))) * RAD2DEG;
  const lon = Math.atan2(-_v3.z, _v3.x) * RAD2DEG;
  return { lat, lon };
}

function createCloudAlphaTexture(
  clouds: Uint8Array,
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
    const p = i * 4;
    d[p] = 248;
    d[p + 1] = 251;
    d[p + 2] = 255;
    d[p + 3] = Math.min(255, Math.round(clouds[i] * 0.75));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export const ThreeGlobeStage: React.FC<ThreeGlobeStageProps> = ({
  primaryTex,
  dataset,
  dataMode,
  teleconnectionId,
  year,
  month,
  poleA,
  poleB,
  probedPoint,
  showClouds,
  onToggleClouds,
  showGraticules,
  onToggleGraticules,
  onHoverLatLon,
  onProbeLatLon,
  onWebglUnavailable,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  const [autoOrbit, setAutoOrbit] = useState(false);
  const [trackSat, setTrackSat] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [zenFullscreen, setZenFullscreen] = useState(false);
  const [zoomReadout, setZoomReadout] = useState(1.0);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Refs bridging React props/state into stable Three.js lifecycle without remounting WebGL
  const callbacksRef = useRef({ onHoverLatLon, onProbeLatLon, onWebglUnavailable });
  callbacksRef.current = { onHoverLatLon, onProbeLatLon, onWebglUnavailable };

  const flagsRef = useRef({
    autoOrbit: false,
    trackSat: false,
    showClouds: true,
    showGraticules: true,
  });
  flagsRef.current.autoOrbit = autoOrbit;
  flagsRef.current.trackSat = trackSat;
  flagsRef.current.showClouds = showClouds;
  flagsRef.current.showGraticules = showGraticules;

  const sceneRefs = useRef<{
    earthTex: THREE.CanvasTexture | null;
    earthMat: THREE.MeshStandardMaterial | null;
    cloudMesh: THREE.Mesh | null;
    gratGroup: THREE.Group | null;
    arcGroup: THREE.Group | null;
    poleAGroup: THREE.Group | null;
    poleBGroup: THREE.Group | null;
    probeGroup: THREE.Group | null;
    camera: THREE.PerspectiveCamera | null;
    controls: OrbitControls | null;
    desiredCamPos: THREE.Vector3 | null;
    flowTex: THREE.CanvasTexture | null;
    maxAnisotropy: number;
    requestResize: (() => void) | null;
  }>({
    earthTex: null,
    earthMat: null,
    cloudMesh: null,
    gratGroup: null,
    arcGroup: null,
    poleAGroup: null,
    poleBGroup: null,
    probeGroup: null,
    camera: null,
    controls: null,
    desiredCamPos: null,
    flowTex: null,
    maxAnisotropy: 4,
    requestResize: null,
  });

  // Keyboard shortcut: 'H' toggles collapsible bottom dock; 'Escape' exits Zen fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      } else if (e.key === 'Escape' && zenFullscreen) {
        setZenFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zenFullscreen]);

  // Trigger resize when toggling fullscreen Zen mode
  useEffect(() => {
    const id = window.setTimeout(() => {
      sceneRefs.current.requestResize?.();
    }, 30);
    return () => window.clearTimeout(id);
  }, [zenFullscreen]);

  // Mount Three.js WebGL scene once inside isolated mountRef
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Create WebGLRenderer directly without losing a throwaway context first
    let maybeRenderer: THREE.WebGLRenderer | null = null;
    const candidateConfigs: THREE.WebGLRendererParameters[] = [
      { antialias: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false },
      { antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
    ];
    let lastInitErr: unknown = null;
    for (const cfg of candidateConfigs) {
      try {
        maybeRenderer = new THREE.WebGLRenderer(cfg);
        break;
      } catch (err: unknown) {
        lastInitErr = err;
      }
    }

    if (!maybeRenderer) {
      const msg =
        lastInitErr instanceof Error
          ? lastInitErr.message
          : 'WebGL context could not be initialized in this browser.';
      setWebglError(msg);
      callbacksRef.current.onWebglUnavailable?.();
      return;
    }

    const renderer: THREE.WebGLRenderer = maybeRenderer;

    const isSoftwareGl = (() => {
      try {
        const gl = renderer.getContext();
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    setWebglError(null);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
    sceneRefs.current.maxAnisotropy = maxAnisotropy;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);
    scene.fog = new THREE.FogExp2(0x020617, 0.014);

    // Studio environment reflection via PMREMGenerator + RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envRT = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const rect = container.getBoundingClientRect();
    const initW = Math.max(320, rect.width);
    const initH = Math.max(280, rect.height);
    const camera = new THREE.PerspectiveCamera(38, initW / initH, 0.1, 80);
    // Initial framing facing Indian Ocean / Africa / Red Sea
    latLonToVec3(12, 46, 3.15, camera.position);
    camera.lookAt(0, 0, 0);
    sceneRefs.current.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.48;
    controls.maxDistance = 5.4;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.85;
    sceneRefs.current.controls = controls;

    // Cancel scripted camera fly-to immediately if user interacts
    const onControlStart = () => {
      sceneRefs.current.desiredCamPos = null;
      if (flagsRef.current.trackSat) {
        setTrackSat(false);
      }
    };
    controls.addEventListener('start', onControlStart);

    // 3-Point Warm Key / Cool Hemisphere Fill Studio Rig
    const sunKey = new THREE.DirectionalLight(0xfff5e4, 2.35);
    sunKey.position.set(4.5, 2.4, 4.8);
    sunKey.castShadow = !isSoftwareGl;
    sunKey.shadow.mapSize.set(1024, 1024);
    sunKey.shadow.camera.near = 1;
    sunKey.shadow.camera.far = 12;
    sunKey.shadow.camera.left = -2.4;
    sunKey.shadow.camera.right = 2.4;
    sunKey.shadow.camera.top = 2.4;
    sunKey.shadow.camera.bottom = -2.4;
    sunKey.shadow.bias = -0.0005;
    sunKey.shadow.normalBias = 0.02;
    scene.add(sunKey);

    const hemiFill = new THREE.HemisphereLight(0x93c5fd, 0x0b1528, 0.72);
    scene.add(hemiFill);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.65);
    rimLight.position.set(-4.5, -1.8, -3.5);
    scene.add(rimLight);

    // Instanced Starfield (>20 repeated stars using InstancedMesh + computeBoundingSphere)
    const starCount = 260;
    const starGeo = new THREE.OctahedronGeometry(0.032, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const starsMesh = new THREE.InstancedMesh(starGeo, starMat, starCount);
    const starColor = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      const s1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const s2 = Math.sin(i * 93.9898 + 19.133) * 24634.6345;
      const s3 = Math.sin(i * 41.1234 + 5.712) * 18421.1234;
      const u = s1 - Math.floor(s1);
      const v = s2 - Math.floor(s2);
      const w = s3 - Math.floor(s3);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const dist = 16 + w * 14;

      _dummy.position.set(
        dist * Math.sin(phi) * Math.cos(theta),
        dist * Math.cos(phi),
        dist * Math.sin(phi) * Math.sin(theta)
      );
      const scale = 0.45 + w * 1.15;
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      starsMesh.setMatrixAt(i, _dummy.matrix);

      // Subtle warm/cool stellar tint
      starColor.setHSL(0.56 + (w - 0.5) * 0.14, 0.35, 0.75 + w * 0.25);
      starsMesh.setColorAt(i, starColor);
    }
    starsMesh.instanceMatrix.needsUpdate = true;
    if (starsMesh.instanceColor) starsMesh.instanceColor.needsUpdate = true;
    starsMesh.computeBoundingSphere();
    scene.add(starsMesh);

    // Blue Marble Earth Sphere + Procedural Roughness/Bump
    const bm = getBlueMarbleData();
    const roughnessTex = createEarthRoughnessTexture(bm.landMask, BM_WIDTH, BM_HEIGHT, maxAnisotropy);
    const initialEarthTex = new THREE.CanvasTexture(primaryTex);
    initialEarthTex.colorSpace = THREE.SRGBColorSpace;
    initialEarthTex.anisotropy = maxAnisotropy;
    initialEarthTex.needsUpdate = true;

    const earthGeo = new THREE.SphereGeometry(1, 72, 48);
    const earthMat = new THREE.MeshStandardMaterial({
      map: initialEarthTex,
      roughnessMap: roughnessTex,
      roughness: 1.0,
      metalness: 0.08,
      bumpMap: roughnessTex,
      bumpScale: 0.006,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthMesh.receiveShadow = !isSoftwareGl;
    earthMesh.layers.enable(1); // Dedicated raycasting target
    scene.add(earthMesh);

    sceneRefs.current.earthTex = initialEarthTex;
    sceneRefs.current.earthMat = earthMat;

    // Cloud Shell
    const cloudAlphaTex = createCloudAlphaTexture(bm.clouds, BM_WIDTH, BM_HEIGHT, maxAnisotropy);
    const cloudGeo = new THREE.SphereGeometry(1.012, 64, 40);
    const cloudMat = new THREE.MeshStandardMaterial({
      map: cloudAlphaTex,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      roughness: 0.9,
      metalness: 0.0,
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    cloudMesh.visible = flagsRef.current.showClouds;
    cloudMesh.renderOrder = 2;
    scene.add(cloudMesh);
    sceneRefs.current.cloudMesh = cloudMesh;

    // Rayleigh Atmospheric Fresnel Rim Shell
    const atmGeo = new THREE.SphereGeometry(1.068, 64, 40);
    const atmMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x60a5fa) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float rim = pow(clamp(0.74 - dot(vNormal, -vViewDir), 0.0, 1.0), 3.1);
          gl_FragColor = vec4(uColor, rim * 0.78);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const atmMesh = new THREE.Mesh(atmGeo, atmMat);
    atmMesh.renderOrder = 3;
    scene.add(atmMesh);

    // 3D Graticule Wire Group
    const gratGroup = new THREE.Group();
    const gratMat = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.16,
    });
    const eqMat = new THREE.LineBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.34,
    });
    const gratGeos: THREE.BufferGeometry[] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lon = -180; lon <= 180; lon += 5) {
        pts.push(latLonToVec3(lat, lon, 1.003, new THREE.Vector3()));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      gratGeos.push(g);
      gratGroup.add(new THREE.Line(g, lat === 0 ? eqMat : gratMat));
    }
    for (let lon = -150; lon <= 180; lon += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lat = -88; lat <= 88; lat += 4) {
        pts.push(latLonToVec3(lat, lon, 1.003, new THREE.Vector3()));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      gratGeos.push(g);
      gratGroup.add(new THREE.Line(g, lon === 0 ? eqMat : gratMat));
    }
    gratGroup.visible = flagsRef.current.showGraticules;
    scene.add(gratGroup);
    sceneRefs.current.gratGroup = gratGroup;

    // Composite 10-Part Earth Observation Satellite + Inclined Orbital Track
    const satModel = createEarthObservationSatellite(maxAnisotropy, isSoftwareGl);
    satModel.group.scale.setScalar(0.82);
    scene.add(satModel.group);

    const orbitInclination = 53 * DEG2RAD;
    const orbitRadius = 1.29;
    const orbitPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      const x = Math.cos(a) * orbitRadius;
      const z0 = Math.sin(a) * orbitRadius;
      const y = z0 * Math.sin(orbitInclination);
      const z = z0 * Math.cos(orbitInclination);
      orbitPts.push(new THREE.Vector3(x, y, z));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.34,
    });
    const orbitRing = new THREE.LineLoop(orbitGeo, orbitMat);
    scene.add(orbitRing);

    // Teleconnection Pole A / Pole B Beacons + Geodesic Arc Group + User Probe Marker
    const poleAHandle = createPoleBeacon(0x22d3ee);
    const poleBHandle = createPoleBeacon(0xfb923c);
    const probeHandle = createProbeBeacon();
    poleAHandle.group.visible = false;
    poleBHandle.group.visible = false;
    probeHandle.group.visible = false;
    scene.add(poleAHandle.group);
    scene.add(poleBHandle.group);
    scene.add(probeHandle.group);
    sceneRefs.current.poleAGroup = poleAHandle.group;
    sceneRefs.current.poleBGroup = poleBHandle.group;
    sceneRefs.current.probeGroup = probeHandle.group;

    const arcGroup = new THREE.Group();
    scene.add(arcGroup);
    sceneRefs.current.arcGroup = arcGroup;

    const flowTex = createDashedFlowTexture('#22d3ee', '#fb923c', maxAnisotropy);
    sceneRefs.current.flowTex = flowTex;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Raycasting for 3D Hover & Click-to-Probe
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let lastHoverTime = 0;

    const updatePointer = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      pointerNdc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    };

    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };

    const onPointerMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 45) return;
      lastHoverTime = now;
      updatePointer(ev);
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObject(earthMesh, false);
      if (hits.length > 0) {
        callbacksRef.current.onHoverLatLon(vec3ToLatLon(hits[0].point));
      } else {
        callbacksRef.current.onHoverLatLon(null);
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      if (moved > 5) return;
      updatePointer(ev);
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObject(earthMesh, false);
      if (hits.length > 0) {
        const { lat, lon } = vec3ToLatLon(hits[0].point);
        callbacksRef.current.onProbeLatLon(lat, lon);
      }
    };

    const onPointerLeave = () => {
      callbacksRef.current.onHoverLatLon(null);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    // Responsive ResizeObserver
    const handleResize = () => {
      const r = container.getBoundingClientRect();
      const w = Math.max(320, Math.floor(r.width));
      const h = Math.max(280, Math.floor(r.height));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    handleResize();
    sceneRefs.current.requestResize = handleResize;
    const resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(container);

    // Continuous Animation Loop with Software-WebGL Pacing
    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();
    let elapsed = 0;
    let lastZoomEmit = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
      lastTime = now;
      elapsed += dt;

      // Update Satellite Orbital Kinematics
      const orbAngle = elapsed * 0.28 + 0.65;
      const sx = Math.cos(orbAngle) * orbitRadius;
      const sz0 = Math.sin(orbAngle) * orbitRadius;
      const sy = sz0 * Math.sin(orbitInclination);
      const sz = sz0 * Math.cos(orbitInclination);
      satModel.group.position.set(sx, sy, sz);

      // Point nadir baffle (-Y of satellite) toward Earth center (0,0,0)
      _satUp.copy(satModel.group.position).normalize();
      _q1.setFromUnitVectors(UP_AXIS, _satUp);
      satModel.group.quaternion.copy(_q1);

      // Slowly drift cloud shell and stream geodesic flow texture
      cloudMesh.rotation.y += dt * 0.012;
      flowTex.offset.x -= dt * 0.55;

      // Smooth damped camera fly-to or satellite tracking
      if (flagsRef.current.trackSat) {
        _v1.copy(satModel.group.position).normalize().multiplyScalar(2.45);
        _v1.y += 0.45;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _v1.x, 3.6, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _v1.y, 3.6, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _v1.z, 3.6, dt);
        camera.lookAt(0, 0, 0);
      } else if (sceneRefs.current.desiredCamPos) {
        const dest = sceneRefs.current.desiredCamPos;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, dest.x, 5.2, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, dest.y, 5.2, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, dest.z, 5.2, dt);
        if (camera.position.distanceToSquared(dest) < 0.0004) {
          camera.position.copy(dest);
          sceneRefs.current.desiredCamPos = null;
        }
      }

      controls.autoRotate = flagsRef.current.autoOrbit && !flagsRef.current.trackSat;
      controls.autoRotateSpeed = 0.75;
      controls.update();

      // Throttled zoom readout update for UI
      if (now - lastZoomEmit > 150) {
        lastZoomEmit = now;
        const dist = camera.position.length();
        const zoomFactor = Number((3.15 / Math.max(1.2, dist)).toFixed(1));
        setZoomReadout((prev) => (prev === zoomFactor ? prev : zoomFactor));
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      renderer.render(scene, camera);
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObs.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();

      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);

      // Dispose all geometries, materials, textures
      satModel.dispose();
      poleAHandle.dispose();
      poleBHandle.dispose();
      probeHandle.dispose();

      earthGeo.dispose();
      earthMat.dispose();
      initialEarthTex.dispose();
      roughnessTex.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
      cloudAlphaTex.dispose();
      atmGeo.dispose();
      atmMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      orbitGeo.dispose();
      orbitMat.dispose();
      flowTex.dispose();
      gratGeos.forEach((g) => g.dispose());
      gratMat.dispose();
      eqMat.dispose();
      envRT.dispose();

      while (arcGroup.children.length > 0) {
        const child = arcGroup.children[0] as THREE.Mesh;
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material?.dispose();
        arcGroup.remove(child);
      }

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Sync updated Blue Marble + Anomaly CanvasTexture without rebuilding WebGL scene
  useEffect(() => {
    const tex = sceneRefs.current.earthTex;
    if (!tex) return;
    tex.image = primaryTex;
    tex.needsUpdate = true;
  }, [primaryTex]);

  // Sync Cloud & Graticule visibility
  useEffect(() => {
    if (sceneRefs.current.cloudMesh) sceneRefs.current.cloudMesh.visible = showClouds;
  }, [showClouds]);

  useEffect(() => {
    if (sceneRefs.current.gratGroup) sceneRefs.current.gratGroup.visible = showGraticules;
  }, [showGraticules]);

  // Sync Pole A / Pole B Beacons and 3D Elevated Geodesic Tube Arc
  useEffect(() => {
    const { poleAGroup, poleBGroup, arcGroup, flowTex } = sceneRefs.current;
    if (!poleAGroup || !poleBGroup || !arcGroup) return;

    while (arcGroup.children.length > 0) {
      const child = arcGroup.children[0] as THREE.Mesh;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose();
      arcGroup.remove(child);
    }

    if (poleA && poleB) {
      latLonToVec3(poleA.lat, poleA.lon, 1.001, poleAGroup.position);
      _v2.copy(poleAGroup.position).normalize();
      poleAGroup.quaternion.setFromUnitVectors(UP_AXIS, _v2);
      poleAGroup.visible = true;

      latLonToVec3(poleB.lat, poleB.lon, 1.001, poleBGroup.position);
      _v2.copy(poleBGroup.position).normalize();
      poleBGroup.quaternion.setFromUnitVectors(UP_AXIS, _v2);
      poleBGroup.visible = true;

      const geoPts = computeGeodesicPoints(poleA.lat, poleA.lon, poleB.lat, poleB.lon, 64);
      const curvePts = geoPts.map(([lon, lat], i) => {
        const f = i / Math.max(1, geoPts.length - 1);
        const r = 1.015 + 0.16 * Math.sin(Math.PI * f);
        return latLonToVec3(lat, lon, r, new THREE.Vector3());
      });
      const curve = new THREE.CatmullRomCurve3(curvePts);
      const tubeGeo = new THREE.TubeGeometry(curve, 72, 0.009, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        map: flowTex,
        emissiveMap: flowTex,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        roughness: 0.25,
        metalness: 0.1,
        transparent: true,
        opacity: 0.94,
      });
      arcGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
    } else {
      poleAGroup.visible = false;
      poleBGroup.visible = false;
    }
  }, [poleA, poleB]);

  // Sync Probed Point Beacon
  useEffect(() => {
    const probeGroup = sceneRefs.current.probeGroup;
    if (!probeGroup) return;
    if (probedPoint) {
      latLonToVec3(probedPoint.lat, probedPoint.lon, 1.001, probeGroup.position);
      _v2.copy(probeGroup.position).normalize();
      probeGroup.quaternion.setFromUnitVectors(UP_AXIS, _v2);
      probeGroup.visible = true;
    } else {
      probeGroup.visible = false;
    }
  }, [probedPoint]);

  // Smooth damped camera fly-to when switching teleconnection drivers
  const isFirstFocusRef = useRef(true);
  useEffect(() => {
    if (isFirstFocusRef.current) {
      isFirstFocusRef.current = false;
      return;
    }
    const tele = TELECONNECTIONS[teleconnectionId];
    const cam = sceneRefs.current.camera;
    if (!cam) return;
    const dist = Math.max(2.3, Math.min(3.8, cam.position.length()));
    sceneRefs.current.desiredCamPos = latLonToVec3(
      tele.focusLat,
      tele.focusLon,
      dist,
      new THREE.Vector3()
    );
  }, [teleconnectionId]);

  const flyToTeleconnection = () => {
    setTrackSat(false);
    const tele = TELECONNECTIONS[teleconnectionId];
    const lat = tele.id === 'iod' ? 10 : tele.focusLat;
    const lon = tele.id === 'iod' ? 46 : tele.focusLon;
    sceneRefs.current.desiredCamPos = latLonToVec3(lat, lon, 3.1, new THREE.Vector3());
  };

  const adjustCameraZoom = (zoomIn: boolean) => {
    setTrackSat(false);
    const cam = sceneRefs.current.camera;
    if (!cam) return;
    const dist = cam.position.length();
    const nextDist = THREE.MathUtils.clamp(dist * (zoomIn ? 0.84 : 1.18), 1.5, 5.2);
    sceneRefs.current.desiredCamPos = cam.position.clone().normalize().multiplyScalar(nextDist);
  };

  const modeMeta = DATA_MODE_META[dataMode];

  return (
    <div
      className={
        zenFullscreen
          ? 'fixed inset-0 z-50 w-screen h-screen bg-[#020617]'
          : 'w-full h-full relative bg-[#020617]'
      }
    >
      {/* Isolated WebGL Mount Container (never contains React UI siblings) */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-slate-950 text-slate-200 z-20">
          <div className="max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 text-center space-y-2">
            <div className="text-sm font-semibold text-white">3D WebGL Renderer Unavailable</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {webglError} Switch to the 2D Planar Map tab above to continue exploring anomalies and Trend Detective statistics.
            </p>
          </div>
        </div>
      )}

      {/* Minimal Top-Left Spec Badge in Zen Fullscreen Mode */}
      {zenFullscreen && (
        <div
          className="absolute top-4 left-4 px-3.5 py-2 rounded-md border border-slate-600 text-white pointer-events-none"
          style={{ backgroundColor: 'rgba(2, 6, 23, 0.92)' }}
        >
          <div className="text-xs font-bold uppercase tracking-wider text-sky-300">
            NASA ESDE Three.js Observatory · {modeMeta.shortLabel}
          </div>
          <div className="text-sm font-semibold text-white mt-0.5">
            {dataset.name} · {MONTH_ABBR[month - 1]} {year}
          </div>
        </div>
      )}

      {/* Collapsible Floating Bottom Control Dock (solid/rgba surface, no backdrop-filter, <= 15% height) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[95%] flex flex-col items-center z-10 pointer-events-none">
        <button
          type="button"
          onClick={() => setDockCollapsed((c) => !c)}
          title="Toggle 3D Controls (H)"
          className="pointer-events-auto px-3 py-0.5 rounded-t-md border border-b-0 border-slate-600 text-[11px] font-semibold text-slate-100 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
          style={{ backgroundColor: 'rgba(2, 6, 23, 0.94)' }}
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show Controls (H)
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Hide Controls
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div
            className="pointer-events-auto px-2.5 py-1.5 rounded-lg border border-slate-600 shadow-lg flex flex-wrap items-center justify-center gap-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: 'rgba(2, 6, 23, 0.94)' }}
          >
            <button
              type="button"
              onClick={flyToTeleconnection}
              className="px-2.5 py-1 rounded border border-slate-600 bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5 text-cyan-300" />
              Focus Poles
            </button>

            <button
              type="button"
              onClick={() => setTrackSat((s) => !s)}
              className={`px-2.5 py-1 rounded border flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
                trackSat
                  ? 'bg-[#0B3D91] border-sky-400 text-white'
                  : 'border-slate-600 bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              <Satellite className="w-3.5 h-3.5 text-amber-300" />
              {trackSat ? 'Tracking Sat' : 'Track Sat'}
            </button>

            <button
              type="button"
              onClick={() => {
                setTrackSat(false);
                setAutoOrbit((o) => !o);
              }}
              className={`px-2.5 py-1 rounded border flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
                autoOrbit
                  ? 'bg-[#0B3D91] border-sky-400 text-white'
                  : 'border-slate-600 bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              <Orbit className="w-3.5 h-3.5 text-sky-300" />
              {autoOrbit ? 'Orbiting' : 'Auto-Orbit'}
            </button>

            <span className="h-4 w-px bg-slate-600 mx-0.5" aria-hidden="true" />

            <button
              type="button"
              aria-label="Zoom out 3D globe"
              onClick={() => adjustCameraZoom(false)}
              className="p-1.5 rounded border border-slate-600 bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono font-bold tabular-nums text-xs text-white w-8 text-center">
              {zoomReadout.toFixed(1)}x
            </span>
            <button
              type="button"
              aria-label="Zoom in 3D globe"
              onClick={() => adjustCameraZoom(true)}
              className="p-1.5 rounded border border-slate-600 bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Reset 3D camera"
              onClick={flyToTeleconnection}
              className="p-1.5 rounded border border-slate-600 bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {zenFullscreen && (
              <>
                <button
                  type="button"
                  onClick={() => onToggleClouds(!showClouds)}
                  className={`px-2.5 py-1 rounded border whitespace-nowrap cursor-pointer ${
                    showClouds
                      ? 'bg-slate-800 border-slate-400 text-white'
                      : 'bg-slate-900 border-slate-600 text-slate-300'
                  }`}
                >
                  Clouds
                </button>
                <button
                  type="button"
                  onClick={() => onToggleGraticules(!showGraticules)}
                  className={`px-2.5 py-1 rounded border whitespace-nowrap cursor-pointer ${
                    showGraticules
                      ? 'bg-slate-800 border-slate-400 text-white'
                      : 'bg-slate-900 border-slate-600 text-slate-300'
                  }`}
                >
                  Grid
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setZenFullscreen((z) => !z)}
              aria-label={zenFullscreen ? 'Exit fullscreen 3D scene' : 'Expand 3D scene fullscreen'}
              className="px-2.5 py-1 rounded border border-slate-600 bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              {zenFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-sky-300" />
                  Exit Zen
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-sky-300" />
                  Zen 3D
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
