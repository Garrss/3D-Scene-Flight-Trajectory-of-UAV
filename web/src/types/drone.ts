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
  mode?: 'auto' | 'manual' | 'returning'
  waypointIndex?: number
}

export type DroneFleet = Record<string, DroneState>

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
  launchPoint?: Waypoint
  drones: DroneConfig[]
}
