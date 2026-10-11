import { describe, expect, it } from 'vitest'
import { parseDronePayload } from './dronePayload'

const telemetry = {
  droneId: 'uav-001', lng: 113, lat: 22, alt: 100,
  heading: 90, pitch: 1, roll: 2, speed: 10, battery: 99, timestamp: 1,
}

describe('parseDronePayload', () => {
  it('accepts fleet and legacy single-drone payloads', () => {
    expect(parseDronePayload(JSON.stringify(telemetry)).ids).toEqual(['uav-001'])
    expect(parseDronePayload(JSON.stringify([telemetry])).fleet['uav-001']).toEqual(telemetry)
  })

  it('accepts the versioned envelope with alerts', () => {
    const envelope = {
      v: 1,
      drones: [telemetry],
      alerts: [
        { id: 'uav-001~uav-002', droneA: 'uav-001', droneB: 'uav-002', distanceM: 80, severity: 'warning', predictedMinM: 40, evading: false, timestamp: 1 },
      ],
    }
    const parsed = parseDronePayload(JSON.stringify(envelope))
    expect(parsed.ids).toEqual(['uav-001'])
    expect(parsed.alerts).toHaveLength(1)
    expect(parsed.alerts[0].severity).toBe('warning')
  })

  it('rejects malformed telemetry', () => {
    expect(() => parseDronePayload('{"droneId":"uav-001"}')).toThrow('invalid telemetry')
    expect(() => parseDronePayload(JSON.stringify([telemetry, telemetry]))).toThrow('duplicate ID')
  })
})
