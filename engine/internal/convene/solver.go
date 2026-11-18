package convene

import (
	"slices"
)

type transitionOdds struct {
	prob [3]interval
	rank [3]int
}

type action int

const (
	drawCharacter action = iota
	drawWeapon
	buyWaveband
)

var actionNames = [3]string{"character", "weapon", "waveband"}

type ActionResult struct {
	ID          string `json:"id"`
	Probability Bounds `json:"probability"`
}

type ResultRow struct {
	Strategy    string         `json:"strategy"`
	Probability Bounds         `json:"probability"`
	Baseline    *Bounds        `json:"baseline,omitempty"`
	Actions     []ActionResult `json:"actions,omitempty"`
	States      int            `json:"states"`
	Incomplete  bool           `json:"incomplete"`
}

type Result struct {
	Rows        []ResultRow      `json:"rows"`
	Uncertainty string           `json:"uncertainty"`
	Resources   ResourceForecast `json:"resources"`
}

type Progress struct {
	Strategy string `json:"strategy"`
	Scenario string `json:"scenario"`
	States   int    `json:"states"`
	Layer    int    `json:"layer,omitempty"`
	Layers   int    `json:"layers,omitempty"`
	Forecast bool   `json:"forecast,omitempty"`
	Budget   int    `json:"budget"`
}

type solver struct {
	config       Config
	roster       *roster
	odds         [2][80][10]transitionOdds
	firstCertain [2][80]int
	initial      state
	strategy     string
	scenario     string
	refund       bool
	hasCutoff    bool
	visited      int
	cache        map[state]interval
	rootActions  map[action]interval
	progress     func(Progress)
}

func newSolver(c Config, strategy, scenario string, refund bool, progress func(Progress)) *solver {
	m := &solver{
		config: c, roster: newRoster(c.Ownership, scenario), strategy: strategy, scenario: scenario,
		refund: refund, progress: progress, cache: make(map[state]interval),
		rootActions: make(map[action]interval),
	}
	m.initial = m.normalize(initial(c, 0))
	for pool, series := range c.Rules.Five {
		certainty := len(series)
		for index := len(series) - 1; index >= 0; index-- {
			rate := series[index]
			if rate == partPerBillion {
				certainty = index + 1
			}
			m.firstCertain[pool][index] = certainty - index
			five := fraction(uint64(rate), partPerBillion)
			for fourPity := 0; fourPity < 10; fourPity++ {
				remaining := five.complement()
				var four, three interval
				switch {
				case fourPity == 9:
					four = remaining
				case c.Rules.FourMode == "conditional":
					four = remaining.times(fraction(15, 248))
					three = remaining.times(fraction(233, 248))
				default:
					rate4 := min(60_000_000, partPerBillion-rate)
					four = fraction(uint64(rate4), partPerBillion)
					three = fraction(uint64(partPerBillion-rate-rate4), partPerBillion)
				}
				odds := transitionOdds{[3]interval{three, four, five}, [3]int{0, 1, 2}}
				slices.SortStableFunc(odds.rank[:], func(a, b int) int {
					switch {
					case odds.prob[a].lo > odds.prob[b].lo:
						return -1
					case odds.prob[a].lo < odds.prob[b].lo:
						return 1
					default:
						return 0
					}
				})
				m.odds[pool][index][fourPity] = odds
			}
		}
	}
	return m
}

func (m *solver) canFarm(s state, pool int) bool {
	return m.refund && m.config.Farm && m.strategy == "optimal" && s.personal[pool] > 0
}

func (m *solver) normalize(s state) state {
	for pool, p := range s.pool {
		if s.need[pool] == 0 {
			s.quota[pool] = 0
			if !m.canFarm(s, pool) {
				s.pool[pool], s.personal[pool] = 0, 0
				continue
			}
		}
		if !m.refund {
			s.pool[pool] = makePity(p.five(), 0, p.up5(), false)
		} else if m.scenario == "normal" || m.scenario == "maxed" && pool == character {
			// 4-star picks have the same reward in these cases.
			s.pool[pool] = makePity(p.five(), p.four(), p.up5(), false)
		}
	}
	if s.need[character] == 0 {
		s.shop = 0
		if !m.canFarm(s, character) {
			s.owned = 0
		}
	}
	if !m.refund && s.owned > 0 {
		s.owned = 1 // Only ownership for shop access remains relevant.
	}
	if s.shop == 0 {
		s.coral = 0
	}
	maxBlue := oscUnits * (int(s.quota[character]) + int(s.quota[weapon]))
	s.blue = uint8(min(int(s.blue), maxBlue))
	return s
}

func (m *solver) canBuy(s state) bool {
	return s.shop > 0 && s.need[character] > 0 && s.coral >= wavebandCost &&
		(s.owned > 0 || m.config.Goals.HeldCharacter > 0)
}

func (m *solver) canDraw(s state, pool int) bool {
	if s.need[pool] == 0 {
		return m.canFarm(s, pool)
	}
	return s.personal[pool] > 0 || s.quota[pool] > 0 && s.blue >= oscUnits || s.shared >= afterglowCost
}

func (m *solver) spend(s state, pool int) state {
	switch {
	case s.personal[pool] > 0:
		s.personal[pool]--
	case s.quota[pool] > 0 && s.blue >= oscUnits:
		s.blue -= oscUnits
		s.quota[pool]--
	default:
		if m.config.Resources.SpendAfter && s.shared-s.coral < afterglowCost {
			s.coral -= afterglowCost
		}
		s.shared -= afterglowCost
	}
	return s
}

func (m *solver) credit(s state, coral, blue int) state {
	if !m.refund {
		return s
	}
	if s.shop > 0 {
		s.coral += uint32(coral)
	}
	if m.config.Resources.SpendAfter {
		s.shared += uint32(coral)
	}
	s.blue = uint8(min(int(s.blue)+blue, oscUnits*(int(s.quota[character])+int(s.quota[weapon]))))
	return s
}

func (m *solver) buy(s state) state {
	s.shop--
	s.need[character]--
	s.coral -= wavebandCost
	if m.config.Resources.SpendAfter {
		s.shared -= wavebandCost
	}
	if m.config.Goals.BuyCounts || s.owned == 0 {
		s.owned = min(7, s.owned+1)
	}
	return s
}

func (m *solver) cover(s state, c, w int) bool {
	c = max(0, c-int(s.personal[character]))
	w = max(0, w-int(s.personal[weapon]))
	blue := min(int(s.blue)/oscUnits, min(c, int(s.quota[character]))+min(w, int(s.quota[weapon])))
	return c+w-blue <= int(s.shared)/afterglowCost
}

func (m *solver) remainingDraws(s state, pool int) int {
	need := int(s.need[pool])
	if need == 0 {
		return 0
	}
	fresh := m.firstCertain[pool][0]
	first := m.firstCertain[pool][s.pool[pool].five()]
	if pool == weapon {
		return first + (need-1)*fresh
	}
	// Every pair of character 5-stars contains a featured success.
	extra := 2*(need-1) + 1
	if s.pool[pool].up5() {
		extra--
	}
	return first + extra*fresh
}

func (m *solver) available(s state) ([3]action, int) {
	var actions [3]action
	count := 0
	if m.strategy == "optimal" {
		for pool := range s.pool {
			if m.canDraw(s, pool) {
				actions[count] = action(pool)
				count++
			}
		}
	} else {
		pool := character
		if m.strategy == "weaponFirst" {
			pool = weapon
		}
		if s.need[pool] == 0 {
			pool = 1 - pool
		}
		if m.canDraw(s, pool) {
			actions[count] = action(pool)
			count++
		}
	}
	if m.canBuy(s) {
		actions[count] = buyWaveband
		count++
	}
	return actions, count
}

type mixture struct {
	sum       interval
	hasNonOne bool
}

func (a *mixture) add(p, conditional interval) {
	if conditional != one {
		a.hasNonOne = true
	}
	a.sum = a.sum.plus(p.times(conditional))
}

func (a mixture) value() interval {
	if !a.hasNonOne {
		return one
	}
	return a.sum
}

type outcome func(state, interval)

func (m *solver) outcomes(s state, pool int, emit outcome) {
	s = m.spend(s, pool)
	p := s.pool[pool]
	if !m.refund {
		prob := m.odds[pool][p.five()][0].prob[2]
		if prob.hi > 0 {
			m.five(s, pool, p, prob, emit)
		}
		if prob.lo < Scale {
			s.pool[pool] = makePity(p.five()+1, 0, p.up5(), false)
			emit(s, prob.complement())
		}
		return
	}
	odds := m.odds[pool][p.five()][p.four()]
	for _, rarity := range odds.rank {
		prob := odds.prob[rarity]
		if prob.hi == 0 {
			continue
		}
		switch rarity {
		case 0:
			three := s
			three.pool[pool] = makePity(p.five()+1, p.four()+1, p.up5(), p.up4())
			emit(m.credit(three, 0, 3), prob)
		case 1:
			m.four(s, pool, p, prob, emit)
		case 2:
			m.five(s, pool, p, prob, emit)
		}
	}
}

func (m *solver) withItems(s state, bucket int, weight interval, emit outcome) {
	for _, roll := range m.roster.rolls(s.hold, bucket) {
		next := s
		next.hold = roll.hold
		emit(m.credit(next, roll.reward, 0), weight.times(roll.prob))
	}
}

func (m *solver) four(s state, pool int, p pity, weight interval, emit outcome) {
	up := s
	up.pool[pool] = makePity(p.five()+1, 0, p.up5(), false)
	if m.scenario == "normal" || m.scenario == "maxed" && pool == character {
		reward := 3
		if m.scenario == "maxed" {
			reward = 8
		}
		emit(m.credit(up, reward, 0), weight)
		return
	}
	if !p.up4() {
		weight = weight.times(fraction(1, 2))
	}
	if pool == weapon {
		emit(m.credit(up, 3, 0), weight)
	} else {
		m.withItems(up, fourUp, weight, emit)
	}
	if !p.up4() {
		off := s
		off.pool[pool] = makePity(p.five()+1, 0, p.up5(), true)
		m.withItems(off, fourOffCharacter+pool, weight, emit)
	}
}

func (m *solver) five(s state, pool int, p pity, weight interval, emit outcome) {
	fourPity := 0
	if m.refund && !m.config.Rules.FiveResetsFour {
		fourPity = min(9, p.four()+1)
	}
	up := s
	up.pool[pool] = makePity(0, fourPity, false, p.up4())
	if up.need[pool] > 0 {
		up.need[pool]--
	}
	if pool == weapon {
		emit(m.credit(up, 15, 0), weight)
		return
	}
	reward := 15
	if up.owned == 7 {
		reward = 40
	}
	up.owned = min(7, up.owned+1)
	if !p.up5() {
		weight = weight.times(fraction(1, 2))
	}
	emit(m.credit(up, reward, 0), weight)
	if !p.up5() {
		off := s
		off.pool[pool] = makePity(0, fourPity, true, p.up4())
		if m.refund {
			m.withItems(off, fiveOff, weight, emit)
		} else {
			emit(off, weight)
		}
	}
}

func (m *solver) draw(s state, pool int) interval {
	var result mixture
	m.outcomes(s, pool, func(next state, probability interval) {
		result.add(probability, m.value(next))
	})
	return result.value()
}

func (m *solver) value(s state) interval {
	s = m.normalize(s)
	if s.need == ([2]uint8{}) {
		return one
	}
	if p, ok := m.cache[s]; ok {
		return p
	}
	if m.cover(s, m.remainingDraws(s, character), m.remainingDraws(s, weapon)) {
		return one
	}
	actions, count := m.available(s)
	if count == 0 {
		return zero
	}
	if m.visited >= m.config.StateBudget {
		m.hasCutoff = true
		return unknown
	}
	m.visited++
	if m.progress != nil && (m.visited == 1 || m.visited%65_536 == 0) {
		m.progress(Progress{Strategy: m.strategy, Scenario: m.scenario, States: m.visited, Budget: m.config.StateBudget})
	}
	var result interval
	for _, action := range actions[:count] {
		var value interval
		if action == buyWaveband {
			value = m.value(m.buy(s))
		} else {
			value = m.draw(s, int(action))
		}
		if s == m.initial {
			m.rootActions[action] = value
		}
		result = maximum(result, value)
		if result == one && s != m.initial {
			break
		}
	}
	m.cache[s] = result
	return result
}

type solved struct {
	p       interval
	actions map[action]interval
	cutoff  bool
	states  int
}

func solveScenario(c Config, strategy, scenario string, refund bool, forecast *ResourceForecast, progress func(Progress)) solved {
	if !refund {
		scenario = "baseline"
	}
	m := newSolver(c, strategy, scenario, refund, progress)
	if !refund && m.initial.shop == 0 {
		return solved{p: m.noFeedback()}
	}
	var p interval
	if strategy != "optimal" && m.initial.shop == 0 {
		p = m.forward()
	} else if strategy == "optimal" && m.initial.shop == 0 && !c.Farm &&
		(m.initial.need[character] == 0 || m.initial.need[weapon] == 0) {
		p = m.forward()
	} else {
		p = m.value(m.initial)
	}
	if m.hasCutoff {
		// A feasible policy using the starting wallet gives a lower bound.
		p.lo = max(p.lo, m.noFeedback().lo)
		if refund && strategy == "optimal" && !c.Farm && m.initial.shop == 0 &&
			m.initial.need[character] > 0 && m.initial.need[weapon] > 0 {
			p.hi = min(p.hi, m.prepaidUpper().hi)
		}
	}
	if forecast != nil {
		if progress != nil {
			progress(Progress{Strategy: strategy, Scenario: scenario, Forecast: true})
		}
		*forecast = m.forecast()
	}
	return solved{p, m.rootActions, m.hasCutoff, m.visited}
}

func combined(c Config, strategy string, forecast *ResourceForecast, progress func(Progress)) solved {
	var lowerScenario, upperScenario string
	switch {
	case c.Ownership.Mode == "bounds":
		lowerScenario, upperScenario = "normal", "maxed"
	case c.needsFourRange(strategy):
		lowerScenario, upperScenario = fullFourPreset, fullFourHigh
	default:
		return solveScenario(c, strategy, c.Ownership.Mode, true, forecast, progress)
	}
	low := solveScenario(c, strategy, lowerScenario, true, forecast, progress)
	high := solveScenario(c, strategy, upperScenario, true, nil, progress)
	for a, l := range low.actions {
		if h, ok := high.actions[a]; ok {
			low.actions[a] = interval{l.lo, h.hi}
		} else {
			delete(low.actions, a)
		}
	}
	return solved{interval{low.p.lo, high.p.hi}, low.actions, low.cutoff || high.cutoff, low.states + high.states}
}

func Calculate(c Config, progress func(Progress)) (Result, error) {
	if err := c.Validate(); err != nil {
		return Result{}, err
	}
	strategies := []string{c.Strategy}
	if c.Compare && c.Goals.Character > 0 && c.Goals.Weapon > 0 {
		strategies = []string{"characterFirst", "weaponFirst", "optimal"}
	}
	var fixedLower uint64
	var firstStepLower [2]uint64
	pending := c.Goals.remaining()
	recordFirstStep := func(strategy string, lower uint64) {
		if c.Goals.Wavebands != 0 || pending[character] == 0 || pending[weapon] == 0 {
			return
		}
		if strategy == "characterFirst" {
			firstStepLower[character] = lower
		} else {
			firstStepLower[weapon] = lower
		}
	}
	result := Result{Uncertainty: c.Ownership.Mode}
	if c.needsFourRange(c.Strategy) {
		result.Uncertainty = "fullFourRange"
	}
	for _, strategy := range strategies {
		var forecast *ResourceForecast
		if strategy == c.Strategy {
			forecast = &result.Resources
		}
		current := combined(c, strategy, forecast, progress)
		row := ResultRow{Strategy: strategy, States: current.states, Incomplete: current.cutoff}
		if c.Baseline {
			baseline := solveScenario(c, strategy, "baseline", false, nil, progress)
			bounds := baseline.p.bounds()
			row.Baseline = &bounds
			row.Incomplete = row.Incomplete || baseline.cutoff
			row.States += baseline.states
			current.p.lo = max(current.p.lo, baseline.p.lo)
		}
		if strategy == "optimal" && current.cutoff && len(strategies) == 1 &&
			c.Goals.Character > 0 && c.Goals.Weapon > 0 {
			for _, alternative := range []string{"characterFirst", "weaponFirst"} {
				fixed := combined(c, alternative, nil, progress)
				recordFirstStep(alternative, fixed.p.lo)
				current.p.lo = max(current.p.lo, fixed.p.lo)
				row.States += fixed.states
			}
		}
		if strategy == "optimal" {
			current.p.lo = max(current.p.lo, fixedLower)
		} else {
			fixedLower = max(fixedLower, current.p.lo)
			recordFirstStep(strategy, current.p.lo)
		}
		row.Probability = current.p.bounds()
		for i, id := range actionNames {
			if p, ok := current.actions[action(i)]; ok {
				if strategy == "optimal" && i < len(firstStepLower) {
					p.lo = max(p.lo, firstStepLower[i])
				}
				p.hi = min(p.hi, current.p.hi)
				row.Actions = append(row.Actions, ActionResult{id, p.bounds()})
			}
		}
		result.Rows = append(result.Rows, row)
	}
	return result, nil
}
