import { useMemo, useRef } from 'react'
import { DEFAULT_THRESHOLDS, detectCollisions, type CollisionThresholds } from '../lib/collision'
import type { CollisionAlert, DroneFleet } from '../types/drone'

function sameAlerts(a: CollisionAlert[], b: CollisionAlert[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id || x.droneA !== y.droneA || x.droneB !== y.droneB ||
      x.distanceM !== y.distanceM || x.severity !== y.severity ||
      x.predictedMinM !== y.predictedMinM || x.evading !== y.evading ||
      x.timestamp !== y.timestamp
    ) {
      return false
    }
  }
  return true
}

/**
 * Client-side proximity alerts recomputed from the latest fleet snapshot.
 * Keeps Cesium warnings responsive between 5 Hz backend ticks.
 * Returns a stable array identity when alert content is unchanged, so
 * downstream useMemo caches (e.g. Cesium polylines) survive idle ticks.
 * Simulation/visualization only — never a flight-safety signal.
 */
export function useCollisionAlerts(
  fleet: DroneFleet,
  backendAlerts: CollisionAlert[] = [],
  thresholds: CollisionThresholds = DEFAULT_THRESHOLDS,
): CollisionAlert[] {
  const local = useMemo(() => detectCollisions(fleet, thresholds), [fleet, thresholds])
  const merged = useMemo(() => {
    if (backendAlerts.length === 0) return local
    const byId = new Map<string, CollisionAlert>()
    for (const alert of local) byId.set(alert.id, alert)
    // Backend is authoritative for evasion state; prefer its severity/distance.
    for (const alert of backendAlerts) byId.set(alert.id, alert)
    return [...byId.values()].sort((a, b) => a.distanceM - b.distanceM)
  }, [local, backendAlerts])
  const prev = useRef<CollisionAlert[]>([])
  if (!sameAlerts(prev.current, merged)) prev.current = merged
  return prev.current
}
