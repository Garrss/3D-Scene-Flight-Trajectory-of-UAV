import { describe, expect, it } from 'vitest'
import { detectCollisions, distance3DM, predictClosestApproachM } from './collision'

describe('distance3DM', () => {
  it('measures vertical separation', () => {
    expect(distance3DM({ lng: 113, lat: 22, alt: 150 }, { lng: 113, lat: 22, alt: 180 })).toBeCloseTo(30, 1)
  })
})

describe('predictClosestApproachM', () => {
  it('predicts head-on convergence', () => {
    const min = predictClosestApproachM(
      { lng: 113, lat: 22, alt: 150, heading: 90, speed: 15 },
      { lng: 113.0015, lat: 22, alt: 150, heading: 270, speed: 15 },
      15,
    )
    expect(min).toBeLessThan(100)
  })
})

describe('detectCollisions', () => {
  it('warns at ~100m and flags critical at ~50m', () => {
    const warn = detectCollisions({
      a: { droneId: 'a', lng: 113, lat: 22, alt: 150, heading: 90, speed: 10 },
      b: { droneId: 'b', lng: 113.0008, lat: 22, alt: 150, heading: 270, speed: 10 },
    })
    expect(warn).toHaveLength(1)
    expect(warn[0].severity).toBe('warning')

    const critical = detectCollisions({
      a: { droneId: 'a', lng: 113, lat: 22, alt: 150, heading: 90, speed: 10 },
      b: { droneId: 'b', lng: 113.0002, lat: 22, alt: 150, heading: 270, speed: 10 },
    })
    expect(critical[0].severity).toBe('critical')
  })

  it('warns predictively before 100m when converging', () => {
    const alerts = detectCollisions({
      a: { droneId: 'a', lng: 113, lat: 22, alt: 150, heading: 90, speed: 15 },
      b: { droneId: 'b', lng: 113.0015, lat: 22, alt: 150, heading: 270, speed: 15 },
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].predictedMinM).toBeLessThanOrEqual(100)
  })

  it('returns no alerts when separated', () => {
    expect(
      detectCollisions({
        a: { droneId: 'a', lng: 113, lat: 22, alt: 150, heading: 0, speed: 10 },
        b: { droneId: 'b', lng: 114, lat: 23, alt: 150, heading: 0, speed: 10 },
      }),
    ).toHaveLength(0)
  })
})
