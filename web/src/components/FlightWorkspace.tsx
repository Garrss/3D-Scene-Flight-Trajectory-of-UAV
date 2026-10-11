import { useCallback, useEffect, useRef, useState } from 'react'
import CesiumScene from './CesiumViewer'
import HUD from './HUD'
import CollisionPanel from './CollisionPanel'
import { useDroneWS } from '../hooks/useDroneWS'
import { useCollisionAlerts } from '../hooks/useCollisionAlerts'
import { useMission } from '../hooks/useMission'
import type { Waypoint } from '../types/drone'

export default function FlightWorkspace() {
  const { fleet, droneIds, connected, backendAlerts, sendControl } = useDroneWS()
  const alerts = useCollisionAlerts(fleet, backendAlerts)
  const { mission, error: missionError, saveDroneRoute } = useMission()
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    if (!selectedId && droneIds.length > 0) setSelectedId(droneIds[0])
  }, [droneIds, selectedId])

  const selectedDrone = selectedId ? fleet[selectedId] ?? null : null
  const stagedCount = droneIds.filter((id) => fleet[id]?.status === 'staged').length
  const heldKeys = useRef(new Set<string>())
  const [manual, setManual] = useState(false)
  const [editingRoute, setEditingRoute] = useState(false)
  const [routeDraft, setRouteDraft] = useState<Waypoint[]>([])
  const [waypointAltitude, setWaypointAltitude] = useState(100)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [savingRoute, setSavingRoute] = useState(false)
  const selectedRoute = mission?.drones.find((drone) => drone.id === selectedId)?.route ?? []
  const previewRoute = editingRoute && routeDraft.length > 0 ? routeDraft : null
  const displayMission = previewRoute && mission ? { ...mission, drones: mission.drones.map((drone) => drone.id === selectedId ? { ...drone, route: previewRoute } : drone) } : mission
  const routeValidation = routeDraft.length === 1 ? 'Monitoring loop needs at least two waypoints. Add another waypoint.' : routeDraft.length === 0 ? 'Add at least two waypoints to create a monitoring loop.' : routeDraft.every((point) => point.lng === routeDraft[0].lng && point.lat === routeDraft[0].lat) ? 'Waypoints must include at least two different locations.' : null
  const addWaypoint = useCallback((waypoint: Waypoint) => setRouteDraft((route) => [...route, waypoint]), [])

  const beginRouteEdit = () => {
    setRouteDraft(selectedRoute.map((waypoint) => ({ ...waypoint })))
    setRouteError(null)
    setEditingRoute(true)
  }
  const saveRoute = async () => {
    if (!selectedId || routeValidation) return
    setSavingRoute(true); setRouteError(null)
    try { await saveDroneRoute(selectedId, routeDraft); setEditingRoute(false) }
    catch (cause) { setRouteError(cause instanceof Error ? cause.message : 'Could not save route') }
    finally { setSavingRoute(false) }
  }

  const sendKeys = useCallback(() => {
    if (selectedId) sendControl({ type: 'manual', droneId: selectedId, keys: [...heldKeys.current] })
  }, [selectedId, sendControl])

  useEffect(() => {
    heldKeys.current.clear()
    setManual(selectedDrone?.mode === 'manual')
  }, [selectedId])

  useEffect(() => {
    if (!manual) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      if (!heldKeys.current.has(event.key)) { heldKeys.current.add(event.key); sendKeys() }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!heldKeys.current.delete(event.key)) return
      sendKeys()
    }
    const onBlur = () => { heldKeys.current.clear(); sendKeys() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [manual, sendKeys])

  const toggleManual = () => {
    if (!selectedId) return
    if (manual) {
      heldKeys.current.clear()
      setManual(false)
      sendControl({ type: 'return', droneId: selectedId })
    } else {
      setManual(true)
      sendControl({ type: 'manual', droneId: selectedId, keys: [] })
    }
  }

  const returnFleetToBase = () => {
    heldKeys.current.clear()
    setManual(false)
    sendControl({ type: 'return-all-to-base' })
  }

  const returnDroneToBase = (droneId: string) => {
    if (droneId === selectedId) {
      heldKeys.current.clear()
      setManual(false)
    }
    sendControl({ type: 'return-to-base', droneId })
  }

  return (
    <section className="project-workspace flight-workspace" aria-label="UAV flight trajectory project">
      <CesiumScene
        fleet={fleet}
        droneIds={droneIds}
        selectedId={selectedId}
        onSelectDrone={setSelectedId}
        mission={mission}
        alerts={alerts}
        onReturnDroneToBase={returnDroneToBase}
        mission={displayMission}
        waypointEditMode={editingRoute}
        waypointAltitude={waypointAltitude}
        onAddWaypoint={addWaypoint}
        hiddenRouteId={editingRoute && routeDraft.length === 0 ? selectedId : undefined}
      />
      {editingRoute && <aside className="waypoint-editor" aria-label="Monitoring waypoints">
        <>
          <header><strong>Monitoring loop · {selectedId}</strong><button onClick={() => setEditingRoute(false)}>Close</button></header>
          <p>Click the map to add a waypoint. The route loops from the last point to the first.</p>
          <label>New waypoint altitude (m) <input type="number" min="0" value={waypointAltitude} onChange={(event) => setWaypointAltitude(Number(event.target.value))} /></label>
          <ol>{routeDraft.map((waypoint, index) => <li key={index}>
            <span>WP {index + 1} · {waypoint.lat.toFixed(5)}, {waypoint.lng.toFixed(5)}</span>
            <label>Altitude <input type="number" min="0" value={waypoint.alt} onChange={(event) => setRouteDraft((route) => route.map((point, i) => i === index ? { ...point, alt: Number(event.target.value) } : point))} /></label>
            <button onClick={() => setRouteDraft((route) => route.filter((_, i) => i !== index))}>Remove</button>
          </li>)}</ol>
          {routeValidation && <p className="waypoint-editor__error" role="alert">{routeValidation}</p>}
          {routeError && <p className="waypoint-editor__error" role="alert">{routeError}</p>}
          <footer><button onClick={() => setRouteDraft([])}>Clear route</button><button onClick={() => void saveRoute()} disabled={!!routeValidation || savingRoute}>{savingRoute ? 'Saving…' : 'Save route'}</button></footer>
        </>
      </aside>}
      <div className="flight-mode-control">
        {!editingRoute && <button onClick={beginRouteEdit} disabled={!selectedId || !mission}>Edit monitoring waypoints</button>}
        {editingRoute && <button onClick={() => setEditingRoute(false)}>Close waypoint editor</button>}
        {selectedDrone?.status === 'staged' ? (
          <button onClick={() => sendControl({ type: 'launch', droneId: selectedId })} disabled={!connected}>
            Dispatch selected
          </button>
        ) : selectedDrone ? (
          <button onClick={toggleManual} disabled={!connected || selectedDrone.status === 'launching'}>
            {manual ? 'Return to route' : 'Manual control'}
          </button>
        ) : null}
        {stagedCount > 0 && (
          <button onClick={() => sendControl({ type: 'launch-all' })} disabled={!connected}>
            Launch all ({stagedCount})
          </button>
        )}
        <button
          onClick={returnFleetToBase}
          disabled={!connected || droneIds.every((id) => !fleet[id] || fleet[id].status === 'staged')}
        >
          Return all to base
        </button>
        <span>
          {manual ? 'Manual · arrows to fly' : selectedDrone?.status === 'staged' ? 'At UAV launch base' : selectedDrone?.status === 'launching' ? 'Flying to assigned route' : selectedDrone?.status === 'returning-to-base' ? 'Returning to base' : selectedDrone?.mode === 'returning' ? 'Returning to route' : 'Auto route'}
        </span>
      </div>
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
