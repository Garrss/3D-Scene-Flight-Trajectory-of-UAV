package handler

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/collision"
	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/config"
	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/model"
	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/simulator"

	"github.com/gorilla/websocket"
)

type Hub struct {
	clients        map[*websocket.Conn]struct{}
	mu             sync.RWMutex
	simulators     []*simulator.FlightSimulator
	coordinator    *simulator.Coordinator
	safetyCfg      collision.Config
	mission        config.Mission
	missionMu      sync.RWMutex
	tickInterval   time.Duration
	allowedOrigins map[string]struct{}
	origins        []string
	allowAnyOrigin bool
	upgrader       websocket.Upgrader
	// lastAlerts caches the most recent tick's alerts so HTTP handlers
	// don't re-run O(n^2) detection per poll. Guarded by mu.
	lastAlerts []model.Alert
}

// writeTimeout bounds how long a single client can stall the broadcast loop.
const writeTimeout = 2 * time.Second

// envelopeVersion versions the WS / /api/state payload.
const envelopeVersion = 1

type controlMessage struct {
	Type  string   `json:"type"`
	Drone string   `json:"droneId"`
	Keys  []string `json:"keys"`
}

func NewHub(mission config.Mission, tickInterval time.Duration, allowedOrigins []string, cfgs ...collision.Config) *Hub {
	if mission.LaunchPoint == (model.Waypoint{}) {
		mission.LaunchPoint = config.DefaultMission().LaunchPoint
	}
	sims := make([]*simulator.FlightSimulator, len(mission.Drones))
	for i, cfg := range mission.Drones {
		cfg.LaunchPoint = mission.LaunchPoint
		sims[i] = simulator.NewFlightSimulator(cfg, tickInterval)
	}
	safety := collision.DefaultConfig()
	if len(cfgs) > 0 {
		safety = cfgs[0]
	}
	if err := safety.Validate(); err != nil {
		safety = collision.DefaultConfig()
	}

	hub := &Hub{
		clients:        make(map[*websocket.Conn]struct{}),
		simulators:     sims,
		coordinator:    simulator.NewCoordinator(safety),
		safetyCfg:      safety,
		mission:        mission,
		tickInterval:   tickInterval,
		allowedOrigins: make(map[string]struct{}, len(allowedOrigins)),
		origins:        append([]string(nil), allowedOrigins...),
	}
	for _, origin := range allowedOrigins {
		if origin == "*" {
			hub.allowAnyOrigin = true
		}
		hub.allowedOrigins[strings.TrimRight(origin, "/")] = struct{}{}
	}
	hub.upgrader.CheckOrigin = hub.checkOrigin
	return hub
}

func (h *Hub) StartBroadcast(ctx context.Context) {
	ticker := time.NewTicker(h.tickInterval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				env := h.tick()
				// Simulation always advances, but skip the marshal when
				// nobody is listening.
				if h.clientCount() == 0 {
					continue
				}
				data, err := json.Marshal(env)
				if err != nil {
					log.Println("marshal error:", err)
					continue
				}
				h.broadcast(data)
			}
		}
	}()
	log.Printf("broadcast started: interval=%s drones=%d", h.tickInterval, len(h.simulators))
}

// tick advances all simulators, runs simulated avoidance, and returns the
// versioned envelope. Exported via Snapshot for HTTP handlers and tests.
func (h *Hub) tick() model.TelemetryEnvelope {
	states := make([]model.DroneState, len(h.simulators))
	for i, sim := range h.simulators {
		states[i] = sim.Tick()
	}
	alerts := h.coordinator.Update(h.simulators, states, time.Now())
	// Re-read states so demo avoidance offsets are visible in this tick.
	for i, sim := range h.simulators {
		states[i] = sim.GetState()
	}
	if alerts == nil {
		alerts = []model.Alert{}
	}
	h.mu.Lock()
	h.lastAlerts = alerts
	h.mu.Unlock()
	return model.TelemetryEnvelope{Version: envelopeVersion, Drones: states, Alerts: alerts}
}

// Snapshot returns the current envelope without advancing simulation.
// Alerts are reused from the last tick instead of re-running detection.
func (h *Hub) Snapshot() model.TelemetryEnvelope {
	states := make([]model.DroneState, len(h.simulators))
	for i, sim := range h.simulators {
		states[i] = sim.GetState()
	}
	h.mu.RLock()
	alerts := h.lastAlerts
	h.mu.RUnlock()
	if alerts == nil {
		alerts = collision.Detect(states, h.safetyCfg, time.Now())
	}
	if alerts == nil {
		alerts = []model.Alert{}
	}
	return model.TelemetryEnvelope{Version: envelopeVersion, Drones: states, Alerts: alerts}
}

func (h *Hub) clientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *Hub) broadcast(msg []byte) {
	h.mu.RLock()
	connections := make([]*websocket.Conn, 0, len(h.clients))
	for conn := range h.clients {
		connections = append(connections, conn)
	}
	h.mu.RUnlock()

	for _, conn := range connections {
		// Bound slow clients: without a deadline one stalled browser
		// head-of-line blocks every other client on this tick.
		_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		err := conn.WriteMessage(websocket.TextMessage, msg)
		if err != nil {
			log.Println("write error (dropping slow client):", err)
			_ = conn.Close()
			h.mu.Lock()
			delete(h.clients, conn)
			h.mu.Unlock()
		}
	}
}

func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade error:", err)
		return
	}
	h.mu.Lock()
	h.clients[conn] = struct{}{}
	clientCount := len(h.clients)
	h.mu.Unlock()
	log.Printf("websocket client connected: total=%d", clientCount)

	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		_ = conn.Close()
		log.Println("websocket client disconnected")
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var control controlMessage
		if json.Unmarshal(message, &control) != nil {
			continue
		}
		if control.Type == "launch-all" {
			for _, sim := range h.simulators {
				sim.Launch()
			}
			continue
		}
		if control.Type == "return-all-to-base" {
			for _, sim := range h.simulators {
				sim.ReturnToBase()
			}
			continue
		}
		if control.Drone == "" {
			continue
		}
		for _, sim := range h.simulators {
			if sim.GetState().DroneID != control.Drone {
				continue
			}
			switch control.Type {
			case "manual":
				sim.SetManual(control.Keys)
			case "return":
				sim.ReturnToRoute()
			case "launch":
				sim.Launch()
			case "return-to-base":
				sim.ReturnToBase()
			}
			break
		}
	}
}

func (h *Hub) HandleState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(h.Snapshot()); err != nil {
		log.Println("encode state response:", err)
	}
}

// HandleAlerts exposes the current simulated proximity alerts (demo only).
func (h *Hub) HandleAlerts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(h.Snapshot().Alerts); err != nil {
		log.Println("encode alerts response:", err)
	}
}

func (h *Hub) HandleConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	h.missionMu.RLock()
	defer h.missionMu.RUnlock()
	if err := json.NewEncoder(w).Encode(h.mission); err != nil {
		log.Println("encode mission response:", err)
	}
}

func (h *Hub) HandleDroneRoute(w http.ResponseWriter, r *http.Request) {
	droneID := r.PathValue("id")
	var request struct {
		Route []model.Waypoint `json:"route"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid route JSON", http.StatusBadRequest)
		return
	}
	if err := config.ValidateRoute(droneID, request.Route); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	h.missionMu.Lock()
	defer h.missionMu.Unlock()
	for i := range h.mission.Drones {
		if h.mission.Drones[i].ID != droneID {
			continue
		}
		h.simulators[i].UpdateRoute(request.Route)
		h.mission.Drones[i].Route = append([]model.Waypoint(nil), request.Route...)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.mission.Drones[i])
		return
	}
	http.Error(w, "drone not found", http.StatusNotFound)
}

func (h *Hub) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || h.allowAnyOrigin {
		return true
	}
	if _, allowed := h.allowedOrigins[strings.TrimRight(origin, "/")]; allowed {
		return true
	}
	return IsOriginAllowed(origin, h.origins)
}

// IsOriginAllowed keeps production origins exact while allowing a local Vite
// server to move to another loopback port when its preferred port is occupied.
func IsOriginAllowed(origin string, allowedOrigins []string) bool {
	originURL, ok := parseOrigin(origin)
	if !ok {
		return false
	}

	trimmedOrigin := strings.TrimRight(origin, "/")
	for _, allowedOrigin := range allowedOrigins {
		trimmedAllowed := strings.TrimRight(allowedOrigin, "/")
		if trimmedAllowed == "*" || trimmedAllowed == trimmedOrigin {
			return true
		}

		allowedURL, valid := parseOrigin(trimmedAllowed)
		if valid && originURL.Scheme == allowedURL.Scheme && isLoopbackHost(originURL.Hostname()) && isLoopbackHost(allowedURL.Hostname()) {
			return true
		}
	}
	return false
}

func parseOrigin(value string) (*url.URL, bool) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(value), "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, false
	}
	return parsed, true
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
