package simulator

import (
	"testing"
	"time"

	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/collision"
	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/config"
	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/model"
)

func testSim(id string, lng float64) *FlightSimulator {
	return NewFlightSimulator(config.DroneConfig{
		ID:    id,
		Speed: 10,
		Route: []model.Waypoint{{Lng: lng, Lat: 22, Alt: 150}, {Lng: lng + 0.01, Lat: 22, Alt: 150}},
	}, 200*time.Millisecond)
}

func TestCoordinatorEvadesAndRecovers(t *testing.T) {
	cfg := collision.Config{WarnM: 100, CriticalM: 50, ClearM: 120, HorizonS: 15, EvadeAltM: 15}
	coord := NewCoordinator(cfg)
	sims := []*FlightSimulator{testSim("uav-a", 113), testSim("uav-b", 113)}
	states := []model.DroneState{
		{DroneID: "uav-a", Lng: 113, Lat: 22, Alt: 150, Heading: 90, Speed: 10},
		{DroneID: "uav-b", Lng: 113.0002, Lat: 22, Alt: 150, Heading: 270, Speed: 10},
	}
	alerts := coord.Update(sims, states, time.Unix(1700000000, 0))
	if len(alerts) != 1 || alerts[0].Severity != model.SeverityCritical {
		t.Fatalf("alerts = %#v, want 1 critical", alerts)
	}
	if !alerts[0].Evading {
		t.Fatal("alert should report evading")
	}
	if !sims[0].GetState().AvoidanceActive || !sims[1].GetState().AvoidanceActive {
		t.Fatal("simulators should be avoidance-active")
	}
	// Far apart -> alerts clear and avoidance releases.
	far := []model.DroneState{
		{DroneID: "uav-a", Lng: 113, Lat: 22, Alt: 150, Heading: 0, Speed: 10},
		{DroneID: "uav-b", Lng: 114, Lat: 23, Alt: 150, Heading: 0, Speed: 10},
	}
	if alerts := coord.Update(sims, far, time.Unix(1700000001, 0)); len(alerts) != 0 {
		t.Fatalf("alerts after separation = %#v, want none", alerts)
	}
	if sims[0].GetState().AvoidanceActive || sims[1].GetState().AvoidanceActive {
		t.Fatal("avoidance should release after separation")
	}
}

func TestCoordinatorHysteresis(t *testing.T) {
	cfg := collision.Config{WarnM: 100, CriticalM: 50, ClearM: 120, HorizonS: 15, EvadeAltM: 15}
	coord := NewCoordinator(cfg)
	sims := []*FlightSimulator{testSim("uav-a", 113), testSim("uav-b", 113)}
	close := []model.DroneState{
		{DroneID: "uav-a", Lng: 113, Lat: 22, Alt: 150},
		{DroneID: "uav-b", Lng: 113.0002, Lat: 22, Alt: 150},
	}
	coord.Update(sims, close, time.Unix(1700000000, 0))
	// 80 m: no longer critical but within clear -> keep evading.
	mid := []model.DroneState{
		{DroneID: "uav-a", Lng: 113, Lat: 22, Alt: 165},
		{DroneID: "uav-b", Lng: 113.0008, Lat: 22, Alt: 135},
	}
	coord.Update(sims, mid, time.Unix(1700000001, 0))
	if !sims[0].GetState().AvoidanceActive {
		t.Fatal("avoidance should persist inside hysteresis band")
	}
}
