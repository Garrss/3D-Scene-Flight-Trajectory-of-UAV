import { useEffect, useState } from 'react'
import CesiumScene from './CesiumViewer'
import HUD from './HUD'
import CollisionPanel from './CollisionPanel'
import { useDroneWS } from '../hooks/useDroneWS'
import { useCollisionAlerts } from '../hooks/useCollisionAlerts'
import { useMission } from '../hooks/useMission'

export default function FlightWorkspace() {
  const { fleet, droneIds, connected, backendAlerts } = useDroneWS()
  const alerts = useCollisionAlerts(fleet, backendAlerts)
  const { mission, error: missionError } = useMission()
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    if (!selectedId && droneIds.length > 0) setSelectedId(droneIds[0])
  }, [droneIds, selectedId])

  const selectedDrone = selectedId ? fleet[selectedId] ?? null : null

  return (
    <section className="project-workspace flight-workspace" aria-label="UAV flight trajectory project">
      <CesiumScene
        fleet={fleet}
        droneIds={droneIds}
        selectedId={selectedId}
        onSelectDrone={setSelectedId}
        mission={mission}
        alerts={alerts}
      />
      <HUD
        droneState={selectedDrone}
        connected={connected}
        droneIds={droneIds}
        selectedId={selectedId}
        onSelectDrone={setSelectedId}
        missionName={mission?.name}
        missionError={missionError}
        alerts={alerts}
      />
      <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 10 }}>
        <CollisionPanel alerts={alerts} />
      </div>
    </section>
  )
}
