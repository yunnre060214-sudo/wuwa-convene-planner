package convene

func (m *solver) fiveStarTime(pool, pity5 int) []interval {
	probs := make([]interval, 81-pity5)
	survive := one
	for pull, rate := range m.config.Rules.Five[pool][pity5:] {
		hazard := fraction(uint64(rate), partPerBillion)
		probs[pull+1] = survive.times(hazard)
		survive = survive.times(hazard.complement())
	}
	return probs
}

func convolve(a, b []interval) []interval {
	result := make([]interval, len(a)+len(b)-1)
	for i, aProb := range a {
		if aProb.hi == 0 {
			continue
		}
		for j, bProb := range b {
			if bProb.hi != 0 {
				result[i+j] = result[i+j].plus(aProb.times(bProb))
			}
		}
	}
	return result
}

func average(a, b []interval) []interval {
	result := make([]interval, max(len(a), len(b)))
	half := fraction(1, 2)
	for i, p := range a {
		result[i] = p.times(half)
	}
	for i, p := range b {
		result[i] = result[i].plus(p.times(half))
	}
	return result
}

func (m *solver) hitTime(s state, pool int) []interval {
	count := s.need[pool]
	if count == 0 {
		return []interval{one}
	}
	fresh := m.fiveStarTime(pool, 0)
	first := m.fiveStarTime(pool, s.pool[pool].five())
	if pool == character {
		if !s.pool[pool].up5() {
			first = average(first, convolve(first, fresh))
		}
		fresh = average(fresh, convolve(fresh, fresh))
	}
	result := first
	for copy := uint8(1); copy < count; copy++ {
		result = convolve(result, fresh)
	}
	return result
}

// With no new refunds or waveband purchases, each pool's hit time is
// independent. A pair of completed paths is feasible precisely when their
// combined bill fits the wallet after quota-limited blue coral redemptions.
func (m *solver) noFeedback() interval {
	s := m.initial
	if m.cover(s, m.remainingDraws(s, character), m.remainingDraws(s, weapon)) {
		return one
	}
	cTime := m.hitTime(s, character)
	wTime := m.hitTime(s, weapon)
	for index := 1; index < len(wTime); index++ {
		wTime[index] = wTime[index].plus(wTime[index-1])
	}
	wTime[len(wTime)-1] = one
	var result interval
	for c, p := range cTime {
		if p.hi == 0 || !m.cover(s, c, 0) {
			continue
		}
		lo, hi := 0, len(wTime)-1
		for lo < hi {
			mid := lo + (hi-lo+1)/2
			if m.cover(s, c, mid) {
				lo = mid
			} else {
				hi = mid - 1
			}
		}
		result = result.plus(p.times(wTime[lo]))
	}
	return result
}
