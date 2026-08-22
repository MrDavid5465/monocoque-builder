import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';

export interface Photo360Handle {
  capture: (captureWidth: number, captureHeight: number) => Promise<string>;
}

interface Props {
  photoUrl: string;
  // Optional second (night) equirectangular photo, blended with `photoUrl`
  // on ONE mesh/material/WebGL context via a custom shader (see the
  // onBeforeCompile hook below) rather than layering two full Photo360Viewer
  // instances — see this file's own top-of-GL-setup-effect comment for why
  // context count matters (a real, browser-capped GPU resource). `nightAmount`
  // (0=day, 1=night) drives the blend; changes are smoothed with a ~2.5s
  // ease in the render loop, matching the CSS crossfade this replaced.
  nightPhotoUrl?: string;
  nightAmount?: number;
  yaw: number;
  pitch: number;
  fov: number;
  roll: number;
  displayWidth: number;
  displayHeight: number;
  onChange: (yaw: number, pitch: number, fov: number, roll: number) => void;
  readOnly?: boolean;
  // NeckFX-style telemetry sway — nudges the pan (not the persisted yaw/pitch)
  // based on lateral/longitudinal g, mirroring the canvas sway effect used for
  // non-360 backgrounds. Never written back via onChange.
  telemetryData?: Record<string, number>;
  swayEnabled?: boolean;
  swayGainX?: number;
  swayGainY?: number;
  swayDisableX?: boolean;
  swayDisableY?: boolean;
  // Fires once the equirectangular texture has actually loaded and painted a
  // frame — useful for callers that want to screenshot the result (the
  // texture loads asynchronously, so capturing before this fires yields a
  // blank/untextured sphere).
  onLoaded?: () => void;
}

// Calibrated so typical cornering g (~1g) gives ~1-2° of sway, and the clamped
// max (a spin/crash-level event) tops out around 5°. Panning the camera reads
// as much bigger motion than the equivalent pixel-based canvas sway, so this
// is deliberately far gentler than the canvas sway's degrees-per-g.
const SWAY_YAW_DEG_PER_G   = 1.5;
const SWAY_PITCH_DEG_PER_G = 0.75;

const Photo360Viewer = forwardRef<Photo360Handle, Props>(({
  photoUrl, nightPhotoUrl, nightAmount = 0, yaw, pitch, fov, roll, displayWidth, displayHeight, onChange, readOnly = false,
  telemetryData, swayEnabled = false, swayGainX = 1, swayGainY = 1, swayDisableX = false, swayDisableY = false,
  onLoaded,
}, ref) => {
  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef    = useRef<THREE.Scene | null>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // Populated by the material's onBeforeCompile hook below, once the shader
  // actually compiles — the nightMap/mixAmount uniforms it injects live here,
  // not on the material itself (see the GL-setup effect's comment on why
  // this is one material/context instead of two layered viewers).
  const shaderRef   = useRef<THREE.WebGLProgramParametersWithUniforms | null>(null);
  const mixAmountRef = useRef(0);
  // Decouples "night texture finished loading" from "shader finished
  // compiling" — both happen asynchronously and in no guaranteed order (the
  // shader only actually compiles on Three's first render of this material,
  // one requestAnimationFrame after mount; a texture can load before or
  // after that). The render loop reconciles both every frame instead of
  // either side waiting on the other.
  const nightTextureRef = useRef<THREE.Texture | null>(null);
  const stateRef    = useRef({ yaw, pitch, fov, roll, displayWidth, displayHeight, nightAmount });
  stateRef.current  = { yaw, pitch, fov, roll, displayWidth, displayHeight, nightAmount };
  const dragRef     = useRef<{ startX: number; startY: number; startYaw: number; startPitch: number } | null>(null);

  const telemetryRef = useRef(telemetryData);
  telemetryRef.current = telemetryData;
  const swayConfigRef = useRef({ swayEnabled, swayGainX, swayGainY, swayDisableX, swayDisableY });
  swayConfigRef.current = { swayEnabled, swayGainX, swayGainY, swayDisableX, swayDisableY };
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  // Bumped once the GL-setup effect below acquires a context. The
  // texture-loading effect depends on this (not just photoUrl) so it can
  // pick up the material once it exists.
  const [glGeneration, setGlGeneration] = useState(0);

  // GL setup — deliberately mount-once (NOT keyed on photoUrl). A WebGLRenderer
  // holds a real, browser-capped GPU resource (commonly ~16 simultaneous live
  // contexts, fewer on weak GPUs). Recreating one on every photo change used to
  // race a teardown against a create, rendering blank/grey. That raced on
  // *every* mount, not just repeated navigation: GET_CARS uses cache-and-network,
  // so dayPhoto360Url/nightPhoto360Url reliably change once from a cache-miss
  // placeholder to the real car photo moments after mount. Splitting texture
  // loading (below) from GL setup (here) means a photoUrl change just swaps
  // the material's texture on the existing context — no teardown, no race —
  // and a live car swap mid-session won't glitch either.
  useEffect(() => {
    if (!mountRef.current) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(displayWidth, displayHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(fov, displayWidth / displayHeight, 0.1, 100);
    cameraRef.current = camera;

    const geometry = new THREE.SphereGeometry(50, 64, 32);
    geometry.scale(-1, 1, 1);

    // No map yet — the texture-loading effect below assigns one
    // synchronously in the same effect-flush, before the first
    // requestAnimationFrame paints.
    const material = new THREE.MeshBasicMaterial();
    // Always attached (even when this instance never ends up with a
    // nightPhotoUrl) so the shader's *capability* to blend a second texture
    // is baked in from the one-time compile — mixAmount just stays 0 (day
    // texel only) when unused. Built on top of Three's own map_fragment
    // chunk (via onBeforeCompile) rather than a from-scratch ShaderMaterial,
    // so tone-mapping/color-space handling stays exactly what
    // MeshBasicMaterial already gets right, instead of reimplementing it.
    material.onBeforeCompile = (shader) => {
      shader.uniforms.nightMap = { value: null };
      shader.uniforms.mixAmount = { value: 0 };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D nightMap;\nuniform float mixAmount;',
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 dayTexel = texture2D( map, vMapUv );
            vec4 nightTexel = texture2D( nightMap, vMapUv );
            vec4 sampledDiffuseColor = mix( dayTexel, nightTexel, mixAmount );
            diffuseColor *= sampledDiffuseColor;
          #endif`,
        );
      shaderRef.current = shader;
    };
    materialRef.current = material;
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);
    setGlGeneration(g => g + 1);

    let rafId: number;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const sway = { yaw: 0, pitch: 0 };
    let lastWidth = displayWidth;
    let lastHeight = displayHeight;
    let lastFrameTime = performance.now();
    const render = () => {
      rafId = requestAnimationFrame(render);
      const now = performance.now();
      const dtMs = now - lastFrameTime;
      lastFrameTime = now;
      // Skip actual render work while this tab is backgrounded. Two or
      // more tabs each running a continuous WebGL render loop (e.g. a
      // kiosk tab and this car's own live-preview tab) compete for
      // main-thread time even though only one is visible — that
      // contention has been observed to starve the *other* tab's React
      // state updates badly enough that CSS transitions (the day/night
      // crossfade) appear to snap instead of fade. requestAnimationFrame
      // itself is still called every frame so rendering resumes
      // immediately on refocus, with no extra listener needed.
      if (document.hidden) return;
      const { yaw: y, pitch: p, fov: f, roll: r, displayWidth: dw, displayHeight: dh } = stateRef.current;

      // displayWidth/displayHeight can change after mount (e.g. a
      // responsive container being resized) — the renderer's own canvas
      // size only tracks them via this check, since this GL-setup effect
      // only runs once per component instance (not on every prop change).
      if (dw !== lastWidth || dh !== lastHeight) {
        lastWidth = dw;
        lastHeight = dh;
        renderer.setSize(dw, dh);
      }

      const { swayEnabled: active, swayGainX, swayGainY, swayDisableX, swayDisableY } = swayConfigRef.current;
      const t = telemetryRef.current;
      const gLat = active ? Math.max(-3, Math.min(3, t?.['gLat'] ?? 0)) : 0;
      const gLon = active ? Math.max(-4, Math.min(4, t?.['gLon'] ?? 0)) : 0;
      sway.yaw   = lerp(sway.yaw,   swayDisableX ? 0 : -gLat * SWAY_YAW_DEG_PER_G   * swayGainX, 0.08);
      sway.pitch = lerp(sway.pitch, swayDisableY ? 0 :  gLon * SWAY_PITCH_DEG_PER_G * swayGainY, 0.08);

      if (cameraRef.current) {
        cameraRef.current.fov = f;
        cameraRef.current.aspect = dw / dh;
        cameraRef.current.updateProjectionMatrix();
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(-(p + sway.pitch)),
          THREE.MathUtils.degToRad(-(y + sway.yaw)),
          THREE.MathUtils.degToRad(r),
          'YXZ',
        );
        cameraRef.current.quaternion.setFromEuler(euler);
      }

      // Time-based exponential smoothing toward the target nightAmount —
      // replaces the old `opacity 2.5s ease` CSS transition (this now
      // drives a single shader uniform instead of two layered elements'
      // opacity). tau chosen so ~3*tau ≈ 2.5s (the old transition's
      // duration), i.e. ~95% converged by then. Target is forced to 0 when
      // there's no real night texture (nightTextureRef null) — sampling an
      // unbound `nightMap` uniform resolves to black in WebGL, so without
      // this guard the day photo would visibly fade toward solid black as
      // mixAmount ramped up for a car/dashboard with no night photo at all.
      // The 0.95 cap (matching the flat CSS night overlay in Canvas.tsx/
      // DashPanEditor.tsx) means full night never fully replaces the day
      // texture even when a real night photo exists.
      if (shaderRef.current) {
        const tauMs = 830;
        const smoothing = 1 - Math.exp(-dtMs / tauMs);
        const target = nightTextureRef.current ? stateRef.current.nightAmount * 0.95 : 0;
        mixAmountRef.current = lerp(mixAmountRef.current, target, smoothing);
        shaderRef.current.uniforms.mixAmount.value = mixAmountRef.current;
        shaderRef.current.uniforms.nightMap.value = nightTextureRef.current;
      }

      renderer.render(scene, cameraRef.current!);
    };
    render();

    return () => {
      cancelAnimationFrame(rafId);
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      if (mountRef.current?.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      materialRef.current = null;
      shaderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Texture loading — swaps the existing material's map in place rather than
  // recreating the WebGL context (see the GL-setup effect above). Runs
  // whenever photoUrl actually changes, including the cache-miss-placeholder
  // -> real-photo transition that used to trigger a full context teardown.
  // Also depends on glGeneration in case this effect first runs before GL
  // setup has created a material.
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;

    let cancelled = false;
    const texture = new THREE.TextureLoader().load(photoUrl, () => {
      if (!cancelled) onLoadedRef.current?.();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    material.needsUpdate = true;

    return () => {
      cancelled = true;
      texture.dispose();
    };
  }, [photoUrl, glGeneration]);

  // Same shape as the day-texture effect above, targeting nightTextureRef
  // (synced into the shader's nightMap uniform every frame — see the render
  // loop) instead of material.map directly. onLoaded isn't re-fired here:
  // its contract ("first frame ready") is already satisfied by the day
  // texture, which is always present; the night layer loading in is a
  // continuation, not a first paint.
  useEffect(() => {
    if (!nightPhotoUrl) {
      nightTextureRef.current = null;
      return;
    }
    // Assigned synchronously, same as the day-texture effect — leaving
    // nightTextureRef null until the image data finishes loading would mean
    // the shader samples a null nightMap uniform whenever mixAmount is
    // already nonzero at mount (e.g. loading straight into night mode).
    const texture = new THREE.TextureLoader().load(nightPhotoUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    nightTextureRef.current = texture;

    return () => {
      if (nightTextureRef.current === texture) nightTextureRef.current = null;
      texture.dispose();
    };
  }, [nightPhotoUrl, glGeneration]);

  useImperativeHandle(ref, () => ({
    capture: async (captureWidth: number, captureHeight: number): Promise<string> => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return '';
      const r = rendererRef.current;
      const { displayWidth: dw, displayHeight: dh } = stateRef.current;
      r.setSize(captureWidth, captureHeight);
      cameraRef.current.aspect = captureWidth / captureHeight;
      cameraRef.current.updateProjectionMatrix();
      r.render(sceneRef.current, cameraRef.current);
      const dataUrl = r.domElement.toDataURL('image/png');
      r.setSize(dw, dh);
      cameraRef.current.aspect = dw / dh;
      cameraRef.current.updateProjectionMatrix();
      r.render(sceneRef.current, cameraRef.current);
      return dataUrl;
    },
  }));

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      startYaw: stateRef.current.yaw, startPitch: stateRef.current.pitch,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const sensitivity = stateRef.current.fov / 400;
    const newYaw   = d.startYaw   - (e.clientX - d.startX) * sensitivity;
    const newPitch = Math.max(-85, Math.min(85,
      d.startPitch + (e.clientY - d.startY) * sensitivity,
    ));
    onChange(newYaw, newPitch, stateRef.current.fov, stateRef.current.roll);
  }, [onChange]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * 0.05;
    const newFov = Math.max(5, Math.min(120, stateRef.current.fov + delta));
    onChange(stateRef.current.yaw, stateRef.current.pitch, newFov, stateRef.current.roll);
  }, [onChange]);

  return (
    <div style={{ position: 'relative', width: displayWidth, height: displayHeight, cursor: readOnly ? 'default' : 'grab', flexShrink: 0 }}>
      <div
        ref={mountRef}
        style={{ width: displayWidth, height: displayHeight, overflow: 'hidden' }}
        onPointerDown={readOnly ? undefined : onPointerDown}
        onPointerMove={readOnly ? undefined : onPointerMove}
        onPointerUp={readOnly ? undefined : onPointerUp}
        onPointerCancel={readOnly ? undefined : onPointerUp}
        onWheel={readOnly ? undefined : onWheel}
      />
    </div>
  );
});

Photo360Viewer.displayName = 'Photo360Viewer';
export default Photo360Viewer;
