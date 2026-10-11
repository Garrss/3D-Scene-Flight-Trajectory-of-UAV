package simulator

import (
	"math"
	"sync"
	"time"

	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/config"
	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/model"
)

type FlightSimulator struct {
	mu               sync.RWMutex
	droneID          string
	route            []model.Waypoint
	currentIdx       int
	progress         float64
	battery          float64
	speed            float64
	state            model.DroneState
	tickInterval     time.Duration
	mode             string
	manualKeys       map[string]bool
	returnLng        float64
	returnLat        float64
	returnAlt        float64
	returnIdx        int
	returnProg       float64
	manualLastUpdate time.Time
	launchPoint      model.Waypoint
	launched         bool
	outbound         bool
}

func NewFlightSimulator(cfg config.DroneConfig, tickInterval time.Duration) *FlightSimulator {
	launchPoint := cfg.LaunchPoint
	needsDispatch := launchPoint != (model.Waypoint{})
	if !needsDispatch {
		// Preserve route-first behavior for standalone simulator construction.
		launchPoint = cfg.Route[0]
	}
	status := "flying"
	if needsDispatch {
		status = "staged"
	}
	fs := &FlightSimulator{
		droneID:      cfg.ID,
		route:        cfg.Route,
		currentIdx:   0,
		progress:     0,
		battery:      config.InitBattery,
		speed:        cfg.Speed,
		tickInterval: tickInterval,
		mode:         "auto",
		manualKeys:   make(map[string]bool),
		launchPoint:  launchPoint,
		launched:     !needsDispatch,
	}
	wp := fs.launchPoint
	fs.state = model.DroneState{
		DroneID: cfg.ID,
		Lng:     wp.Lng,
		Lat:     wp.Lat,
		Alt:     wp.Alt,
		Speed:   0,
		Battery: fs.battery,
		Status:  status,
		Mode:    "auto",
	}
	return fs
}

func (fs *FlightSimulator) Tick() model.DroneState {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if !fs.launched {
		return fs.state
	}
	if fs.outbound {
		fs.tickOutbound()
		return fs.state
	}

	if fs.mode == "manual" {
		fs.tickManual()
		return fs.state
	}
	remainingDistance := fs.speed * fs.tickInterval.Seconds()
	if fs.mode == "returning" {
		distance := haversine(fs.state.Lat, fs.state.Lng, fs.returnLat, fs.returnLng)
		step := remainingDistance
		if distance <= step || distance < 0.5 {
			fs.state.Lng, fs.state.Lat, fs.state.Alt = fs.returnLng, fs.returnLat, fs.returnAlt
			fs.currentIdx, fs.progress, fs.mode = fs.returnIdx, fs.returnProg, "auto"
		} else if distance > 0 {
			ratio := step / distance
			fs.state.Heading = bearing(fs.state.Lat, fs.state.Lng, fs.returnLat, fs.returnLng)
			fs.state.Lng = lerp(fs.state.Lng, fs.returnLng, ratio)
			fs.state.Lat = lerp(fs.state.Lat, fs.returnLat, ratio)
			fs.state.Alt = lerp(fs.state.Alt, fs.returnAlt, ratio)
			fs.state.Speed = fs.speed
			fs.state.Status = "returning"
			fs.state.Mode = "returning"
			fs.state.Timestamp = time.Now().Unix()
			return fs.state
		}
	}
	var from, to model.Waypoint
	var segDist float64

	for {
		if fs.currentIdx >= len(fs.route) {
			fs.currentIdx = 0
			fs.progress = 0
		}

		from = fs.route[fs.currentIdx]
		to = fs.route[(fs.currentIdx+1)%len(fs.route)]
		segDist = haversine(from.Lat, from.Lng, to.Lat, to.Lng)
		remainingOnSegment := segDist * (1 - fs.progress)
		if segDist > 0 && remainingDistance < remainingOnSegment {
			fs.progress += remainingDistance / segDist
			break
		}

		if segDist > 0 {
			remainingDistance -= remainingOnSegment
		}
		fs.currentIdx++
		fs.progress = 0
	}

	lng := lerp(from.Lng, to.Lng, fs.progress)
	lat := lerp(from.Lat, to.Lat, fs.progress)
	alt := lerp(from.Alt, to.Alt, fs.progress)

	heading := bearing(from.Lat, from.Lng, to.Lat, to.Lng)

	altDiff := to.Alt - from.Alt
	pitch := math.Atan2(altDiff, segDist) * 180 / math.Pi
	roll := math.Sin(float64(time.Now().UnixMilli())/1000.0) * 2.0

	speed := fs.speed
	if fs.progress < 0.1 {
		speed = fs.speed * (0.5 + fs.progress*5)
	} else if fs.progress > 0.9 {
		speed = fs.speed * (0.5 + (1-fs.progress)*5)
	}

	fs.state = model.DroneState{
		DroneID:       fs.droneID,
		Lng:           lng,
		Lat:           lat,
		Alt:           alt,
		Heading:       heading,
		Pitch:         pitch,
		Roll:          roll,
		Speed:         math.Round(speed*100) / 100,
		Battery:       math.Round(fs.battery*10) / 10,
		Timestamp:     time.Now().Unix(),
		Status:        "flying",
		Mode:          fs.mode,
		WaypointIndex: fs.currentIdx,
	}
	return fs.state
}

func (fs *FlightSimulator) Launch() {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if fs.launched {
		return
	}
	fs.launched, fs.outbound = true, true
	fs.state.Status = "launching"
	fs.state.Timestamp = time.Now().Unix()
}

func (fs *FlightSimulator) tickOutbound() {
	target := fs.route[0]
	distance := haversine(fs.state.Lat, fs.state.Lng, target.Lat, target.Lng)
	step := fs.speed * fs.tickInterval.Seconds()
	if distance <= step || distance < 0.5 {
		fs.state.Lng, fs.state.Lat, fs.state.Alt = target.Lng, target.Lat, target.Alt
		fs.outbound = false
	} else if distance > 0 {
		ratio := step / distance
		fs.state.Heading = bearing(fs.state.Lat, fs.state.Lng, target.Lat, target.Lng)
		fs.state.Lng = lerp(fs.state.Lng, target.Lng, ratio)
		fs.state.Lat = lerp(fs.state.Lat, target.Lat, ratio)
		fs.state.Alt = lerp(fs.state.Alt, target.Alt, ratio)
	}
	fs.state.Speed = fs.speed
	fs.state.Status, fs.state.Mode = "launching", "auto"
	fs.state.Timestamp = time.Now().Unix()
}

// SetManual switches to heading-relative manual control and updates the held keys.
func (fs *FlightSimulator) SetManual(keys []string) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if !fs.launched || fs.outbound {
		return
	}
	now := time.Now()
	if fs.mode == "manual" {
		fs.updateManualPosition(now)
	} else {
		fs.manualLastUpdate = now
	}
	fs.mode = "manual"
	fs.manualKeys = make(map[string]bool, len(keys))
	for _, key := range keys {
		if key == "ArrowUp" || key == "ArrowDown" || key == "ArrowLeft" || key == "ArrowRight" {
			fs.manualKeys[key] = true
		}
	}
	fs.state.Mode, fs.state.Status = "manual", "manual"
}

// ReturnToRoute chooses the nearest point on any mission segment and flies to it.
func (fs *FlightSimulator) ReturnToRoute() {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if !fs.launched || fs.outbound {
		return
	}
	bestDistance := math.Inf(1)
	for i := range fs.route {
		a, b := fs.route[i], fs.route[(i+1)%len(fs.route)]
		latScale := 111320.0
		lngScale := latScale * math.Cos(fs.state.Lat*math.Pi/180)
		ax, ay := (a.Lng-fs.state.Lng)*lngScale, (a.Lat-fs.state.Lat)*latScale
		bx, by := (b.Lng-fs.state.Lng)*lngScale, (b.Lat-fs.state.Lat)*latScale
		dx, dy := bx-ax, by-ay
		denom := dx*dx + dy*dy
		t := 0.0
		if denom > 0 {
			t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/denom))
		}
		lng, lat, alt := lerp(a.Lng, b.Lng, t), lerp(a.Lat, b.Lat, t), lerp(a.Alt, b.Alt, t)
		distance := haversine(fs.state.Lat, fs.state.Lng, lat, lng)
		if distance < bestDistance {
			bestDistance, fs.returnLng, fs.returnLat, fs.returnAlt = distance, lng, lat, alt
			fs.returnIdx, fs.returnProg = i, t
		}
	}
	fs.mode = "returning"
	fs.manualKeys = make(map[string]bool)
	fs.state.Mode, fs.state.Status = "returning", "returning"
}

func (fs *FlightSimulator) tickManual() {
	fs.updateManualPosition(time.Now())
	fs.state.Mode, fs.state.Status = "manual", "manual"
	fs.state.Timestamp = time.Now().Unix()
}

func (fs *FlightSimulator) updateManualPosition(now time.Time) {
	if fs.manualLastUpdate.IsZero() {
		fs.manualLastUpdate = now
		return
	}
	dt := now.Sub(fs.manualLastUpdate).Seconds()
	fs.manualLastUpdate = now
	if dt <= 0 {
		return
	}
	forward := 0.0
	if fs.manualKeys["ArrowUp"] {
		forward++
	}
	if fs.manualKeys["ArrowDown"] {
		forward--
	}
	lateral := 0.0
	if fs.manualKeys["ArrowRight"] {
		lateral++
	}
	if fs.manualKeys["ArrowLeft"] {
		lateral--
	}
	speed := fs.speed
	if forward != 0 && lateral != 0 {
		forward *= 0.70710678
		lateral *= 0.70710678
	}
	h := fs.state.Heading * math.Pi / 180
	east := (forward*math.Sin(h) + lateral*math.Cos(h)) * speed * dt
	north := (forward*math.Cos(h) - lateral*math.Sin(h)) * speed * dt
	fs.state.Lng += east / (111320 * math.Cos(fs.state.Lat*math.Pi/180))
	fs.state.Lat += north / 111320
	fs.state.Speed = math.Hypot(forward, lateral) * speed
}

func (fs *FlightSimulator) GetState() model.DroneState {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	return fs.state
}

// Geographic calculation helpers.
func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func bearing(lat1, lng1, lat2, lng2 float64) float64 {
	dLng := (lng2 - lng1) * math.Pi / 180
	lat1R := lat1 * math.Pi / 180
	lat2R := lat2 * math.Pi / 180
	x := math.Sin(dLng) * math.Cos(lat2R)
	y := math.Cos(lat1R)*math.Sin(lat2R) - math.Sin(lat1R)*math.Cos(lat2R)*math.Cos(dLng)
	brng := math.Atan2(x, y) * 180 / math.Pi
	return math.Mod(brng+360, 360)
}

func lerp(a, b, t float64) float64 {
	return a + (b-a)*t
}
