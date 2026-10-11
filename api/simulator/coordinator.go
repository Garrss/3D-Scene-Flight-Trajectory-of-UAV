package simulator

import (
	"sort"
	"sync"
	"time"

	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/collision"
	"github.com/lien0219/3D-Scene-Flight-Trajectory-of-UAV/api/model"
)

// Coordinator applies simulated demo avoidance across the fleet: when a pair
// is critical, the lexicographically-smaller drone climbs and the other
// descends by EvadeAltM; both return to route altitude once separated beyond
// ClearM. This is a visualization aid only, not flight safety logic.
type Coordinator struct {
	mu     sync.Mutex
	cfg    collision.Config
	evade  map[string]bool
	offset map[string]float64
}

// NewCoordinator returns a coordinator; invalid configs fall back to defaults.
func NewCoordinator(cfg collision.Config) *Coordinator {
	if err := cfg.Validate(); err != nil {
		cfg = collision.DefaultConfig()
	}
	return &Coordinator{cfg: cfg, evade: map[string]bool{}, offset: map[string]float64{}}
}

// Config returns the active thresholds.
func (c *Coordinator) Config() collision.Config {
	return c.cfg
}

// Update inspects states, drives simulator avoidance flags, and returns the
// current alerts with Evading populated. now is injected for testability.
func (c *Coordinator) Update(sims []*FlightSimulator, states []model.DroneState, now time.Time) []model.Alert {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Decide which pairs demand evasion (critical distance only; warnings alert without maneuver).
	demand := map[string]bool{}
	for i := 0; i < len(states); i++ {
		for j := i + 1; j < len(states); j++ {
			if collision.Distance3D(states[i], states[j]) <= c.cfg.CriticalM {
				demand[states[i].DroneID] = true
				demand[states[j].DroneID] = true
			}
		}
	}
	// Release with hysteresis: stay evading until clear of every other drone.
	next := map[string]bool{}
	for _, s := range states {
		if demand[s.DroneID] {
			next[s.DroneID] = true
			continue
		}
		if c.evade[s.DroneID] {
			stillClose := false
			for _, o := range states {
				if o.DroneID == s.DroneID {
					continue
				}
				if collision.Distance3D(s, o) <= c.cfg.ClearM {
					stillClose = true
					break
				}
			}
			next[s.DroneID] = stillClose
		}
	}

	// Deterministic vertical split: sorted evading IDs alternate +,-,+,-...
	evadingIDs := []string{}
	for id, on := range next {
		if on {
			evadingIDs = append(evadingIDs, id)
		}
	}
	sort.Strings(evadingIDs)
	offsets := map[string]float64{}
	for i, id := range evadingIDs {
		if i%2 == 0 {
			offsets[id] = c.cfg.EvadeAltM
		} else {
			offsets[id] = -c.cfg.EvadeAltM
		}
	}

	byID := map[string]*FlightSimulator{}
	for _, sim := range sims {
		byID[sim.droneID] = sim
	}
	for _, s := range states {
		want := next[s.DroneID]
		sim := byID[s.DroneID]
		if sim == nil {
			continue
		}
		// Avoid holding coordinator lock while taking sim locks in a loop is
		// acceptable here (tick path, small fleet); keep ordering consistent.
		if want != c.evade[s.DroneID] || (want && c.offset[s.DroneID] != offsets[s.DroneID]) {
			sim.SetAvoidance(want, offsets[s.DroneID])
		}
	}

	c.evade = next
	c.offset = offsets

	alerts := collision.Detect(states, c.cfg, now)
	evadeSet := map[string]bool{}
	for id, on := range next {
		if on {
			evadeSet[id] = true
		}
	}
	for i := range alerts {
		if evadeSet[alerts[i].DroneA] || evadeSet[alerts[i].DroneB] {
			alerts[i].Evading = true
		}
	}
	return alerts
}
