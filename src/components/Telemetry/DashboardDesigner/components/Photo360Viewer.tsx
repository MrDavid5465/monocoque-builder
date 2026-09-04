import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { NeckFxSample, neckFxIsLive } from '../../useAcNeckFx';

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
  // Ambient-light tint from Huenicorn (see graphql/mod.rs's AmbientColor
  // event / huenicorn.rs) — blended in after the day/night mix so the
  // virtual cockpit visually agrees with the physical room's Hue lighting.
  // v1 drives this from one picked channel (the wire format carries all of
  // them — see AmbientColorChanged's own doc comment — so a later
  // per-region effect is a pure addition, not a rework).
  // `ambientTintIntensity` (0-1) is the Settings dial behind the
  // soft-light blend's opacity (scaled by night/spike conditions in the
  // render loop, see there); 0 or a missing `ambientColor` both resolve to
  // a no-op tint.
  ambientColor?: { r: number; g: number; b: number } | null;
  ambientTintIntensity?: number;
  // How much to exaggerate the tint color's own saturation (see the render
  // loop's own comment near `boostedR`/`boostedG`/`boostedB`) — 1 = as
  // captured (default), higher pushes a pale/washed-out reading toward a
  // genuinely vivid color instead of just a brighter version of the same
  // pale color (a pale red becomes a vibrant red, not a bright pale red).
  // `day`/`night` are the endpoints of a blend, not two modes: the render
  // loop interpolates between them by `nightLevelRef` (the same smoothed
  // night amount `nightBoost` uses), so a simulated dawn/dusk eases the
  // vividness continuously instead of snapping — mirrors the bulbs' own
  // day/night gamma blend (see huenicorn::run_gamma_pusher).
  ambientSaturationBoostDay?: number;
  ambientSaturationBoostNight?: number;
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
  // Assetto Corsa's applied head movement, when the AC telemetry app is
  // streaming — preferred over the g-derived sway above, which stays as the
  // fallback for every other sim. A ref rather than a field on telemetryData:
  // it arrives at 60Hz off the shared hub (useAcNeckFx) and is read inside the
  // render loop, so it must never re-render anything.
  neckFxRef?: React.RefObject<NeckFxSample>;
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
  // When present, the ambient tint is painted into THIS element (a
  // soft-light overlay Canvas.tsx renders above its night overlay) instead of
  // being blended in the shader — because the night overlay sits above this
  // canvas and would otherwise transmit only ~19% of the tint. Written
  // imperatively from the render loop, never through React state: the tint
  // moves at ~60Hz. The in-shader tint is zeroed while this is in use so the
  // two never stack.
  tintOverlayRef?: React.RefObject<HTMLDivElement>;
}

// Calibrated so typical cornering g (~1g) gives ~1-2° of sway, and the clamped
// max (a spin/crash-level event) tops out around 5°. Panning the camera reads
// as much bigger motion than the equivalent pixel-based canvas sway, so this
// is deliberately far gentler than the canvas sway's degrees-per-g.
const SWAY_YAW_DEG_PER_G   = 1.5;
const SWAY_PITCH_DEG_PER_G = 0.75;

// NeckFX path: degrees of pan per metre of head movement, used INSTEAD of the
// per-g constants above whenever Assetto Corsa is reporting the offset it
// actually applied (see telemetry/types.rs on why a washout filter can't be
// approximated from g).
//
// Scaled to land in the same visual range as the g-derived path they replace,
// so enabling the telemetry app changes the phase and feel of the sway but not
// its magnitude: CSP's cockpit camera moves the head a few centimetres at
// cornering loads, and ~1.5° at ~0.045m is where these come from. The 2:1
// yaw:pitch ratio is carried over deliberately.
const SWAY_YAW_DEG_PER_M   = 33;
const SWAY_PITCH_DEG_PER_M = 16.5;

// Vertical head travel (heave) is its own gain rather than reusing the
// longitudinal one: they're different motions with different ranges — a kerb
// strike moves the head much further, and much faster, than braking does —
// and keeping them separate means either can be tuned, or sign-flipped,
// without disturbing the other.
//
// UNCALIBRATED. Every per-metre figure here is derived from an assumed few
// centimetres of head travel per g, not from measured values. Sample the live
// channel before trusting any of them.
const SWAY_PITCH_DEG_PER_M_HEAVE = 25;

// Head movement past this (metres) is treated as a glitch rather than a
// reading — mirrors the ±3g/±4g clamps on the fallback path.
const NECK_OFFSET_CLAMP_M = 0.25;

// Same idea for the rotation channel. Generous: NeckFX's look-into-the-corner
// effects can legitimately reach well past ten degrees when their multipliers
// are turned up, and this only exists to reject a garbage frame — it is not a
// taste control. Turn the gain down instead.
//
// Was 45 — measured live (right-click-drag free-look, recorded via
// acTelemetrySnapshot) that a real 90-degree free-look reports very close to
// a real +/-90 in neckYawDeg, so 45 was clamping legitimate free-look input
// at HALF its actual range: the photo sphere stopped following a full 45
// degrees before the player stopped turning their head. 100 clears AC's
// observed ~90-degree free-look cap with headroom, while still catching an
// actually-glitched frame.
const NECK_ANGLE_CLAMP_DEG = 100;

// Fraction of the full night darkening applied when the car HAS a night
// photo. The photo already supplies the night *look*; this only takes the
// overall level down so it reads as night rather than as a differently-lit
// daytime shot. Turn this up if night still isn't dark enough, down if the
// scene goes muddy. 0 restores the previous behaviour (photo only).
// How often a gesture reports to the parent. The render loop shows every
// frame regardless, so this only paces the React updates behind it.
const EMIT_INTERVAL_MS = 120;

const NIGHT_DARKEN_WITH_PHOTO = 0.45;

const Photo360Viewer = forwardRef<Photo360Handle, Props>(({
  photoUrl, nightPhotoUrl, nightAmount = 0, ambientColor = null, ambientTintIntensity = 0,
  ambientSaturationBoostDay = 1, ambientSaturationBoostNight = 1,
  yaw, pitch, fov, roll, displayWidth, displayHeight, onChange, readOnly = false,
  telemetryData, neckFxRef, swayEnabled = false, swayGainX = 1, swayGainY = 1, swayDisableX = false, swayDisableY = false,
  onLoaded, tintOverlayRef,
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
  // Current lerped ambientTint/ambientOpacity values, mirroring
  // mixAmountRef's role for the day/night blend — smoothed here (not just
  // in the shader) so JS always knows the in-flight value for the next
  // frame's lerp target.
  const ambientTintVecRef = useRef(new THREE.Vector3(0, 0, 0));
  const ambientOpacityRef = useRef(0);
  // Smoothed nightAmount that is NOT gated on having a night texture, unlike
  // mixAmountRef. nightBoost previously read mixAmountRef, so on a car with
  // no night photo it stayed pinned at 1 and the boost never engaged at all.
  const nightLevelRef = useRef(0);
  const stateRef    = useRef({ yaw, pitch, fov, roll, displayWidth, displayHeight, nightAmount, ambientColor, ambientTintIntensity, ambientSaturationBoostDay, ambientSaturationBoostNight });
  stateRef.current  = { yaw, pitch, fov, roll, displayWidth, displayHeight, nightAmount, ambientColor, ambientTintIntensity, ambientSaturationBoostDay, ambientSaturationBoostNight };
  const dragRef     = useRef<{ startX: number; startY: number; startYaw: number; startPitch: number } | null>(null);

  // Live pan, owned here while the user is interacting, and read by the
  // render loop in preference to the props.
  //
  // The viewer is a controlled component, so before this every pointer move
  // had to round-trip through the parent's React state before it could show:
  // in the designer that meant `trackedSetDashboard` re-rendering the entire
  // dashboard node tree at pointer rate, which is exactly as smooth as it
  // sounds. The gesture now updates this ref and the ~60Hz loop picks it up
  // on the next frame regardless of what React is doing; `onChange` is still
  // called, just throttled, so saves and sliders keep working.
  const livePanRef = useRef<{ yaw: number; pitch: number; fov: number } | null>(null);
  // What we last told the parent. Lets an incoming prop change be classified:
  // matching means it's our own value echoing back, differing means something
  // else moved the pan (sliders, a car switch, a reset) and should win.
  const lastEmittedRef = useRef<{ yaw: number; pitch: number; fov: number } | null>(null);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastEmitAtRef = useRef(0);

  {
    const last = lastEmittedRef.current;
    // Only a value we've already published can be compared against. Before
    // the first emit of a gesture `last` is null and the props are legitimately
    // stale — treating that as external would discard the live value and snap
    // back, which is visible if anything else re-renders mid-gesture (a
    // telemetry tick will do it).
    const external = !!last
      && (Math.abs(last.yaw - yaw) > 0.001
        || Math.abs(last.pitch - pitch) > 0.001
        || Math.abs(last.fov - fov) > 0.001);
    if (external && !dragRef.current) {
      livePanRef.current = null;
      lastEmittedRef.current = null;
    }
  }

  const telemetryRef = useRef(telemetryData);
  telemetryRef.current = telemetryData;
  // Mirrored the same way as telemetryData above: the GL-setup effect below
  // runs once, so it must not close over whichever ref object happened to be
  // passed on the first render.
  const neckFxPropRef = useRef(neckFxRef);
  neckFxPropRef.current = neckFxRef;
  const swayConfigRef = useRef({ swayEnabled, swayGainX, swayGainY, swayDisableX, swayDisableY });
  swayConfigRef.current = { swayEnabled, swayGainX, swayGainY, swayDisableX, swayDisableY };
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const tintOverlayRefRef = useRef(tintOverlayRef);
  tintOverlayRefRef.current = tintOverlayRef;
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
      // ambientTint is SOFT-LIGHT blended over the photo (see softLight()
      // below), at `ambientOpacity`. History, since three blend modes have
      // been tried here and each failed differently: a plain multiplier left
      // dark/shadowed pixels dark no matter how extreme it got (black *
      // anything = black); a mix()-toward-color fixed that but replaced the
      // photo's own local detail/contrast with a flat wash at any real
      // strength (confirmed live: "washes out the image"); additive fixed
      // the flatness but applied the same absolute lift to every pixel, so
      // it read as uniformly strong across the whole frame and blew out
      // highlights. Soft light is luminance-dependent instead — it pushes
      // midtones hardest and falls off toward both ends, so deep shadows
      // stay dark and bright highlights stay bright, which is how real
      // in-game light (fireworks, neon) actually washes over a cockpit.
      // ambientOpacity (0 = no-op) is how far to blend toward the
      // soft-lit result, smoothed separately in JS the same way mixAmount is.
      shader.uniforms.ambientTint = { value: new THREE.Vector3(0, 0, 0) };
      shader.uniforms.ambientOpacity = { value: 0 };
      // Only non-zero for cars with no night photo — see the fragment
      // shader's own comment on why this darkening lives here and not in a
      // DOM overlay above the canvas.
      shader.uniforms.nightDarken = { value: 0 };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D nightMap;
          uniform float mixAmount;
          uniform vec3 ambientTint;
          uniform float ambientOpacity;
          uniform float nightDarken;
          // Standard (W3C/Photoshop) soft light. blend == 0.5 is the neutral
          // point and returns base untouched; above pushes toward white,
          // below toward black, both with a falloff that shrinks as base
          // approaches the corresponding end — that falloff is the whole
          // point, it's what keeps crushed blacks and blown highlights from
          // moving while midtones take the full effect.
          float softLightChannel( float base, float blend ) {
            if ( blend <= 0.5 ) {
              return base - ( 1.0 - 2.0 * blend ) * base * ( 1.0 - base );
            }
            float d = ( base <= 0.25 )
              ? ( ( 16.0 * base - 12.0 ) * base + 4.0 ) * base
              : sqrt( base );
            return base + ( 2.0 * blend - 1.0 ) * ( d - base );
          }
          vec3 softLight( vec3 base, vec3 blend ) {
            return vec3(
              softLightChannel( base.r, blend.r ),
              softLightChannel( base.g, blend.g ),
              softLightChannel( base.b, blend.b )
            );
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 dayTexel = texture2D( map, vMapUv );
            vec4 nightTexel = texture2D( nightMap, vMapUv );
            vec4 sampledDiffuseColor = mix( dayTexel, nightTexel, mixAmount );
            // Flat night darkening for cars with NO night photo. This used to
            // be a DOM overlay (rgba(0,0,0,0.85) at NIGHT_OVERLAY_Z in
            // Canvas.tsx) painted ABOVE this canvas — which meant it also
            // covered the ambient tint below it, transmitting only ~19% of it
            // at full night and making the tint 42% WEAKER at night than in
            // daylight, while nightBoost was busy trying to make it 3x
            // stronger. Doing it here instead puts the darkening BEFORE the
            // tint, so the tint modulates the pixels actually on screen.
            // 0.8 matches the old overlay's effective alpha (0.85 * 0.95), so
            // the no-night-photo case looks unchanged. The JS side scales
            // nightDarken down (NIGHT_DARKEN_WITH_PHOTO) when a real night
            // photo is supplying most of the look already.
            sampledDiffuseColor.rgb *= ( 1.0 - nightDarken * 0.8 );
            vec3 softLit = softLight( sampledDiffuseColor.rgb, ambientTint );
            sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, softLit, ambientOpacity );
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
      const { roll: r, displayWidth: dw, displayHeight: dh } = stateRef.current;
      // Live gesture value when there is one, otherwise the prop.
      const live = livePanRef.current;
      const y = live ? live.yaw : stateRef.current.yaw;
      const p = live ? live.pitch : stateRef.current.pitch;
      const f = live ? live.fov : stateRef.current.fov;

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
      // Assetto Corsa's real head movement when it's available, the g-derived
      // approximation otherwise. Not a blend: they disagree in phase by
      // design, so crossfading would produce motion neither source asked for.
      //
      // Read from its own ref rather than from `telemetryData` — this comes
      // over the separate acTelemetry subscription (see useAcNeckFx), so the
      // cross-sim frame stays free of AC-only fields.
      const neck = neckFxPropRef.current?.current;
      const neckLive = neckFxIsLive(neck);
      const clampNeck = (v: number) =>
        Math.max(-NECK_OFFSET_CLAMP_M, Math.min(NECK_OFFSET_CLAMP_M, v));
      const clampAngle = (v: number) =>
        Math.max(-NECK_ANGLE_CLAMP_DEG, Math.min(NECK_ANGLE_CLAMP_DEG, v));

      let targetYaw: number;
      let targetPitch: number;
      if (active && neckLive && neck) {
        // Signs follow from the head lagging BEHIND the car: under leftward
        // acceleration the head is thrown right (+x), which is the same
        // direction the g-derived path pans for that corner — hence the
        // positive coefficient here against gLat's negative one. Likewise
        // braking throws the head forward (+z) where gLon goes negative.
        // Degrees straight through — this viewer pans in degrees, and the
        // game is reporting the angle it actually applied, so there is nothing
        // to convert. The position channel below needed an invented
        // degrees-per-metre gain; this needs none.
        //
        // Position is added on top rather than ignored: it carries movement
        // the rotation cannot (heave over kerbs), and it is what responds if
        // the following effects are turned up in neck.ini.
        //
        // neck.yawDeg is negated: measured live via free-look (right-click-drag
        // in AC, recorded through acTelemetrySnapshot) that AC reports a
        // NEGATIVE neckYawDeg for a real rightward look and POSITIVE for
        // leftward — opposite of this viewer's own yaw convention (see
        // onPointerMove above), so passing it through unnegated panned the
        // photo sphere the wrong way: turning your head right visibly panned
        // left. clampNeck(neck.x) is untouched — its sign was deliberately
        // matched to the g-derived fallback path (comment above) and nothing
        // reported it as wrong.
        targetYaw =
          (-clampAngle(neck.yawDeg) + clampNeck(neck.x) * SWAY_YAW_DEG_PER_M) * swayGainX;
        // Vertical head movement (heave over bumps and kerbs) was being
        // dropped here entirely — only x and z were read — which threw away
        // the most visible motion the game actually applies. Raising the head
        // shows more of what's above, so +y pitches the view up.
        //
        // neck.pitchDeg is negated for the same reason neck.yawDeg is above:
        // confirmed live that AC's pitch convention is also opposite this
        // viewer's own (looking up panned the photo sphere down). z/y stay
        // untouched — same reasoning as x on the yaw line.
        targetPitch =
          (-clampAngle(neck.pitchDeg)
            - clampNeck(neck.z) * SWAY_PITCH_DEG_PER_M
            + clampNeck(neck.y) * SWAY_PITCH_DEG_PER_M_HEAVE)
          * swayGainY;
      } else {
        const gLat = active ? Math.max(-3, Math.min(3, t?.['gLat'] ?? 0)) : 0;
        const gLon = active ? Math.max(-4, Math.min(4, t?.['gLon'] ?? 0)) : 0;
        targetYaw   = -gLat * SWAY_YAW_DEG_PER_G   * swayGainX;
        targetPitch =  gLon * SWAY_PITCH_DEG_PER_G * swayGainY;
      }
      if (!active) { targetYaw = 0; targetPitch = 0; }

      // Same 0.08 smoothing either way. It stays even on the NeckFX path:
      // frames arrive at 30Hz against this ~60Hz render loop, so without it
      // the sway would step rather than move.
      sway.yaw   = lerp(sway.yaw,   swayDisableX ? 0 : targetYaw,   0.08);
      sway.pitch = lerp(sway.pitch, swayDisableY ? 0 : targetPitch, 0.08);

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

        // Texture-independent night level. mixAmount is forced to 0 without a
        // night texture (sampling an unbound nightMap yields black), so it
        // cannot stand in for "how night is it" — which is what both the
        // flat darkening and nightBoost actually want.
        nightLevelRef.current = lerp(nightLevelRef.current, stateRef.current.nightAmount, smoothing);
        // ONLY when a night photo exists — i.e. exactly when Canvas.tsx
        // suppresses its flat night overlay. Without a photo that overlay is
        // still what darkens the scene, and it must stay: it covers the whole
        // canvas, so it dims the gauges and text too, which a shader on the
        // photosphere cannot do. Darkening here as well would double-darken.
        //
        // With a photo, nothing else darkens at all: the day/night mix just
        // crossfades between two normally-exposed photographs, and a night
        // photograph is exposed to look correct on its own, not to read as
        // dark beside a daylight one.
        shaderRef.current.uniforms.nightDarken.value =
          nightTextureRef.current ? nightLevelRef.current * NIGHT_DARKEN_WITH_PHOTO : 0;

        // Ambient tint: soft-light blended over the photo at
        // `ambientOpacity` (see the shader's own comment for the full
        // multiply → mix → additive → soft-light history and why each
        // earlier mode was abandoned). `ambientTintIntensity` — the "Tint
        // intensity" slider on the Ambient Lights page — is the user-facing
        // dial for that opacity; everything below scales it by conditions
        // (night, spike selectivity) rather than replacing it.
        const { ambientColor: ac, ambientTintIntensity: intensity } = stateRef.current;
        const tintTarget = { x: 0, y: 0, z: 0 };
        let opacityTarget = 0;
        if (ac && intensity > 0) {
          // A physical ambient light's color cast reads far stronger
          // against a dark room than a bright one. mixAmountRef is already
          // this frame's smoothed day/night blend; boosts opacity up to 3x
          // at full night. The `* 0.5` keeps the slider's *default* (0.3)
          // landing at ~0.15 opacity in daylight — the 15-20% range this
          // was tuned to by eye — while leaving the slider's top half as
          // headroom, so full intensity at full night can still reach a
          // complete (1.0) soft-light blend. No hard sub-1.0 cap here
          // anymore: the old 0.5 ceiling existed because additive blending
          // overexposed the scene toward the tint color, which soft light's
          // highlight falloff makes a non-issue.
          // nightLevelRef, not mixAmountRef: the latter is pinned to 0 on a
          // car with no night photo, which is exactly the case that needs the
          // boost most — it's now the darkened-in-shader one.
          const nightBoost = 1 + nightLevelRef.current * 2;
          // Gate on ABSOLUTE colourfulness, not deviation from a rolling
          // baseline.
          //
          // The previous version tracked a slow (tau 4s) baseline of recent
          // saturation and drove opacity from `saturation - baseline`. That
          // is self-cancelling by construction: hold any colour steady and
          // the baseline converges onto it within a few seconds, deviation
          // goes to zero, and the tint fades itself out — a sustained red
          // sunset would light up briefly and then vanish. Squaring the
          // result made it worse (half the deviation gave a quarter of the
          // opacity), and it fed a second 830ms smoother, so the whole
          // response was sluggish twice over. Net effect: only sharp
          // transients ever showed, and only for a moment.
          //
          // A plain floor/ceiling ramp on absolute saturation keeps a
          // colourful scene tinted for as long as it stays colourful, while
          // still leaving genuinely neutral/grey captures untinted. SAT_FULL
          // is deliberately reachable: Huenicorn's capture regions are large,
          // so a vivid burst averaged over a mostly-dark region still only
          // reads ~0.32 raw saturation — measured live under in-game
          // fireworks — and a ceiling above that would never be hit.
          const maxChannel = Math.max(ac.r, ac.g, ac.b, 0.0001);
          const minChannel = Math.min(ac.r, ac.g, ac.b);
          const saturation = (maxChannel - minChannel) / maxChannel;
          const luma = (ac.r + ac.g + ac.b) / 3;
          const SAT_FLOOR = 0.10; // below this the reading is effectively grey
          const SAT_FULL  = 0.35; // at/above this the gate is fully open
          const t = Math.min(1, Math.max(0, (saturation - SAT_FLOOR) / (SAT_FULL - SAT_FLOOR)));
          // smoothstep, so the gate eases in/out instead of cornering at the
          // floor — no squaring, so mid-range colour keeps mid-range opacity.
          const saturationGate = t * t * (3 - 2 * t);
          opacityTarget = Math.min(1, intensity * nightBoost * 0.5) * saturationGate;
          // ambientSaturationBoost pushes each channel's deviation from the
          // reading's own average outward before picking the tint color —
          // 1 (default) leaves hue/saturation untouched, higher values turn
          // a pale/washed-out reading (e.g. a dim, barely-red capture) into
          // a genuinely vivid one (a saturated red) rather than just a
          // brighter version of the same pale color.
          //
          // The result is then scaled to a LEVEL derived from the reading's
          // own luma, rather than pinning the max channel to a fixed 0.9.
          // That fixed value was calibrated for additive blending, where it
          // just meant "a bright version of the color", and it threw the
          // reading's intensity away: a dim red and a blazing red produced
          // the identical tint, so the effect had no dynamics.
          //
          // Soft light is neutral at 0.5 — channels above lift toward white,
          // below fall toward black — so the range floor sits above that
          // (a dim reading still lifts, just gently) and the ceiling is
          // near the old 0.9 (a bright reading pushes as hard as before).
          // nightLevelRef, not the raw nightAmount prop — same smoothed
          // value nightBoost above uses, so the day/night boost blend eases
          // continuously alongside it instead of snapping.
          const { ambientSaturationBoostDay: boostDay, ambientSaturationBoostNight: boostNight } = stateRef.current;
          const boost = boostDay + (boostNight - boostDay) * nightLevelRef.current;
          const boostedR = Math.max(0, luma + (ac.r - luma) * boost);
          const boostedG = Math.max(0, luma + (ac.g - luma) * boost);
          const boostedB = Math.max(0, luma + (ac.b - luma) * boost);
          const maxBoosted = Math.max(boostedR, boostedG, boostedB, 0.0001);
          const LEVEL_MIN = 0.60;
          const LEVEL_MAX = 0.95;
          const level = LEVEL_MIN + Math.min(1, Math.max(0, luma)) * (LEVEL_MAX - LEVEL_MIN);
          const vividScale = level / maxBoosted;
          tintTarget.x = boostedR * vividScale;
          tintTarget.y = boostedG * vividScale;
          tintTarget.z = boostedB * vividScale;
        }
        // Ambient gets its own, much shorter tau than the day/night blend's
        // 830ms. They were sharing `smoothing` — but the day/night crossfade
        // is deliberately slow (it stands in for a 2.5s CSS transition),
        // whereas the ambient tint is tracking a light that is physically
        // changing right now. At 830ms on top of the old 4s baseline the
        // tint always arrived late; on its own at ~250ms it reads as
        // responsive while still filtering out per-frame capture jitter.
        const ambientTauMs = 250;
        const ambientSmoothing = 1 - Math.exp(-dtMs / ambientTauMs);
        ambientTintVecRef.current.set(
          lerp(ambientTintVecRef.current.x, tintTarget.x, ambientSmoothing),
          lerp(ambientTintVecRef.current.y, tintTarget.y, ambientSmoothing),
          lerp(ambientTintVecRef.current.z, tintTarget.z, ambientSmoothing),
        );
        ambientOpacityRef.current = lerp(ambientOpacityRef.current, opacityTarget, ambientSmoothing);
        // Route the tint either into the shader or into the DOM overlay,
        // never both. The overlay only exists when Canvas is drawing its
        // night overlay, which is exactly the case where an in-shader tint
        // would be mostly swallowed by it.
        const overlayEl = tintOverlayRefRef.current?.current ?? null;
        const t = ambientTintVecRef.current;
        shaderRef.current.uniforms.ambientTint.value.copy(t);
        shaderRef.current.uniforms.ambientOpacity.value = overlayEl ? 0 : ambientOpacityRef.current;
        if (overlayEl) {
          const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
          overlayEl.style.backgroundColor = `rgb(${to255(t.x)}, ${to255(t.y)}, ${to255(t.z)})`;
          overlayEl.style.opacity = String(ambientOpacityRef.current);
        }
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

  // Publishes the live pan to the parent, at most every EMIT_INTERVAL_MS with
  // a guaranteed trailing call. The render loop is already showing the value,
  // so this only needs to be often enough for sliders and the debounced saves
  // to keep up — one React update per frame would put the whole dashboard
  // tree back in the drag path, which is what made this jerky.
  const emitPan = useCallback((immediate = false) => {
    const live = livePanRef.current;
    if (!live) return;
    const send = () => {
      lastEmitAtRef.current = Date.now();
      lastEmittedRef.current = { ...live };
      onChangeRef.current(live.yaw, live.pitch, live.fov, stateRef.current.roll);
    };
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    if (immediate || Date.now() - lastEmitAtRef.current >= EMIT_INTERVAL_MS) {
      send();
    } else {
      emitTimerRef.current = setTimeout(send, EMIT_INTERVAL_MS);
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const live = livePanRef.current;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      startYaw: live ? live.yaw : stateRef.current.yaw,
      startPitch: live ? live.pitch : stateRef.current.pitch,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const fovNow = livePanRef.current?.fov ?? stateRef.current.fov;
    const sensitivity = fovNow / 400;
    const newYaw   = d.startYaw   - (e.clientX - d.startX) * sensitivity;
    // Inverted: dragging DOWN now looks down. Grabbing the scene and pulling
    // it with you is the direct-manipulation reading, and it matches the
    // horizontal axis beside it, which has always worked that way.
    const newPitch = Math.max(-85, Math.min(85,
      d.startPitch - (e.clientY - d.startY) * sensitivity,
    ));
    livePanRef.current = { yaw: newYaw, pitch: newPitch, fov: fovNow };
    emitPan();
  }, [emitPan]);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // The throttle may be mid-wait holding the final position — make sure the
    // parent ends up with where the gesture actually stopped.
    emitPan(true);
  }, [emitPan]);

  // Zoom-by-wheel, as a NATIVE non-passive listener rather than JSX onWheel.
  //
  // React registers `wheel` passively at its root, so `preventDefault()` in an
  // onWheel handler is silently a no-op: the page scrolled while zooming, and
  // on a dashboard the canvas's own wheel-zoom (Canvas.tsx, itself a
  // non-passive native listener on an ancestor) fired too, so one gesture
  // zoomed both the 360 and the canvas under it. Attaching here gets a real
  // preventDefault, and stopPropagation keeps the gesture from reaching that
  // ancestor at all.
  //
  // `onChange` is read through a ref so this listener is attached once rather
  // than re-attached on every render by callers passing an inline arrow.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const el = mountRef.current;
    if (!el || readOnly) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Multiplicative, and normalised for deltaMode — the same treatment
      // Canvas.tsx gives its own zoom. A fixed additive step felt coarse at
      // narrow FOV and sluggish at wide, because a degree is worth far more
      // when you're zoomed in; scaling keeps each notch the same proportion.
      // deltaMode 1 is lines rather than pixels (Firefox), which without the
      // conversion made every notch a huge jump.
      const pixelDelta = e.deltaMode === 0 ? e.deltaY : e.deltaY * 16;
      const current = livePanRef.current?.fov ?? stateRef.current.fov;
      const newFov = Math.max(5, Math.min(120, current * Math.exp(pixelDelta * 0.0015)));
      const live = livePanRef.current;
      livePanRef.current = {
        yaw: live ? live.yaw : stateRef.current.yaw,
        pitch: live ? live.pitch : stateRef.current.pitch,
        fov: newFov,
      };
      emitPan();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [readOnly, emitPan]);

  return (
    <div style={{ position: 'relative', width: displayWidth, height: displayHeight, cursor: readOnly ? 'default' : 'grab', flexShrink: 0 }}>
      <div
        ref={mountRef}
        style={{ width: displayWidth, height: displayHeight, overflow: 'hidden' }}
        onPointerDown={readOnly ? undefined : onPointerDown}
        onPointerMove={readOnly ? undefined : onPointerMove}
        onPointerUp={readOnly ? undefined : onPointerUp}
        onPointerCancel={readOnly ? undefined : onPointerUp}
      />
    </div>
  );
});

Photo360Viewer.displayName = 'Photo360Viewer';
export default Photo360Viewer;
