export interface DroneState {
  droneId: string
  lng: number
  lat: number
  alt: number
  heading: number
  pitch: number
  roll: number
  speed: number
  battery: number
  timestamp: number
  status?: string
  waypointIndex?: number
  /** Simulated demo avoidance flag (visualization only, not flight safety). */
  avoidanceActive?: boolean
}

export type DroneFleet = Record<string, DroneState>

export type AlertSeverity = 'warning' | 'critical'

export interface CollisionAlert {
  id: string
  droneA: string
  droneB: string
  distanceM: number
  severity: AlertSeverity
  predictedMinM: number
  evading: boolean
  timestamp: number
}

export interface TelemetryEnvelope {
  v: number
  drones: DroneState[]
  alerts: CollisionAlert[]
}

export interface Waypoint {
  lng: number
  lat: number
  alt: number
}

export interface DroneConfig {
  id: string
  name: string
  color: string
  speed: number
  route: Waypoint[]
}

export interface Mission {
  name: string
  drones: DroneConfig[]
}
