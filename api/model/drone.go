package model

type DroneState struct {
	DroneID         string  `json:"droneId"`
	Lng             float64 `json:"lng"`
	Lat             float64 `json:"lat"`
	Alt             float64 `json:"alt"`
	Heading         float64 `json:"heading"`
	Pitch           float64 `json:"pitch"`
	Roll            float64 `json:"roll"`
	Speed           float64 `json:"speed"`
	Battery         float64 `json:"battery"`
	Timestamp       int64   `json:"timestamp"`
	Status          string  `json:"status"`
	WaypointIndex   int     `json:"waypointIndex"`
	AvoidanceActive bool    `json:"avoidanceActive"`
}

// AlertSeverity describes how close a drone pair is (simulation only).
type AlertSeverity string

const (
	SeverityWarning  AlertSeverity = "warning"
	SeverityCritical AlertSeverity = "critical"
)

// Alert is a simulated pairwise proximity warning. It is a visualization aid,
// not a flight-safety or air-traffic signal. Never use it to control real aircraft.
type Alert struct {
	ID        string        `json:"id"`
	DroneA    string        `json:"droneA"`
	DroneB    string        `json:"droneB"`
	DistanceM float64       `json:"distanceM"`
	Severity  AlertSeverity `json:"severity"`
	// PredictedMinM is the predicted closest-approach distance within the
	// look-ahead horizon, when heading/speed extrapolation is available.
	PredictedMinM float64 `json:"predictedMinM"`
	// Evading reports whether the simulator is applying a demo avoidance
	// offset for this pair.
	Evading   bool  `json:"evading"`
	Timestamp int64 `json:"timestamp"`
}

// TelemetryEnvelope is the versioned WS / /api/state payload.
type TelemetryEnvelope struct {
	Version int          `json:"v"`
	Drones  []DroneState `json:"drones"`
	Alerts  []Alert      `json:"alerts"`
}

type Waypoint struct {
	Lng float64 `json:"lng"`
	Lat float64 `json:"lat"`
	Alt float64 `json:"alt"`
}
