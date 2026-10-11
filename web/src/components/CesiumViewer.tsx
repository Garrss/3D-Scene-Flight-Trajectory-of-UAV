import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react'
import { Viewer, Entity, PolylineGraphics, ImageryLayer } from 'resium'
import {
  Cartesian3,
  Color,
  HeadingPitchRoll,
  Math as CesiumMath,
  Transforms,
  ConstantProperty,
  NearFarScalar,
  Cartesian2,
  Viewer as CesiumViewer,
  JulianDate,
  EllipsoidTerrainProvider,
  UrlTemplateImageryProvider,
  SceneMode,
  CallbackProperty,
  Quaternion,
  Credit,
  CreditDisplay,
  buildModuleUrl,
  Cartographic,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium'
import type { CollisionAlert, DroneState, DroneFleet, Mission, Waypoint} from '../types/drone'
import { DroneInterpolator, lerpAngleRad } from '../lib/DroneInterpolator'

import droneModelUrl from '../assets/uav.gltf?url'

const cesiumLogoUrl = buildModuleUrl('Assets/Images/cesium_credit.png')
CreditDisplay.cesiumCredit = new Credit(
  `<a href="https://cesium.com/" target="_blank" rel="noopener noreferrer"><img src="${cesiumLogoUrl}" alt="Cesium" title="Cesium" /></a>`,
  true,
)

const gaodeSatellite = new UrlTemplateImageryProvider({
  url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  subdomains: ['1', '2', '3', '4'],
  maximumLevel: 18,
  credit: 'Imagery Â© Amap (AutoNavi)',
})

const flatTerrain = new EllipsoidTerrainProvider()

// ======= Landmarks =======
const LANDMARKS: { name: string; lng: number; lat: number; type: 'district' | 'road' | 'poi' }[] = [
  { name: 'Nanshan District', lng: 113.930, lat: 22.533, type: 'district' },
  { name: 'Futian District', lng: 114.055, lat: 22.527, type: 'district' },
  { name: 'Luohu District', lng: 114.131, lat: 22.548, type: 'district' },
  { name: "Bao'an District", lng: 113.883, lat: 22.555, type: 'district' },
  { name: 'Shenzhen Bay Park', lng: 113.942, lat: 22.515, type: 'poi' },
  { name: 'Shenzhen Bay Bridge', lng: 113.965, lat: 22.498, type: 'poi' },
  { name: 'Overseas Chinese Town', lng: 114.004, lat: 22.535, type: 'poi' },
  { name: 'Civic Center', lng: 114.054, lat: 22.543, type: 'poi' },
  { name: 'Lianhuashan Park', lng: 114.058, lat: 22.556, type: 'poi' },
  { name: 'Convention & Exhibition Center', lng: 114.061, lat: 22.529, type: 'poi' },
  { name: 'Shenzhen North Station', lng: 114.029, lat: 22.609, type: 'poi' },
  { name: 'Luohu Port', lng: 114.113, lat: 22.543, type: 'poi' },
  { name: 'Shekou Port', lng: 113.899, lat: 22.477, type: 'poi' },
  { name: 'Window of the World', lng: 113.974, lat: 22.535, type: 'poi' },
  { name: 'Shenzhen University', lng: 113.935, lat: 22.530, type: 'poi' },
  { name: 'Shennan Avenue', lng: 114.020, lat: 22.532, type: 'road' },
  { name: 'Binhai Boulevard', lng: 113.970, lat: 22.510, type: 'road' },
  { name: 'Beihuan Road', lng: 114.050, lat: 22.568, type: 'road' },
  { name: 'Yanhe Road', lng: 114.100, lat: 22.540, type: 'road' },
]

const LANDMARK_STYLES = {
  district: {
    font: new ConstantProperty('bold 18px "Microsoft YaHei", sans-serif'),
    fillColor: new ConstantProperty(Color.fromCssColorString('#FFD700')),
    outlineColor: new ConstantProperty(Color.fromCssColorString('#333')),
    outlineWidth: new ConstantProperty(4),
    style: new ConstantProperty(2),
    scaleByDistance: new ConstantProperty(new NearFarScalar(1000, 1.0, 50000, 0.3)),
    disableDepthTestDistance: new ConstantProperty(Number.POSITIVE_INFINITY),
  },
  road: {
    font: new ConstantProperty('bold 13px "Microsoft YaHei", sans-serif'),
    fillColor: new ConstantProperty(Color.fromCssColorString('#FFFFFF')),
    outlineColor: new ConstantProperty(Color.fromCssColorString('#555')),
    outlineWidth: new ConstantProperty(3),
    style: new ConstantProperty(2),
    scaleByDistance: new ConstantProperty(new NearFarScalar(500, 1.0, 30000, 0.2)),
    disableDepthTestDistance: new ConstantProperty(Number.POSITIVE_INFINITY),
  },
  poi: {
    font: new ConstantProperty('14px "Microsoft YaHei", sans-serif'),
    fillColor: new ConstantProperty(Color.fromCssColorString('#87CEEB')),
    outlineColor: new ConstantProperty(Color.fromCssColorString('#222')),
    outlineWidth: new ConstantProperty(3),
    style: new ConstantProperty(2),
    scaleByDistance: new ConstantProperty(new NearFarScalar(500, 1.0, 25000, 0.2)),
    disableDepthTestDistance: new ConstantProperty(Number.POSITIVE_INFINITY),
  },
}

const landmarkEntities = LANDMARKS.map((lm) => ({
  position: Cartesian3.fromDegrees(lm.lng, lm.lat, 5),
  label: {
    text: new ConstantProperty(lm.type === 'road' ? `â”€â”€ ${lm.name} â”€â”€` : lm.name),
    ...LANDMARK_STYLES[lm.type],
  },
}))

// Waypoint styles
const WP_POINT = {
  pixelSize: new ConstantProperty(6),
  color: new ConstantProperty(Color.YELLOW),
  outlineColor: new ConstantProperty(Color.BLACK),
  outlineWidth: new ConstantProperty(1),
  scaleByDistance: new ConstantProperty(new NearFarScalar(500, 1.5, 20000, 0.5)),
}
const WP_LABEL_BASE = {
  font: new ConstantProperty('bold 12px "Microsoft YaHei", sans-serif'),
  fillColor: new ConstantProperty(Color.WHITE),
  outlineColor: new ConstantProperty(Color.BLACK),
  outlineWidth: new ConstantProperty(3),
  style: new ConstantProperty(2),
  pixelOffset: new ConstantProperty(new Cartesian2(10, -10)),
  scaleByDistance: new ConstantProperty(new NearFarScalar(300, 1.0, 15000, 0.3)),
  disableDepthTestDistance: new ConstantProperty(Number.POSITIVE_INFINITY),
}

// ======= Drone model config =======
const DRONE_MODEL_URI = new ConstantProperty(droneModelUrl)
const DRONE_SCALE = new ConstantProperty(1.5)
const DRONE_MIN_PX = new ConstantProperty(88)
const DRONE_MAX_SCALE = new ConstantProperty(80)

const DRONE_DEFAULT_COLOR = Color.LIME

const DRONE_LABEL_BASE = {
  font: new ConstantProperty('bold 14px "Microsoft YaHei", monospace'),
  outlineColor: new ConstantProperty(Color.BLACK),
  outlineWidth: new ConstantProperty(3),
  style: new ConstantProperty(2),
  pixelOffset: new ConstantProperty(new Cartesian2(16, -24)),
  disableDepthTestDistance: new ConstantProperty(Number.POSITIVE_INFINITY),
}

type FollowMode = 'chase' | 'top' | 'free'
type WeatherMode = 'clear' | 'foggy' | 'overcast'
type SceneModeType = '3d' | '2d'

interface Props {
  fleet: DroneFleet
  droneIds: string[]
  selectedId: string
  onSelectDrone: (id: string) => void
  onReturnDroneToBase: (id: string) => void
  mission: Mission | null
  alerts?: CollisionAlert[]
  waypointEditMode: boolean
  waypointAltitude: number
  onAddWaypoint: (waypoint: Waypoint) => void
  hiddenRouteId?: string
}

// Weather
const WEATHER_OVERLAY: Record<WeatherMode, React.CSSProperties> = {
  clear: { display: 'none' },
  foggy: {
    position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
    background: 'radial-gradient(ellipse at center, rgba(200,200,200,0.5) 0%, rgba(180,180,180,0.7) 60%, rgba(160,160,160,0.85) 100%)',
  },
  overcast: {
    position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
    background: 'linear-gradient(180deg, rgba(100,100,110,0.45) 0%, rgba(80,80,90,0.25) 40%, transparent 70%)',
  },
}

// Memoized: props are stable across 5Hz telemetry ticks (position flows via
// the interpolator + CallbackProperty, not via props). onSelectDrone is the
// stable parent setter, so shallow comparison is sufficient.
const DroneEntity = memo(function DroneEntity({
  droneId,
  interpolator,
  isSelected,
  onSelectDrone,
  color,
  alertLevel,
  evading,
}: {
  droneId: string
  interpolator: DroneInterpolator
  isSelected: boolean
  onSelectDrone: (id: string) => void
  color: Color
  alertLevel: 'none' | 'warning' | 'critical'
  evading: boolean
}) {
  const positionProp = useMemo(() => {
    // Scratch object reused every frame: avoids one Cartesian3 allocation
    // per drone per rendered frame (CallbackProperty with isConstant=false
    // is evaluated on every render).
    const scratch = new Cartesian3()
    return new CallbackProperty((_time: unknown, result: unknown) => {
      const target = (result as Cartesian3 | undefined) ?? scratch
      const c = interpolator.get(droneId)
      if (!c) return Cartesian3.fromDegrees(0, 0, 0, undefined, target)
      return Cartesian3.fromDegrees(c.lng, c.lat, c.alt, undefined, target)
    }, false)
  }, [droneId, interpolator])

  const orientationProp = useMemo(() => {
    const pos = new Cartesian3()
    const hpr = new HeadingPitchRoll(0, 0, 0)
    const quat = new Quaternion()
    return new CallbackProperty((_time: unknown, result: unknown) => {
      const target = (result as Quaternion | undefined) ?? quat
      const c = interpolator.get(droneId)
      if (!c) {
        hpr.heading = 0
        hpr.pitch = 0
        hpr.roll = 0
        Cartesian3.fromDegrees(0, 0, 0, undefined, pos)
        return Transforms.headingPitchRollQuaternion(pos, hpr, undefined, undefined, target)
      }
      hpr.heading = CesiumMath.toRadians(c.heading)
      hpr.pitch = CesiumMath.toRadians(c.pitch)
      hpr.roll = CesiumMath.toRadians(c.roll)
      Cartesian3.fromDegrees(c.lng, c.lat, c.alt, undefined, pos)
      return Transforms.headingPitchRollQuaternion(pos, hpr, undefined, undefined, target)
    }, false)
  }, [droneId, interpolator])

  const droneColor = color
  const alertColor = alertLevel === 'critical' ? Color.RED : alertLevel === 'warning' ? Color.YELLOW : null

  const model = useMemo(() => ({
    uri: DRONE_MODEL_URI,
    scale: DRONE_SCALE,
    minimumPixelSize: DRONE_MIN_PX,
    maximumScale: DRONE_MAX_SCALE,
    silhouetteColor: new ConstantProperty(alertColor ?? (isSelected ? Color.WHITE : droneColor)),
    silhouetteSize: new ConstantProperty(alertColor ? 3.5 : isSelected ? 3 : 1.5),
    color: new ConstantProperty(Color.WHITE),
  }), [droneId, isSelected, droneColor, alertColor])

  const label = useMemo(() => ({
    text: new ConstantProperty(evading ? `${droneId.toUpperCase()} EVADING` : droneId.toUpperCase()),
    fillColor: new ConstantProperty(alertColor ?? (isSelected ? Color.WHITE : droneColor)),
    ...DRONE_LABEL_BASE,
  }), [droneId, isSelected, droneColor, alertColor, evading])

  return (
    <Entity
      position={positionProp as any}
      orientation={orientationProp as any}
      model={model}
      label={label}
      onClick={() => onSelectDrone(droneId)}
    />
  )
})

export default function CesiumScene({ fleet, droneIds, selectedId, onSelectDrone, onReturnDroneToBase, mission, waypointEditMode, waypointAltitude, onAddWaypoint, hiddenRouteId, mission, alerts = [] }: Props) {
  const viewerRef = useRef<CesiumViewer | null>(null)
  const [followMode, setFollowMode] = useState<FollowMode>('chase')
  const [weather, setWeather] = useState<WeatherMode>('clear')
  const [sceneMode, setSceneMode] = useState<SceneModeType>('3d')

  // Interpolator
  const interpolator = useRef(new DroneInterpolator()).current

  const cameraSmooth = useRef({ lng: 114.05, lat: 22.53, alt: 270, heading: 0 })
  const followModeRef = useRef<FollowMode>('chase')
  const sceneModeRef = useRef<SceneModeType>('3d')
  const selectedIdRef = useRef(selectedId)

  const routeData = useMemo(() => (mission?.drones ?? []).map((drone) => {
    const color = Color.fromCssColorString(drone.color) ?? DRONE_DEFAULT_COLOR
    const routeWaypoints = drone.route ?? []
    const displayWaypoints = routeWaypoints.length > 1 ? [...routeWaypoints, routeWaypoints[0]] : routeWaypoints
    return {
      ...drone,
      route: routeWaypoints,
      color,
      positions: Cartesian3.fromDegreesArrayHeights(
        [...(mission?.launchPoint && routeWaypoints.length > 0 ? [mission.launchPoint] : []), ...displayWaypoints]
          .flatMap(({ lng, lat, alt }) => [lng, lat, alt]),
      ),
      waypointPositions: drone.route.map(({ lng, lat, alt }) => Cartesian3.fromDegrees(lng, lat, alt)),
      material: color.withAlpha(0.7),
      waypointLabels: drone.route.map((_, index) => ({
        text: new ConstantProperty(`${drone.id.toUpperCase()} WP${index + 1}`),
        ...WP_LABEL_BASE,
      })),
    }
  }), [mission])

  const droneColors = useMemo(() => new Map(
    routeData.map((route) => [route.id, route.color]),
  ), [routeData])

  // Simulated proximity state per drone for highlighting.
  const alertLevelByDrone = useMemo(() => {
    const levels = new Map<string, 'warning' | 'critical'>()
    for (const alert of alerts) {
      for (const id of [alert.droneA, alert.droneB]) {
        const prev = levels.get(id)
        if (alert.severity === 'critical' || prev !== 'critical') {
          levels.set(id, alert.severity)
        }
      }
    }
    return levels
  }, [alerts])

  const evadingDrones = useMemo(() => {
    const set = new Set<string>()
    for (const id of droneIds) {
      if (fleet[id]?.avoidanceActive) set.add(id)
    }
    for (const alert of alerts) {
      if (alert.evading) {
        set.add(alert.droneA)
        set.add(alert.droneB)
      }
    }
    return set
  }, [alerts, fleet, droneIds])

  // Warning lines between conflicting pairs. Endpoint coordinates are
  // quantized to ~1m and cached, so the Cesium polyline is only rebuilt on
  // real movement â€” not on every 5Hz telemetry tick (which would remount
  // PolylineGraphics and its Cartesian3 arrays each time).
  const alertLineCache = useRef(new Map<string, { key: string; positions: Cartesian3[] }>())
  const alertLines = useMemo(() => {
    const cache = alertLineCache.current
    const quantizeDeg = (n: number) => Math.round(n * 1e5) / 1e5
    const quantizeAlt = (n: number) => Math.round(n)
    const seen = new Set<string>()
    const lines = alerts.flatMap((alert) => {
      const a = fleet[alert.droneA]
      const b = fleet[alert.droneB]
      if (!a || !b) return []
      const key = `${alert.severity}|${quantizeDeg(a.lng)}|${quantizeDeg(a.lat)}|${quantizeAlt(a.alt)}|` +
        `${quantizeDeg(b.lng)}|${quantizeDeg(b.lat)}|${quantizeAlt(b.alt)}`
      seen.add(alert.id)
      const hit = cache.get(alert.id)
      if (hit && hit.key === key) {
        return [{ id: alert.id, severity: alert.severity, positions: hit.positions }]
      }
      const positions = Cartesian3.fromDegreesArrayHeights([a.lng, a.lat, a.alt, b.lng, b.lat, b.alt])
      cache.set(alert.id, { key, positions })
      return [{ id: alert.id, severity: alert.severity, positions }]
    })
    for (const id of [...cache.keys()]) {
      if (!seen.has(id)) cache.delete(id)
    }
    return lines
  }, [alerts, fleet])

  followModeRef.current = followMode
  sceneModeRef.current = sceneMode
  selectedIdRef.current = selectedId

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !waypointEditMode) return
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid)
      if (!cartesian) return
      const point = Cartographic.fromCartesian(cartesian)
      onAddWaypoint({ lng: CesiumMath.toDegrees(point.longitude), lat: CesiumMath.toDegrees(point.latitude), alt: waypointAltitude })
    }, ScreenSpaceEventType.LEFT_CLICK)
    return () => handler.destroy()
  }, [waypointEditMode, waypointAltitude, onAddWaypoint])

  useEffect(() => {
    for (const id of droneIds) {
      const s = fleet[id]
      if (s) interpolator.setTarget(id, s)
    }
  }, [fleet, droneIds, interpolator])

  // ===== Main animation loop (interpolation keeps frame-rate precision, rendering capped at 30fps) =====
  useEffect(() => {
    let rafId: number
    let lastTime = performance.now()
    let lastRender = 0
    const camDest = new Cartesian3()
    const lastCam = { lng: NaN, lat: NaN, alt: NaN, heading: NaN, pitch: NaN }

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate)
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      // Smooth interpolation for every drone (plain JS, cheap, keeps full frame-rate accuracy)
      interpolator.tick(dt)

      // Camera follows the selected drone
      const viewer = viewerRef.current
      const selId = selectedIdRef.current
      const cur = selId ? interpolator.get(selId) : undefined
      let cameraChanged = false

      if (viewer && cur && followModeRef.current !== 'free') {
        const fm = followModeRef.current
        const sm = sceneModeRef.current
        const headingRad = CesiumMath.toRadians(cur.heading)
        const camT = 1 - Math.exp(-5 * dt)

        let tLng: number, tLat: number, tAlt: number
        if (fm === 'chase') {
          const offsetDist = sm === '2d' ? 0 : 0.003
          const offsetAlt = sm === '2d' ? 600 : 120
          tLng = cur.lng - Math.sin(headingRad) * offsetDist
          tLat = cur.lat - Math.cos(headingRad) * offsetDist
          tAlt = cur.alt + offsetAlt
        } else {
          tLng = cur.lng
          tLat = cur.lat
          tAlt = cur.alt + 800
        }

        const cam = cameraSmooth.current
        cam.lng += (tLng - cam.lng) * camT
        cam.lat += (tLat - cam.lat) * camT
        cam.alt += (tAlt - cam.alt) * camT
        cam.heading = lerpAngleRad(cam.heading, headingRad, camT)

        const pitchDeg = sm === '2d' ? -90 : (fm === 'chase' ? -25 : -80)
        // Skip setView when the position moved less than ~1cm or the attitude changed
        // by less than ~0.001 deg, avoiding pointless camera updates that would force
        // a full redraw and tile re-evaluation.
        if (
          Math.abs(cam.lng - lastCam.lng) > 1e-7 ||
          Math.abs(cam.lat - lastCam.lat) > 1e-7 ||
          Math.abs(cam.alt - lastCam.alt) > 0.01 ||
          Math.abs(cam.heading - lastCam.heading) > 1e-5 ||
          pitchDeg !== lastCam.pitch
        ) {
          Cartesian3.fromDegrees(cam.lng, cam.lat, cam.alt, undefined, camDest)
          viewer.camera.setView({
            destination: camDest,
            orientation: { heading: cam.heading, pitch: CesiumMath.toRadians(pitchDeg), roll: 0 },
          })
          lastCam.lng = cam.lng
          lastCam.lat = cam.lat
          lastCam.alt = cam.alt
          lastCam.heading = cam.heading
          lastCam.pitch = pitchDeg
          cameraChanged = true
        }
      }

      // Telemetry arrives at 5Hz while flight is continuous: 30fps is enough to smooth
      // a 15m/s target and halves the render work (CallbackProperty evaluation and tile/label drawing).
      if (viewer && (cameraChanged || now - lastRender >= 33)) {
        viewer.scene.requestRender()
        lastRender = now
      }
    }

    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [interpolator])

  // ===== 2D/3D =====
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const target = sceneMode === '3d' ? SceneMode.SCENE3D : SceneMode.SCENE2D
    if (v.scene.mode !== target) {
      v.scene.mode = target
      v.scene.requestRender()
    }
  }, [sceneMode])

  // ===== Weather =====
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const scene = v.scene
    const bl = v.imageryLayers.length > 0 ? v.imageryLayers.get(0) : null
    const skyAtmosphere = scene.skyAtmosphere

    if (weather === 'clear') {
      scene.fog.enabled = false
      if (skyAtmosphere) {
        skyAtmosphere.hueShift = 0
        skyAtmosphere.saturationShift = 0
        skyAtmosphere.brightnessShift = 0
      }
      scene.globe.atmosphereLightIntensity = 10
      if (bl) { bl.brightness = 1; bl.contrast = 1; bl.saturation = 1 }
    } else if (weather === 'foggy') {
      scene.fog.enabled = true; scene.fog.density = 0.0008; scene.fog.minimumBrightness = 0.6
      if (skyAtmosphere) {
        skyAtmosphere.hueShift = -0.02
        skyAtmosphere.saturationShift = -0.8
        skyAtmosphere.brightnessShift = -0.3
      }
      scene.globe.atmosphereLightIntensity = 3
      if (bl) { bl.brightness = 1.3; bl.contrast = 0.7; bl.saturation = 0.3 }
    } else {
      scene.fog.enabled = true; scene.fog.density = 0.0003; scene.fog.minimumBrightness = 0.2
      if (skyAtmosphere) {
        skyAtmosphere.hueShift = -0.04
        skyAtmosphere.saturationShift = -0.6
        skyAtmosphere.brightnessShift = -0.25
      }
      scene.globe.atmosphereLightIntensity = 4
      if (bl) { bl.brightness = 0.85; bl.contrast = 0.9; bl.saturation = 0.5 }
    }
    scene.requestRender()
  }, [weather])

  // ===== Initialization =====
  const handleViewerReady = useCallback((viewer: CesiumViewer) => {
    viewerRef.current = viewer
    const scene = viewer.scene
    const globe = scene.globe

    viewer.imageryLayers.removeAll()
    globe.enableLighting = true
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true
    globe.showGroundAtmosphere = true
    scene.highDynamicRange = true
    globe.atmosphereLightIntensity = 10

    scene.requestRenderMode = true
    scene.maximumRenderTimeChange = 0.0
    globe.tileCacheSize = 1000
    globe.maximumScreenSpaceError = 1.5
    globe.preloadSiblings = true
    globe.depthTestAgainstTerrain = false

    if (scene.postProcessStages) scene.postProcessStages.fxaa.enabled = true

    viewer.clock.currentTime = JulianDate.fromIso8601('2026-03-15T02:00:00Z')
    viewer.clock.shouldAnimate = false

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(114.0, 22.54, 8000),
      orientation: { heading: CesiumMath.toRadians(0), pitch: CesiumMath.toRadians(-45), roll: 0 },
      duration: 2,
    })
  }, [])

  const btnStyle = useCallback((active: boolean, activeColor: string) => ({
    padding: '8px 16px',
    fontSize: 14,
    fontWeight: (active ? 'bold' : 'normal') as 'bold' | 'normal',
    fontFamily: 'monospace',
    background: active ? `rgba(${activeColor},0.3)` : 'rgba(0,0,0,0.7)',
    color: active ? `rgb(${activeColor})` : '#aaa',
    border: active ? `2px solid rgb(${activeColor})` : '1px solid #555',
    borderRadius: 6,
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
    transition: 'all 0.2s',
  }), [])

  return (
    <>
      <div style={WEATHER_OVERLAY[weather]} />

      {/* Right-hand control panel */}
      <div className="scene-controls">
        <div className="scene-controls__mode" style={{ display: 'flex', gap: 6 }}>
          {(['3d', '2d'] as SceneModeType[]).map((m) => (
            <button key={m} onClick={() => setSceneMode(m)} style={{
              flex: 1, padding: '8px 0', fontSize: 15, fontFamily: 'monospace',
              fontWeight: sceneMode === m ? 'bold' : 'normal',
              background: sceneMode === m ? 'rgba(0,200,255,0.35)' : 'rgba(0,0,0,0.7)',
              color: sceneMode === m ? '#0cf' : '#777',
              border: sceneMode === m ? '2px solid #0cf' : '1px solid #555',
              borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {m === '3d' ? '🌐 3D' : '🗺️ 2D'}
            </button>
          ))}
        </div>

        <div className="scene-controls__separator" style={{ height: 1, background: '#555', margin: '2px 0' }} />

        {/* Drone selection */}
        <div className="scene-controls__label" style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', textAlign: 'center' }}>Drone selection</div>
        {droneIds.map((id) => {
          const c = droneColors.get(id) ?? DRONE_DEFAULT_COLOR
          const isActive = id === selectedId
          return (
            <div className="scene-controls__drone-row" key={id}>
              <button
                type="button"
                className="scene-controls__drone"
                onClick={() => onSelectDrone(id)}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: isActive ? 'bold' : 'normal',
                  fontFamily: 'monospace',
                  background: isActive ? `rgba(${c.red * 255},${c.green * 255},${c.blue * 255},0.25)` : 'rgba(0,0,0,0.7)',
                  color: isActive ? `rgb(${c.red * 255},${c.green * 255},${c.blue * 255})` : '#888',
                  border: isActive ? `2px solid rgb(${c.red * 255},${c.green * 255},${c.blue * 255})` : '1px solid #555',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: `rgb(${c.red * 255},${c.green * 255},${c.blue * 255})`,
                  boxShadow: isActive ? `0 0 6px rgb(${c.red * 255},${c.green * 255},${c.blue * 255})` : 'none',
                }} />
                {id.toUpperCase()}
              </button>
              <button
                type="button"
                className="scene-controls__drone-return"
                title={`Return ${id.toUpperCase()} to base`}
                aria-label={`Return ${id.toUpperCase()} to base`}
                disabled={!fleet[id] || fleet[id].status === 'staged' || fleet[id].status === 'returning-to-base'}
                onClick={() => onReturnDroneToBase(id)}
              >
                To base
              </button>
            </div>
          )
        })}

        <div className="scene-controls__separator" style={{ height: 1, background: '#555', margin: '2px 0' }} />

        {/* Viewpoint */}
        {([
          ['chase', '🎯 Chase view'],
          ['top', '🛰️ Top-down view'],
          ['free', '🖱️ Free view'],
        ] as [FollowMode, string][]).map(([m, l]) => (
          <button className="scene-controls__action" key={m} onClick={() => setFollowMode(m)} style={btnStyle(followMode === m, '0,255,255')}>
            {l}
          </button>
        ))}

        <div className="scene-controls__separator" style={{ height: 1, background: '#555', margin: '2px 0' }} />

        {/* Weather */}
        {([
          ['clear', '☀️ Clear'],
          ['foggy', '🌫️ Foggy'],
          ['overcast', '☁️ Overcast'],
        ] as [WeatherMode, string][]).map(([m, l]) => (
          <button className="scene-controls__action" key={m} onClick={() => setWeather(m)} style={btnStyle(weather === m, '255,200,0')}>
            {l}
          </button>
        ))}
      </div>

      <Viewer
        full
        timeline={false}
        animation={false}
        homeButton={false}
        geocoder={false}
        baseLayerPicker={false}
        baseLayer={false}
        navigationHelpButton={false}
        sceneModePicker={false}
        terrainProvider={flatTerrain}
        style={waypointEditMode ? { cursor: 'crosshair' } : undefined}
        ref={(e) => {
          if (e?.cesiumElement && !viewerRef.current) handleViewerReady(e.cesiumElement)
        }}
      >
        <ImageryLayer imageryProvider={gaodeSatellite} />

        {/* Landmarks */}
        {landmarkEntities.map((lm, i) => (
          <Entity key={`lm-${i}`} position={lm.position} label={lm.label} />
        ))}

        {/* All routes */}
        {mission?.launchPoint && (
          <Entity
            key="uav-launch-base"
            position={Cartesian3.fromDegrees(mission.launchPoint.lng, mission.launchPoint.lat, mission.launchPoint.alt)}
            point={{ pixelSize: 12, color: Color.CYAN, outlineColor: Color.WHITE, outlineWidth: 2 }}
            label={{
              text: new ConstantProperty('UAV Launch Base'),
              font: new ConstantProperty('bold 13px "Microsoft YaHei", sans-serif'),
              fillColor: new ConstantProperty(Color.CYAN),
              outlineColor: new ConstantProperty(Color.BLACK),
              outlineWidth: new ConstantProperty(3),
              disableDepthTestDistance: new ConstantProperty(Number.POSITIVE_INFINITY),
            }}
          />
        )}

        {/* 所有航线 */}
        {routeData.map((rd) => (
          rd.route.length > 0 && rd.id !== hiddenRouteId && <Entity key={`route-${rd.id}`}>
            <PolylineGraphics positions={rd.positions} width={3} material={rd.material} clampToGround={false} />
          </Entity>
        ))}

        {/* Route waypoints */}
        {routeData.map((rd) =>
          (rd.id === hiddenRouteId ? [] : rd.route).map((_, wi) => (
            <Entity
              key={`wp-${rd.id}-${wi}`}
              position={rd.waypointPositions[wi]}
              point={WP_POINT}
              label={rd.waypointLabels[wi]}
            />
          ))
        )}

        {droneIds.map((id) => (
          <DroneEntity
            key={id}
            droneId={id}
            interpolator={interpolator}
            isSelected={id === selectedId}
            onSelectDrone={onSelectDrone}
            color={droneColors.get(id) ?? DRONE_DEFAULT_COLOR}
            alertLevel={alertLevelByDrone.get(id) ?? 'none'}
            evading={evadingDrones.has(id)}
          />
        ))}

        {/* Simulated collision warning lines */}
        {alertLines.map((line) => (
          <Entity key={`alert-${line.id}`}>
            <PolylineGraphics
              positions={line.positions}
              width={line.severity === 'critical' ? 4 : 2}
              material={line.severity === 'critical' ? Color.RED.withAlpha(0.9) : Color.YELLOW.withAlpha(0.8)}
              clampToGround={false}
            />
          </Entity>
        ))}
      </Viewer>
    </>
  )
}
