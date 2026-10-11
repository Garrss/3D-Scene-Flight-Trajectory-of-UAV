import { memo, useMemo } from 'react'
import type { CollisionAlert } from '../types/drone'

interface Props {
  alerts: CollisionAlert[]
}

// Memoized: parent re-renders at 5Hz on telemetry, but alerts identity is
// stabilized upstream, so this panel only re-renders on real alert changes.
export default memo(function CollisionPanel({ alerts }: Props) {
  const critical = useMemo(() => alerts.filter((a) => a.severity === 'critical'), [alerts])
  const visible = useMemo(() => alerts.slice(0, 5), [alerts])
  const border = critical.length > 0 ? 'rgba(255,60,60,0.6)' : 'rgba(255,200,0,0.35)'
  const title = critical.length > 0 ? '🔴 Collision risk (simulated)' : '🟡 Proximity warning (simulated)'

  return (
    <div
      className="collision-panel"
      aria-live="polite"
      style={{
        background: 'rgba(0,0,0,0.80)',
        color: '#ffd75e',
        padding: '12px 16px',
        borderRadius: 8,
        fontFamily: '"Consolas", "Courier New", monospace',
        fontSize: 13,
        backdropFilter: 'blur(8px)',
        border: `1px solid ${border}`,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        maxWidth: 340,
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 8, color: critical.length > 0 ? '#ff6b6b' : '#ffd75e' }}>
        {alerts.length > 0 ? title : '🟢 Spacing normal (simulated demo)'}
      </div>
      {alerts.length === 0 ? (
        <div style={{ color: '#888' }}>No closer approach within 100 m and no predicted conflict.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, lineHeight: '1.9' }}>
          {visible.map((alert) => (
            <li key={alert.id}>
              <span style={{ color: alert.severity === 'critical' ? '#ff6b6b' : '#ffd75e' }}>
              {alert.severity === 'critical' ? 'CRITICAL' : 'WARNING'}
            </span>{' '}
            {alert.droneA.toUpperCase()} ↔ {alert.droneB.toUpperCase()} · {alert.distanceM.toFixed(1)} m
            {alert.evading && <span style={{ color: '#0ff' }}> · EVADING</span>}
            <div style={{ color: '#888', fontSize: 12 }}>Predicted closest approach {alert.predictedMinM.toFixed(1)} m</div>
          </li>
        ))}
      </ul>
    )}
    <div style={{ color: '#666', fontSize: 11, marginTop: 8 }}>
      Simulated avoidance demo: warning 100 m / critical 50 m; the simulator applies a vertical split at critical range and returns to route altitude once separated. Not for real flight.
    </div>
    </div>
  )
})
