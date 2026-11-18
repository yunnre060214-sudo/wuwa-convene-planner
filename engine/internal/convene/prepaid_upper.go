package convene

import "slices"

const accountingOffset = 1_000_000

// prepaidUpper allows both pools to spend all blue-coral stock immediately,
// and borrow red coral earned later. Every actual successful path can pay
// this relaxed bill, after excluding a minimum terminal payout from future
// credit. Its likelihood therefore bounds any online policy from above.
func (m *solver) prepaidUpper() interval {
	config := m.config
	kind := m.scenario
	if kind == "detail" {
		kind = "maxed"
	}
	config.Farm = false
	config.Goals.Wavebands = 0
	config.StateBudget = min(config.StateBudget, 120_000)
	projected := newSolver(config, "optimal", kind, true, m.progress)
	ceiling := int(m.initial.shared)
	if config.Resources.SpendAfter {
		ceiling -= 15
	}
	c, missingC := projected.netCost(character)
	w, missingW := projected.netCost(weapon)
	gaps := missingC.plus(missingW)

	keys := make([]int, 0, len(w))
	for bill := range w {
		keys = append(keys, bill)
	}
	slices.Sort(keys)
	total := make([]interval, len(keys)+1)
	for i, bill := range keys {
		total[i+1] = total[i].plus(w[bill])
	}
	var result interval
	for bill, mass := range c {
		firstTooLarge, _ := slices.BinarySearch(keys, ceiling-bill+1)
		result = result.plus(mass.times(total[firstTooLarge]))
	}
	return result.plus(gaps)
}

func (m *solver) netCost(pool int) (map[int]interval, interval) {
	other := 1 - pool
	s := m.initial
	s.shared = accountingOffset
	s.personal[pool] += uint16(s.quota[pool])
	s.pool[other], s.personal[other], s.need[other] = 0, 0, 0
	s.quota, s.blue = [2]uint8{}, 0
	s = m.normalize(s)
	horizon := m.remainingDraws(s, pool)
	frontier := map[state]interval{s: one}
	final := make(map[int]interval)
	var deferred interval
	for layer := 0; len(frontier) != 0; layer++ {
		m.frontierProgress(layer, horizon, m.visited)
		// Keep the relaxed marginal calculation bounded even for many copies.
		if m.visited+len(frontier) > 4_000_000 {
			for _, mass := range frontier {
				deferred = deferred.plus(mass)
			}
			break
		}
		next := make(map[state]interval, len(frontier))
		for current, mass := range frontier {
			m.visited++
			if current.need[pool] == 0 {
				bill := accountingOffset - int(current.shared)
				final[bill] = final[bill].plus(mass)
				continue
			}
			m.outcomes(current, pool, func(child state, probability interval) {
				weight := mass.times(probability)
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
	return final, deferred
}
