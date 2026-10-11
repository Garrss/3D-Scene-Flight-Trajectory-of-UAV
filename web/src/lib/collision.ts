import type { CollisionAlert, DroneState } from '../types/drone'

export interface CollisionThresholds {
  warnM: number
  criticalM: number
  /** Look-ahead window (seconds) for closest-approach prediction. */
  horizonS: number
}

export const DEFAULT_THRESHOLDS: CollisionThresholds = {
  warnM: 100,
  criticalM: 50,
  horizonS: 15,
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function distance3DM(a: Pick<DroneState, 'lng' | 'lat' | 'alt'>, b: Pick<DroneState, 'lng' | 'lat' | 'alt'>): number {
  const h = haversineM(a.lat, a.lng, b.lat, b.lng)
  const v = a.alt - b.alt
  return Math.sqrt(h * h + v * v)
}

/** Linearly extrapolate both drones and return the minimum predicted 3D distance. */
export function predictClosestApproachM(
  a: Pick<DroneState, 'lng' | 'lat' | 'alt' | 'heading' | 'speed'>,
  b: Pick<DroneState, 'lng' | 'lat' | 'alt' | 'heading' | 'speed'>,
  horizonS: number,
): number {
  const best = distance3DM(a, b)
  if (!(horizonS > 0)) return best
  const steps = 15
  const lat0 = (((a.lat + b.lat) / 2) * Math.PI) / 180
  const mPerDegLat = 111194.9
  const mPerDegLng = 111194.9 * Math.cos(lat0)
  const ax = a.lng * mPerDegLng
  const ay = a.lat * mPerDegLat
  const bx = b.lng * mPerDegLng
  const by = b.lat * mPerDegLat
  const ah = (a.heading * Math.PI) / 180
  const bh = (b.heading * Math.PI) / 180
  const avx = Math.sin(ah) * a.speed
  const avy = Math.cos(ah) * a.speed
  const bvx = Math.sin(bh) * b.speed
  const bvy = Math.cos(bh) * b.speed
  const v = a.alt - b.alt
  let min = best
  for (let i = 1; i <= steps; i++) {
    const t = (horizonS * i) / steps
    const dx = ax + avx * t - (bx + bvx * t)
    const dy = ay + avy * t - (by + bvy * t)
    const d = Math.sqrt(dx * dx + dy * dy + v * v)
    if (d < min) min = d
  }
  return min
}

function pairId(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`
}

/**
 * Client-side proximity detection over the current fleet snapshot.
 * Mirrors the Go detector so Cesium can draw warnings between 5 Hz ticks.
 * Simulation/visualization only — never a flight-safety signal.
 */
export function detectCollisions(
  fleet: Record<string, Pick<DroneState, 'droneId' | 'lng' | 'lat' | 'alt' | 'heading' | 'speed' | 'avoidanceActive' | 'status'>>,
  thresholds: CollisionThresholds = DEFAULT_THRESHOLDS,
  nowSec = Math.floor(Date.now() / 1000),
): CollisionAlert[] {
  const ids = Object.keys(fleet)
  const alerts: CollisionAlert[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = fleet[ids[i]]
      const b = fleet[ids[j]]
      if (a.status === 'staged' || b.status === 'staged') continue
      const dist = distance3DM(a, b)
      const predicted = predictClosestApproachM(a, b, thresholds.horizonS)
      let severity: CollisionAlert['severity'] | null = null
      if (dist <= thresholds.criticalM) severity = 'critical'
      else if (dist <= thresholds.warnM) severity = 'warning'
      else if (predicted <= thresholds.warnM) severity = 'warning'
      if (!severity) continue
      alerts.push({
        id: pairId(a.droneId, b.droneId),
        droneA: a.droneId < b.droneId ? a.droneId : b.droneId,
        droneB: a.droneId < b.droneId ? b.droneId : a.droneId,
        distanceM: Math.round(dist * 10) / 10,
        severity,
        predictedMinM: Math.round(predicted * 10) / 10,
        evading: Boolean(a.avoidanceActive || b.avoidanceActive),
        timestamp: nowSec,
      })
    }
  }
  alerts.sort((x, y) => x.distanceM - y.distanceM)
  return alerts
}
