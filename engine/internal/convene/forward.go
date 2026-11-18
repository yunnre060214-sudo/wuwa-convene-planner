package convene

import "slices"

// A state below this mass can be deferred. All deferred mass is charged to
// the uncertainty interval, so the threshold has no unreported effect.
const minimumMass = Scale / 1_000_000_000_000

func prune(frontier map[state]interval, limit int) interval {
	if len(frontier) < 1024 {
		return zero
	}
	var deferred interval
	threshold := uint64(minimumMass)
	if len(frontier) > limit {
		masses := make([]uint64, 0, len(frontier))
		for _, p := range frontier {
			masses = append(masses, p.hi)
		}
		slices.Sort(masses)
		threshold = max(threshold, masses[len(masses)-limit-1])
	}
	for state, p := range frontier {
		if p.hi <= threshold {
			deferred = deferred.plus(p)
			delete(frontier, state)
		}
	}
	return deferred
}

func (m *solver) frontierProgress(layer, horizon, visited int) {
	if m.progress != nil && (layer == 0 || layer%8 == 0) {
		m.progress(Progress{Strategy: m.strategy, Scenario: m.scenario, States: visited, Layer: layer + 1, Layers: horizon + 1, Budget: m.config.StateBudget})
	}
}

func (m *solver) forward() interval {
	initial := m.initial
	frontier := map[state]interval{initial: one}
	horizon := m.remainingDraws(initial, character) + m.remainingDraws(initial, weapon)
	var success, failure, deferred interval
	for layer := 0; len(frontier) != 0; layer++ {
		m.frontierProgress(layer, horizon, m.visited)
		next := make(map[state]interval, len(frontier))
		for current, mass := range frontier {
			m.visited++
			if current.need == ([2]uint8{}) ||
				m.cover(current, m.remainingDraws(current, character), m.remainingDraws(current, weapon)) {
				success = success.plus(mass)
				continue
			}
			actions, count := m.available(current)
			if count == 0 {
				failure = failure.plus(mass)
				continue
			}
			m.outcomes(current, int(actions[0]), func(child state, probability interval) {
				weight := probability.times(mass)
				if weight.hi == 0 {
					return
				}
				child = m.normalize(child)
				next[child] = next[child].plus(weight)
			})
		}
		deferred = deferred.plus(prune(next, m.config.StateBudget))
		frontier = next
	}
	m.hasCutoff = deferred.hi != 0
	return interval{
		max(success.lo, failure.plus(deferred).complement().lo),
		min(success.plus(deferred).hi, failure.complement().hi),
	}
}
