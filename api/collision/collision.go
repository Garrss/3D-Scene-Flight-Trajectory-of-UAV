package collision

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/model"
)

// Config holds simulated detection thresholds (meters). ClearM provides
// hysteresis so an alert does not flap when a pair hovers near WarnM.
type Config struct {
	WarnM     float64
	CriticalM float64
	ClearM    float64
	// HorizonS is the CPA look-ahead window in seconds.
	HorizonS float64
	// EvadeAltM is the demo vertical separation applied per drone.
	EvadeAltM float64
}

// DefaultConfig warns ~100 m before a potential collision and treats
// ~50 m as critical, per product request.
func DefaultConfig() Config {
	return Config{WarnM: 100, CriticalM: 50, ClearM: 120, HorizonS: 15, EvadeAltM: 15}
}

// Validate ensures thresholds are sane and ordered: 0 < critical <= warn <= clear.
func (c Config) Validate() error {
	if c.WarnM <= 0 || c.CriticalM <= 0 || c.ClearM <= 0 {
		return fmt.Errorf("collision thresholds must be positive (warn=%.1f critical=%.1f clear=%.1f)", c.WarnM, c.CriticalM, c.ClearM)
	}
	if c.CriticalM > c.WarnM {
		return fmt.Errorf("collision critical (%.1f) must not exceed warn (%.1f)", c.CriticalM, c.WarnM)
	}
	if c.WarnM > c.ClearM {
		return fmt.Errorf("collision warn (%.1f) must not exceed clear (%.1f)", c.WarnM, c.ClearM)
	}
	if c.HorizonS <= 0 {
		return fmt.Errorf("collision horizon must be positive")
	}
	if c.EvadeAltM < 0 {
		return fmt.Errorf("collision evade altitude must not be negative")
	}
	return nil
}

// Distance3D returns the 3D separation in meters between two states:
// haversine for the horizontal component, direct difference for altitude.
func Distance3D(a, b model.DroneState) float64 {
	h := haversine(a.Lat, a.Lng, b.Lat, b.Lng)
	v := a.Alt - b.Alt
	return math.Sqrt(h*h + v*v)
}

// Classify maps a distance to a severity; ok=false means no alert.
func Classify(distanceM float64, cfg Config) (model.AlertSeverity, bool) {
	if distanceM <= cfg.CriticalM {
		return model.SeverityCritical, true
	}
	if distanceM <= cfg.WarnM {
		return model.SeverityWarning, true
	}
	return "", false
}

// PredictClosestApproach linearly extrapolates both drones for horizonS
// seconds (equirectangular projection around the pair midpoint) and returns
// the minimum predicted 3D distance. Heading follows the simulator convention
// (degrees clockwise from true north), speed is m/s, altitude is held constant.
func PredictClosestApproach(a, b model.DroneState, horizonS float64) float64 {
	const steps = 15
	best := Distance3D(a, b)
	if horizonS <= 0 {
		return best
	}
	lat0 := (a.Lat + b.Lat) / 2 * math.Pi / 180
	mPerDegLat := 111194.9
	mPerDegLng := 111194.9 * math.Cos(lat0)
	ax, ay := a.Lng*mPerDegLng, a.Lat*mPerDegLat
	bx, by := b.Lng*mPerDegLng, b.Lat*mPerDegLat
	ah := a.Heading * math.Pi / 180
	bh := b.Heading * math.Pi / 180
	avx, avy := math.Sin(ah)*a.Speed, math.Cos(ah)*a.Speed
	bvx, bvy := math.Sin(bh)*b.Speed, math.Cos(bh)*b.Speed
	v := a.Alt - b.Alt
	for i := 1; i <= steps; i++ {
		t := horizonS * float64(i) / float64(steps)
		dx := (ax + avx*t) - (bx + bvx*t)
		dy := (ay + avy*t) - (by + bvy*t)
		d := math.Sqrt(dx*dx + dy*dy + v*v)
		if d < best {
			best = d
		}
	}
	return best
}

// Detect evaluates every pair and returns alerts sorted by distance.
// A pair also alerts when its current distance is clear but the predicted
// minimum within the horizon falls inside WarnM ("100 m before impact").
func Detect(states []model.DroneState, cfg Config, now time.Time) []model.Alert {
	alerts := []model.Alert{}
	for i := 0; i < len(states); i++ {
		if states[i].Status == "staged" {
			continue // Parked at the launch base; exclude from collision detection.
		}
		for j := i + 1; j < len(states); j++ {
			a, b := states[i], states[j]
			if a.Status == "staged" || b.Status == "staged" {
				continue
			}
			dist := Distance3D(a, b)
			severity, ok := Classify(dist, cfg)
			if !ok {
				// Broadphase: relative speed cannot exceed the sum of both
				// speeds, so a pair farther than warn + (sa+sb)*horizon can
				// never close to WarnM — skip the 15-step extrapolation.
				if dist-(a.Speed+b.Speed)*cfg.HorizonS > cfg.WarnM {
					continue
				}
				if p := PredictClosestApproach(a, b, cfg.HorizonS); p <= cfg.WarnM {
					severity, ok = model.SeverityWarning, true
				} else {
					continue
				}
			}
			// Extrapolation runs only for pairs that actually alert, not
			// for every distant pair on every tick.
			predicted := PredictClosestApproach(a, b, cfg.HorizonS)
			first, second := a.DroneID, b.DroneID
			if second < first {
				first, second = second, first
			}
			evading := a.AvoidanceActive || b.AvoidanceActive
			alerts = append(alerts, model.Alert{
				ID:            fmt.Sprintf("%s~%s", first, second),
				DroneA:        first,
				DroneB:        second,
				DistanceM:     math.Round(dist*10) / 10,
				Severity:      severity,
				PredictedMinM: math.Round(predicted*10) / 10,
				Evading:       evading,
				Timestamp:     now.Unix(),
			})
		}
	}
	sort.Slice(alerts, func(i, j int) bool { return alerts[i].DistanceM < alerts[j].DistanceM })
	return alerts
}

func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
