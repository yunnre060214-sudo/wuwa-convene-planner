package convene

import (
	"math/bits"
	"strconv"
)

// Scale is the common denominator of all certified probability endpoints.
const Scale uint64 = 1 << 62

type interval struct{ lo, hi uint64 }

var (
	zero    = interval{}
	one     = interval{Scale, Scale}
	unknown = interval{0, Scale}
)

func fraction(n, d uint64) interval {
	hi, lo := bits.Mul64(n, Scale)
	floor, rem := bits.Div64(hi, lo, d)
	ceil := floor
	if rem != 0 {
		ceil++
	}
	return interval{floor, ceil}
}

func (p interval) plus(q interval) interval {
	return interval{min(Scale, p.lo+q.lo), min(Scale, p.hi+q.hi)}
}

func (p interval) times(q interval) interval {
	hi, lo := bits.Mul64(p.lo, q.lo)
	floor := hi<<2 | lo>>62
	hi, lo = bits.Mul64(p.hi, q.hi)
	ceil := hi<<2 | lo>>62
	if lo&(Scale-1) != 0 {
		ceil++
	}
	return interval{floor, ceil}
}

func (p interval) complement() interval { return interval{Scale - p.hi, Scale - p.lo} }

func maximum(p, q interval) interval {
	return interval{max(p.lo, q.lo), max(p.hi, q.hi)}
}

type Bounds struct {
	Lower string `json:"lower"`
	Upper string `json:"upper"`
}

func (p interval) bounds() Bounds {
	return Bounds{strconv.FormatUint(p.lo, 10), strconv.FormatUint(p.hi, 10)}
}
