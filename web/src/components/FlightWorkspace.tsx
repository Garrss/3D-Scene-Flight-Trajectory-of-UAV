import { useCallback, useEffect, useRef, useState } from 'react'
import CesiumScene from './CesiumViewer'
import HUD from './HUD'
import { useDroneWS } from '../hooks/useDroneWS'
import { useMission } from '../hooks/useMission'

export default function FlightWorkspace() {
  const { fleet, droneIds, connected, sendControl } = useDroneWS()
  const { mission, error: missionError } = useMission()
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    if (!selectedId && droneIds.length > 0) setSelectedId(droneIds[0])
  }, [droneIds, selectedId])

  const selectedDrone = selectedId ? fleet[selectedId] ?? null : null
  const heldKeys = useRef(new Set<string>())
  const [manual, setManual] = useState(false)

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

  return (
    <section className="project-workspace flight-workspace" aria-label="无人机飞行轨迹项目">
      <CesiumScene
        fleet={fleet}
        droneIds={droneIds}
        selectedId={selectedId}
        onSelectDrone={setSelectedId}
        mission={mission}
      />
      <div className="flight-mode-control">
        <button onClick={toggleManual} disabled={!connected || !selectedId}>
          {manual ? 'Return to route' : 'Manual control'}
        </button>
        <span>{manual ? 'Manual · arrows to fly' : selectedDrone?.mode === 'returning' ? 'Returning to route' : 'Auto route'}</span>
      </div>
      <HUD
        droneState={selectedDrone}
        connected={connected}
        droneIds={droneIds}
        selectedId={selectedId}
        onSelectDrone={setSelectedId}
        missionName={mission?.name}
        missionError={missionError}
      />
    </section>
  )
}
