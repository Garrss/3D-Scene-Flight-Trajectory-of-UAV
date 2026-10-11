import { useEffect, useState } from 'react'
import { apiUrl } from '../config/runtime'
import type { Mission, Waypoint } from '../types/drone'

export function useMission() {
  const [mission, setMission] = useState<Mission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const saveDroneRoute = async (droneId: string, route: Waypoint[]) => {
    const response = await fetch(apiUrl(`/api/drones/${encodeURIComponent(droneId)}/route`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route }),
    })
    if (!response.ok) throw new Error(await response.text())
    const updated = await response.json() as { id: string; route: Waypoint[] }
    setMission((current) => current ? { ...current, drones: current.drones.map((drone) => drone.id === updated.id ? { ...drone, route: updated.route } : drone) } : current)
  }

  useEffect(() => {
    const controller = new AbortController()

    async function loadMission() {
      try {
        const response = await fetch(apiUrl('/api/config'), { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setMission(await response.json() as Mission)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setError(cause instanceof Error ? cause.message : 'Unknown error')
      }
    }

    void loadMission()
    return () => controller.abort()
  }, [])

  return { mission, error, saveDroneRoute }
}
