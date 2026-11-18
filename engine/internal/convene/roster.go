package convene

import "slices"

const (
	fourUp = iota
	fourOffCharacter
	fourOffWeapon
	fiveOff
	bucketCount
)

type group struct {
	start, length int
	weight        [bucketCount]int
}

type item struct {
	hold   uint32
	reward int
	prob   interval
}

type itemKey struct {
	hold   uint32
	bucket int
}

type roster struct {
	groups  []group
	layout  []string
	indices map[string]uint32
	cache   map[itemKey][]item
	weights [bucketCount]int
	weapons [bucketCount]int
	mode    string
}

func newRoster(input Ownership, mode string) *roster {
	if mode == fullFourPreset || mode == fullFourHigh {
		// Saturated four-stars all pay the same reward within each item type.
		// A single synthetic character can stand in for each bucket's roster.
		input.Four = []Character4{{Owned: 7, Up: true}, {Owned: 7}}
		for pool, counts := range input.FourPools {
			var roles, weapons int
			switch {
			case counts != nil:
				roles, weapons = counts.offBanner(pool)
			case mode == fullFourHigh:
				roles = 1
			default:
				weapons = 1
			}
			if pool == character {
				input.Four[1].CharacterWeight = roles
			} else {
				input.Four[1].WeaponWeight = roles
			}
			input.WeaponWeights[pool] = weapons
		}
		mode = "detail"
	}
	r := &roster{mode: mode}
	if mode != "detail" {
		return r
	}
	r.indices = make(map[string]uint32)
	r.cache = make(map[itemKey][]item)
	var groups [][]byte
	add := func(weights [bucketCount]int, copies int) {
		if weights == ([bucketCount]int{}) {
			return
		}
		index := slices.IndexFunc(r.groups, func(g group) bool { return g.weight == weights })
		if index < 0 {
			index = len(r.groups)
			r.groups = append(r.groups, group{weight: weights})
			groups = append(groups, nil)
		}
		groups[index] = append(groups[index], byte(copies))
		for bucket, weight := range weights {
			r.weights[bucket] += weight
		}
	}
	for _, role := range input.Four {
		if role.Up {
			add([bucketCount]int{1, 0, role.WeaponWeight, 0}, role.Owned)
		} else {
			add([bucketCount]int{0, role.CharacterWeight, role.WeaponWeight, 0}, role.Owned)
		}
	}
	for _, role := range input.Five {
		add([bucketCount]int{0, 0, 0, 1}, role.Owned)
	}
	r.weapons[fourOffCharacter] = input.WeaponWeights[character]
	r.weapons[fourOffWeapon] = input.WeaponWeights[weapon]
	var layout []byte
	for index, counts := range groups {
		slices.Sort(counts)
		r.groups[index].start = len(layout)
		r.groups[index].length = len(counts)
		layout = append(layout, counts...)
	}
	r.intern(string(layout))
	return r
}

func (r *roster) intern(layout string) uint32 {
	if id, exists := r.indices[layout]; exists {
		return id
	}
	id := uint32(len(r.layout))
	r.layout = append(r.layout, layout)
	r.indices[layout] = id
	return id
}

func (r *roster) rolls(hold uint32, bucket int) []item {
	base, saturated := 3, 8
	if bucket == fiveOff {
		base, saturated = 45, 70
	}
	if r.mode != "detail" {
		if r.mode == "maxed" {
			base = saturated
		}
		return []item{{hold, base, one}}
	}
	key := itemKey{hold, bucket}
	if cached, ok := r.cache[key]; ok {
		return cached
	}
	layout := r.layout[hold]
	total := r.weights[bucket] + r.weapons[bucket]
	if total == 0 {
		// The full-four preset uses ordinary off-banner five-star refunds
		// when the player has left those characters unspecified.
		return []item{{hold, base, one}}
	}
	results := make([]item, 0, 8)
	if weight := r.weapons[bucket]; weight != 0 {
		results = append(results, item{hold, base, fraction(uint64(weight), uint64(total))})
	}
	for _, g := range r.groups {
		weight := g.weight[bucket]
		if weight == 0 {
			continue
		}
		end := g.start + g.length
		for start := g.start; start < end; {
			copies := layout[start]
			next := start + 1
			for next < end && layout[next] == copies {
				next++
			}
			p := fraction(uint64(weight*(next-start)), uint64(total))
			outcome := item{hold, saturated, p}
			if copies < 7 {
				updated := []byte(layout)
				// Increment the final item with this count to preserve sorted order.
				updated[next-1]++
				outcome = item{r.intern(string(updated)), base, p}
			}
			results = append(results, outcome)
			start = next
		}
	}
	if len(r.cache) < 30_000 {
		r.cache[key] = results
	}
	return results
}
