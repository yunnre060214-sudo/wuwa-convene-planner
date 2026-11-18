package convene

import (
	"math/rand/v2"
	"slices"
)

const minimumSuccessSamples = 24

type DrawEstimate struct {
	Mean float64 `json:"mean"`
	P10  int     `json:"p10"`
	P90  int     `json:"p90"`
}

type ResourceForecast struct {
	Available        int           `json:"available"`
	Total            *DrawEstimate `json:"total,omitempty"`
	Leftover         *DrawEstimate `json:"leftover,omitempty"`
	Successful       int           `json:"successful"`
	Trials           int           `json:"trials"`
	MeanWavebands    float64       `json:"meanWavebands,omitempty"`
	TotalLimited     bool          `json:"totalLimited"`
	PlanLimited      bool          `json:"planLimited"`
	ApproximateOrder bool          `json:"approximateOrder"`
}

func drawEstimate(counts []int) *DrawEstimate {
	var sum int64
	for _, count := range counts {
		sum += int64(count)
	}
	slices.Sort(counts)
	last := len(counts) - 1
	return &DrawEstimate{
		Mean: float64(sum) / float64(len(counts)),
		P10:  counts[last/10],
		P90:  counts[last*9/10],
	}
}

type forecastPools struct {
	selected [2]bool
	order    [2]int
	useSpare bool
}

func (m *solver) forecastPools() forecastPools {
	pools := forecastPools{
		selected: [2]bool{m.config.Goals.Character > 0, m.config.Goals.Weapon > 0},
		order:    [2]int{character, weapon},
		useSpare: m.config.Farm && m.strategy == "optimal",
	}
	if m.strategy == "weaponFirst" {
		pools.order = [2]int{weapon, character}
	}
	return pools
}

func (p forecastPools) wallet(s state) int {
	draws := int(s.shared) / afterglowCost
	quota := 0
	for pool, selected := range p.selected {
		if selected || p.useSpare {
			draws += int(s.personal[pool])
		}
		if selected {
			quota += int(s.quota[pool])
		}
	}
	return draws + min(int(s.blue)/oscUnits, quota)
}

func (p forecastPools) continuation(s state) (int, bool) {
	for _, pool := range p.order {
		if (p.selected[pool] || p.useSpare) && s.personal[pool] > 0 {
			return pool, true
		}
	}
	for _, pool := range p.order {
		if p.selected[pool] && s.quota[pool] > 0 && s.blue >= oscUnits {
			return pool, true
		}
	}
	for _, pool := range p.order {
		if p.selected[pool] && s.shared >= afterglowCost {
			return pool, true
		}
	}
	return 0, false
}

// Use the same outcome transitions as the probability solver. Sampling at
// the interval's lower edges leaves only fixed-point rounding at the end.
func (m *solver) sampleDraw(s state, pool int, random *rand.Rand) state {
	ticket := random.Uint64() >> 2
	var through uint64
	var chosen, last state
	found := false
	m.outcomes(s, pool, func(child state, probability interval) {
		if found {
			return
		}
		last = child
		through += probability.lo
		if ticket < through {
			chosen = child
			found = true
		}
	})
	if found {
		return chosen
	}
	return last
}

func (m *solver) storedValue(s state) interval {
	s = m.normalize(s)
	if s.need == ([2]uint8{}) || m.cover(s, m.remainingDraws(s, character), m.remainingDraws(s, weapon)) {
		return one
	}
	if p, ok := m.cache[s]; ok {
		return p
	}
	if _, count := m.available(s); count == 0 {
		return zero
	}
	return unknown
}

type forecastChoice struct {
	action      action
	uncertain   bool
	unavailable bool
}

func (m *solver) forecastAction(s state) forecastChoice {
	actions, count := m.available(s)
	if count <= 1 {
		return forecastChoice{action: actions[0], unavailable: count == 0}
	}
	// When the starting wallet can already cover the worst case, this pull
	// preserves that guarantee. Keep wavebands as an option with no draw cost
	// when the player has excluded red coral from the draw wallet.
	if m.cover(s, m.remainingDraws(s, character), m.remainingDraws(s, weapon)) {
		if !m.config.Resources.SpendAfter && m.canBuy(s) {
			return forecastChoice{action: buyWaveband}
		}
		for _, a := range actions[:count] {
			if a != buyWaveband && s.need[a] > 0 {
				return forecastChoice{action: a}
			}
		}
	}

	best := actions[0]
	var bestValue interval
	var highestUpper uint64
	for _, a := range actions[:count] {
		var p interval
		if a == buyWaveband {
			p = m.storedValue(m.buy(s))
		} else {
			var weighted mixture
			m.outcomes(s, int(a), func(next state, probability interval) {
				weighted.add(probability, m.storedValue(next))
			})
			p = weighted.value()
		}
		if p.lo > bestValue.lo {
			best, bestValue = a, p
		}
		highestUpper = max(highestUpper, p.hi)
	}
	// Fixed-point rounding alone cannot make a policy uncertain here.
	return forecastChoice{action: best, uncertain: highestUpper-bestValue.lo > Scale/1_000_000_000}
}

func (m *solver) forecast() ResourceForecast {
	pools := m.forecastPools()
	// Normalization in the success solver can drop a finished pool's tickets
	// and stock. Keep the full wallet during sampling, and normalize only for
	// choosing the next action.
	start := initial(m.config, 0)
	available := pools.wallet(start)
	drawLimit := min(12_000, max(384, 4*available+128))
	trials := min(4096, max(256, 1_600_000/drawLimit))
	result := ResourceForecast{Available: available, Trials: trials}
	planRandom := rand.New(rand.NewPCG(170, 110))
	walletRandom := rand.New(rand.NewPCG(71, 220))
	totals := make([]int, 0, trials)
	leftovers := make([]int, 0, trials)
	choices := make(map[state]forecastChoice)
	var wavebands int

	for range trials {
		current := start
		draws := 0
		for current.need != ([2]uint8{}) {
			key := m.normalize(current)
			choice, ok := choices[key]
			if !ok {
				choice = m.forecastAction(key)
				if len(choices) < 20_000 {
					choices[key] = choice
				}
			}
			if choice.unavailable {
				break
			}
			result.ApproximateOrder = result.ApproximateOrder || choice.uncertain
			if choice.action == buyWaveband {
				current = m.buy(current)
				continue
			}
			if draws == drawLimit {
				result.PlanLimited = true
				result.TotalLimited = true
				break
			}
			current = m.sampleDraw(current, int(choice.action), planRandom)
			draws++
		}
		if current.need == ([2]uint8{}) {
			leftovers = append(leftovers, pools.wallet(current))
			wavebands += int(start.shop - current.shop)
		}

		if result.TotalLimited {
			continue
		}
		// The extra draws serve only to measure the full wallet. A fulfilled
		// goal never spends any more coral on wavebands in this phase.
		current.shop, current.coral = 0, 0
		for {
			pool, ok := pools.continuation(current)
			if !ok {
				totals = append(totals, draws)
				break
			}
			if draws+pools.wallet(current) > drawLimit {
				result.TotalLimited = true
				break
			}
			current = m.sampleDraw(current, pool, walletRandom)
			draws++
		}
	}

	result.Successful = len(leftovers)
	if !result.TotalLimited {
		result.Total = drawEstimate(totals)
	}
	if !result.PlanLimited && result.Successful >= minimumSuccessSamples {
		result.Leftover = drawEstimate(leftovers)
		result.MeanWavebands = float64(wavebands) / float64(result.Successful)
	}
	return result
}
