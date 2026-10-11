package collision

import (
	"testing"
	"time"

	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/model"
)

func TestValidate(t *testing.T) {
	if err := DefaultConfig().Validate(); err != nil {
		t.Fatalf("DefaultConfig invalid: %v", err)
	}
	bad := DefaultConfig()
	bad.CriticalM = 200
	if err := bad.Validate(); err == nil {
		t.Fatal("expected error when critical > warn")
	}
}

func TestDistance3D(t *testing.T) {
	a := model.DroneState{Lat: 22, Lng: 113, Alt: 150}
	b := model.DroneState{Lat: 22, Lng: 113, Alt: 180}
	if d := Distance3D(a, b); d < 29.9 || d > 30.1 {
		t.Fatalf("vertical distance = %f, want 30", d)
	}
	// ~111 m per 0.001 deg longitude at equator-ish latitude.
	c := model.DroneState{Lat: 22, Lng: 113.001, Alt: 150}
	if d := Distance3D(a, c); d < 90 || d > 120 {
		t.Fatalf("horizontal distance = %f, want ~103", d)
	}
}

func TestClassifyThresholds(t *testing.T) {
	cfg := DefaultConfig()
	if sev, ok := Classify(30, cfg); !ok || sev != model.SeverityCritical {
		t.Fatalf("30m = %q/%v, want critical", sev, ok)
	}
	if sev, ok := Classify(80, cfg); !ok || sev != model.SeverityWarning {
		t.Fatalf("80m = %q/%v, want warning", sev, ok)
	}
	if _, ok := Classify(150, cfg); ok {
		t.Fatal("150m should not alert")
	}
}

func TestDetectFindsClosestPairFirst(t *testing.T) {
	cfg := DefaultConfig()
	now := time.Unix(1700000000, 0)
	states := []model.DroneState{
		{DroneID: "uav-001", Lat: 22, Lng: 113, Alt: 150, Heading: 90, Speed: 10},
		{DroneID: "uav-002", Lat: 22, Lng: 113.0005, Alt: 150, Heading: 270, Speed: 10},
		{DroneID: "uav-003", Lat: 23, Lng: 114, Alt: 150, Heading: 0, Speed: 10},
	}
	alerts := Detect(states, cfg, now)
	if len(alerts) != 1 {
		t.Fatalf("alerts = %d, want 1", len(alerts))
	}
	if alerts[0].DroneA != "uav-001" || alerts[0].DroneB != "uav-002" {
		t.Fatalf("pair = %s/%s", alerts[0].DroneA, alerts[0].DroneB)
	}
	if alerts[0].Severity != model.SeverityWarning && alerts[0].Severity != model.SeverityCritical {
		t.Fatalf("severity = %q", alerts[0].Severity)
	}
}

func TestDetectPredictiveWarning(t *testing.T) {
	cfg := DefaultConfig()
	now := time.Unix(1700000000, 0)
	// ~150 m apart now but head-on at 15 m/s each -> CPA near 0 within horizon.
	states := []model.DroneState{
		{DroneID: "uav-a", Lat: 22, Lng: 113, Alt: 150, Heading: 90, Speed: 15},
		{DroneID: "uav-b", Lat: 22, Lng: 113.0015, Alt: 150, Heading: 270, Speed: 15},
	}
	alerts := Detect(states, cfg, now)
	if len(alerts) != 1 || alerts[0].Severity != model.SeverityWarning {
		t.Fatalf("predictive alerts = %#v, want 1 warning", alerts)
	}
	if alerts[0].PredictedMinM > cfg.WarnM {
		t.Fatalf("predictedMin = %f, want <= warn", alerts[0].PredictedMinM)
	}
}

func TestDetectNoFalsePositive(t *testing.T) {
	cfg := DefaultConfig()
	now := time.Unix(1700000000, 0)
	states := []model.DroneState{
		{DroneID: "uav-a", Lat: 22, Lng: 113, Alt: 150, Heading: 0, Speed: 10},
		{DroneID: "uav-b", Lat: 23, Lng: 114, Alt: 150, Heading: 180, Speed: 10},
	}
	if alerts := Detect(states, cfg, now); len(alerts) != 0 {
		t.Fatalf("alerts = %#v, want none", alerts)
	}
}

func TestDetectBroadphaseSkipsUnreachablePairs(t *testing.T) {
	cfg := DefaultConfig()
	now := time.Unix(1700000000, 0)
	// ~10 km apart head-on at 15 m/s each: at most ~450 m of closing in the
	// 15 s horizon, so WarnM (100 m) is unreachable and no alert is emitted.
	states := []model.DroneState{
		{DroneID: "uav-a", Lat: 22, Lng: 113, Alt: 150, Heading: 90, Speed: 15},
		{DroneID: "uav-b", Lat: 22, Lng: 113.1, Alt: 150, Heading: 270, Speed: 15},
	}
	if alerts := Detect(states, cfg, now); len(alerts) != 0 {
		t.Fatalf("alerts = %#v, want none", alerts)
	}
}
