import { useMemo } from 'react'
import type { CollisionAlert, DroneState } from '../types/drone'

interface Props {
  droneState: DroneState | null
  connected: boolean
  droneIds: string[]
  selectedId: string
  onSelectDrone: (id: string) => void
  missionName?: string
  missionError?: string | null
  alerts?: CollisionAlert[]
}

export default function HUD({
  droneState,
  connected,
  droneIds,
  selectedId,
  onSelectDrone,
  missionName,
  missionError,
  alerts = [],
}: Props) {
  const critical = useMemo(() => alerts.filter((a) => a.severity === 'critical').length, [alerts])
  return (
    <div
      className="hud-panel"
      style={{
        background: 'rgba(0,0,0,0.80)',
        color: '#0f0',
        padding: '16px 20px',
        borderRadius: 8,
        fontFamily: '"Consolas", "Courier New", monospace',
        fontSize: 14,
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(0,255,0,0.3)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 'bold',
          marginBottom: 12,
          borderBottom: '1px solid rgba(0,255,0,0.2)',
          paddingBottom: 8,
          color: '#0ff',
        }}
      >
        {missionName ?? 'UAV Cruise System'}
      </div>

      {missionError && (
        <div style={{ color: '#ff6b6b', marginBottom: 8 }}>Failed to load mission config: {missionError}</div>
      )}

      <div style={{ marginBottom: 8 }}>
        Connection:{connected ? ' 🟢 Online' : ' 🔴 Offline'}
        <span style={{ marginLeft: 12, color: '#888', fontSize: 12 }}>
          Online: {droneIds.length}
        </span>
        <span style={{ marginLeft: 12, fontSize: 12, color: critical > 0 ? '#ff6b6b' : alerts.length > 0 ? '#ffd75e' : '#888' }}>
          {alerts.length > 0 ? `⚠ Close pairs ${alerts.length}${critical > 0 ? ` (critical ${critical})` : ''} · simulated` : 'Spacing normal · simulated'}
        </span>
      </div>

      {/* Drone quick switch */}
      {droneIds.length > 1 && (
        <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {droneIds.map((id) => (
            <button
              key={id}
              onClick={() => onSelectDrone(id)}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                fontFamily: 'monospace',
                background: id === selectedId ? 'rgba(0,255,255,0.25)' : 'rgba(255,255,255,0.08)',
                color: id === selectedId ? '#0ff' : '#888',
                border: id === selectedId ? '1px solid #0ff' : '1px solid #444',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {id.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {droneState ? (
        <div style={{ lineHeight: '1.8' }}>
          <div>📌 ID : {droneState.droneId}</div>
          <div>📍 Longitude: {droneState.lng.toFixed(6)}°</div>
          <div>📍 Latitude: {droneState.lat.toFixed(6)}°</div>
          <div>📏 Altitude: {droneState.alt.toFixed(1)} m</div>
          <div>🧭 Heading: {droneState.heading.toFixed(1)}°</div>
          <div>📐 Pitch: {droneState.pitch.toFixed(2)}°</div>
          <div>↩️ Roll: {droneState.roll.toFixed(2)}°</div>
          <div>💨 Speed: {droneState.speed} m/s</div>
          {droneState.avoidanceActive && (
            <div style={{ color: '#0ff' }}>🛡️ Simulated avoidance: temporary vertical split, returning to route altitude</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            🔋 Battery: {droneState.battery}%
            <span
              style={{
                display: 'inline-block',
                width: 70,
                height: 12,
                background: '#333',
                borderRadius: 4,
                overflow: 'hidden',
                border: '1px solid #555',
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: `${droneState.battery}%`,
                  height: '100%',
                  background:
                    droneState.battery > 50
                      ? '#0f0'
                      : droneState.battery > 20
                      ? '#ff0'
                      : '#f00',
                  transition: 'width 0.3s',
                }}
              />
            </span>
          </div>
        </div>
      ) : (
        <div style={{ color: '#888' }}>Waiting for telemetry…</div>
      )}
    </div>
  )
}
