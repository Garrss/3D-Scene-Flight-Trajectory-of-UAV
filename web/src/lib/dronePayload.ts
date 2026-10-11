import type { CollisionAlert, DroneFleet, DroneState, TelemetryEnvelope } from '../types/drone'

const telemetryFields = [
  'lng',
  'lat',
  'alt',
  'heading',
  'pitch',
  'roll',
  'speed',
  'battery',
  'timestamp',
] as const

export function parseDronePayload(payload: string): { fleet: DroneFleet; ids: string[]; alerts: CollisionAlert[] } {
  const raw: unknown = JSON.parse(payload)
  // Versioned envelope: { v, drones, alerts } (preferred).
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'drones' in raw) {
    return parseEnvelope(raw as Partial<TelemetryEnvelope>)
  }
  const values = Array.isArray(raw) ? raw : [raw]
  const fleet: DroneFleet = {}
  const ids: string[] = []

  for (const value of values) {
    if (!isDroneState(value)) throw new Error('WebSocket payload contains invalid telemetry')
    if (fleet[value.droneId]) throw new Error(`WebSocket payload contains duplicate ID: ${value.droneId}`)
    fleet[value.droneId] = value
    ids.push(value.droneId)
  }

  return { fleet, ids, alerts: [] }
}

function parseEnvelope(raw: Partial<TelemetryEnvelope>): { fleet: DroneFleet; ids: string[]; alerts: CollisionAlert[] } {
  if (!Array.isArray(raw.drones)) throw new Error('WebSocket payload contains invalid telemetry')
  const fleet: DroneFleet = {}
  const ids: string[] = []
  for (const value of raw.drones) {
    if (!isDroneState(value)) throw new Error('WebSocket payload contains invalid telemetry')
    if (fleet[value.droneId]) throw new Error(`WebSocket payload contains duplicate ID: ${value.droneId}`)
    fleet[value.droneId] = value
    ids.push(value.droneId)
  }
  const alerts = Array.isArray(raw.alerts) ? raw.alerts.filter(isCollisionAlert) : []
  return { fleet, ids, alerts }
}

function isCollisionAlert(value: unknown): value is CollisionAlert {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.droneA === 'string' &&
    typeof candidate.droneB === 'string' &&
    typeof candidate.distanceM === 'number' &&
    (candidate.severity === 'warning' || candidate.severity === 'critical')
  )
}

function isDroneState(value: unknown): value is DroneState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.droneId !== 'string' || candidate.droneId.length === 0) return false
  return telemetryFields.every((field) => typeof candidate[field] === 'number' && Number.isFinite(candidate[field]))
}
