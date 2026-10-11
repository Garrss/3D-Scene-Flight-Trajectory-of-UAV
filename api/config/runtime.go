package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/model"
)

const (
	defaultHTTPAddr     = ":8080"
	defaultTickInterval = 200 * time.Millisecond
)

type Runtime struct {
	HTTPAddr       string
	TickInterval   time.Duration
	AllowedOrigins []string
	MissionFile    string
	// Simulated collision thresholds (meters). Visualization demo only.
	CollisionWarnM     float64
	CollisionCriticalM float64
	CollisionClearM    float64
	CollisionHorizonS  float64
	CollisionEvadeAltM float64
}

func LoadRuntime() (Runtime, error) {
	tickInterval, err := time.ParseDuration(envOrDefault("TICK_INTERVAL", defaultTickInterval.String()))
	if err != nil || tickInterval <= 0 {
		return Runtime{}, fmt.Errorf("TICK_INTERVAL must be a positive duration: %q", os.Getenv("TICK_INTERVAL"))
	}

	origins := splitCSV(envOrDefault(
		"ALLOWED_ORIGINS",
		"http://localhost:5173,http://127.0.0.1:5173",
	))
	if len(origins) == 0 {
		return Runtime{}, errors.New("ALLOWED_ORIGINS must contain at least one origin")
	}

	collision, err := loadCollisionConfig()
	if err != nil {
		return Runtime{}, err
	}

	return Runtime{
		HTTPAddr:           envOrDefault("HTTP_ADDR", defaultHTTPAddr),
		TickInterval:       tickInterval,
		AllowedOrigins:     origins,
		MissionFile:        strings.TrimSpace(os.Getenv("MISSION_FILE")),
		CollisionWarnM:     collision.WarnM,
		CollisionCriticalM: collision.CriticalM,
		CollisionClearM:    collision.ClearM,
		CollisionHorizonS:  collision.HorizonS,
		CollisionEvadeAltM: collision.EvadeAltM,
	}, nil
}

func LoadMission(path string) (Mission, error) {
	if strings.TrimSpace(path) == "" {
		mission := DefaultMission()
		return mission, ValidateMission(mission)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return Mission{}, fmt.Errorf("read mission file: %w", err)
	}

	var mission Mission
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&mission); err != nil {
		return Mission{}, fmt.Errorf("decode mission file: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return Mission{}, errors.New("decode mission file: multiple JSON values are not allowed")
	}
	if mission.LaunchPoint == (model.Waypoint{}) {
		mission.LaunchPoint = defaultLaunchPoint
	}
	if err := ValidateMission(mission); err != nil {
		return Mission{}, err
	}
	return cloneMission(mission), nil
}

func ValidateMission(mission Mission) error {
	if strings.TrimSpace(mission.Name) == "" {
		return errors.New("mission name is required")
	}
	if len(mission.Drones) == 0 {
		return errors.New("mission must define at least one drone")
	}
	if mission.LaunchPoint.Lng < -180 || mission.LaunchPoint.Lng > 180 || mission.LaunchPoint.Lat < -90 || mission.LaunchPoint.Lat > 90 || mission.LaunchPoint.Alt < 0 {
		return errors.New("launchPoint coordinates or altitude are out of range")
	}

	seen := make(map[string]struct{}, len(mission.Drones))
	for i, drone := range mission.Drones {
		if strings.TrimSpace(drone.ID) == "" {
			return fmt.Errorf("drones[%d].id is required", i)
		}
		if _, exists := seen[drone.ID]; exists {
			return fmt.Errorf("duplicate drone id %q", drone.ID)
		}
		seen[drone.ID] = struct{}{}
		if drone.Speed <= 0 {
			return fmt.Errorf("drone %q speed must be positive", drone.ID)
		}
		if err := ValidateRoute(drone.ID, drone.Route); err != nil {
			return err
		}
	}
	return nil
}

func ValidateRoute(droneID string, route []model.Waypoint) error {
	if len(route) < 2 {
		return fmt.Errorf("drone %q route must contain at least two waypoints", droneID)
	}
	hasMovement := false
	for waypointIndex, waypoint := range route {
		if waypoint.Lng < -180 || waypoint.Lng > 180 {
			return fmt.Errorf("drone %q route[%d].lng is out of range", droneID, waypointIndex)
		}
		if waypoint.Lat < -90 || waypoint.Lat > 90 {
			return fmt.Errorf("drone %q route[%d].lat is out of range", droneID, waypointIndex)
		}
		if waypoint.Alt < 0 {
			return fmt.Errorf("drone %q route[%d].alt must not be negative", droneID, waypointIndex)
		}
		if waypointIndex > 0 {
			previous := route[waypointIndex-1]
			hasMovement = hasMovement || previous.Lng != waypoint.Lng || previous.Lat != waypoint.Lat
		}
	}
	if !hasMovement {
		return fmt.Errorf("drone %q route must contain at least one non-zero segment", droneID)
	}
	return nil
}

func cloneMission(mission Mission) Mission {
	cloned := Mission{Name: mission.Name, LaunchPoint: mission.LaunchPoint, Drones: make([]DroneConfig, len(mission.Drones))}
	for i, drone := range mission.Drones {
		cloned.Drones[i] = drone
		cloned.Drones[i].Route = append([]model.Waypoint(nil), drone.Route...)
	}
	return cloned
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// loadCollisionConfig reads simulated detection thresholds. Defaults warn at
// 100 m and treat 50 m as critical; CLEAR must be >= WARN for hysteresis.
func loadCollisionConfig() (collisionConfig, error) {
	cfg := collisionConfig{WarnM: 100, CriticalM: 50, ClearM: 120, HorizonS: 15, EvadeAltM: 15}
	var err error
	if cfg.WarnM, err = envFloat("COLLISION_WARN_M", cfg.WarnM); err != nil {
		return cfg, err
	}
	if cfg.CriticalM, err = envFloat("COLLISION_CRITICAL_M", cfg.CriticalM); err != nil {
		return cfg, err
	}
	if cfg.ClearM, err = envFloat("COLLISION_CLEAR_M", cfg.ClearM); err != nil {
		return cfg, err
	}
	if cfg.HorizonS, err = envFloat("COLLISION_HORIZON_S", cfg.HorizonS); err != nil {
		return cfg, err
	}
	if cfg.EvadeAltM, err = envFloat("COLLISION_EVADE_ALT_M", cfg.EvadeAltM); err != nil {
		return cfg, err
	}
	if cfg.WarnM <= 0 || cfg.CriticalM <= 0 || cfg.ClearM <= 0 || cfg.HorizonS <= 0 || cfg.EvadeAltM < 0 {
		return cfg, fmt.Errorf("collision thresholds must be positive (warn=%.1f critical=%.1f clear=%.1f)", cfg.WarnM, cfg.CriticalM, cfg.ClearM)
	}
	if cfg.CriticalM > cfg.WarnM {
		return cfg, fmt.Errorf("COLLISION_CRITICAL_M (%.1f) must not exceed COLLISION_WARN_M (%.1f)", cfg.CriticalM, cfg.WarnM)
	}
	if cfg.WarnM > cfg.ClearM {
		return cfg, fmt.Errorf("COLLISION_WARN_M (%.1f) must not exceed COLLISION_CLEAR_M (%.1f)", cfg.WarnM, cfg.ClearM)
	}
	return cfg, nil
}

type collisionConfig struct {
	WarnM     float64
	CriticalM float64
	ClearM    float64
	HorizonS  float64
	EvadeAltM float64
}

func envFloat(key string, fallback float64) (float64, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a number: %q", key, os.Getenv(key))
	}
	return value, nil
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, strings.TrimRight(trimmed, "/"))
		}
	}
	return result
}
