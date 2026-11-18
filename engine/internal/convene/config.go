package convene

import (
	"errors"
	"fmt"
)

const (
	character = iota
	weapon
)

const (
	partPerBillion = 1_000_000_000
	maxStates      = 8_000_000
	wavebandCost   = 360
	afterglowCost  = 8
	oscillatedCost = 70
	oscUnits       = oscillatedCost / 5
)

type Resources struct {
	Astrite    int    `json:"astrite"`
	Lunite     int    `json:"lunite"`
	Tides      [2]int `json:"tides"`
	Afterglow  int    `json:"afterglow"`
	Oscillated int    `json:"oscillated"`
	OscStock   [2]int `json:"oscStock"`
	SpendAfter bool   `json:"spendAfterglow"`
}

type Pool struct {
	Pity5 int  `json:"pity5"`
	Pity4 int  `json:"pity4"`
	Up5   bool `json:"up5"`
	Up4   bool `json:"up4"`
}

type Goals struct {
	Character      int  `json:"character"`
	Weapon         int  `json:"weapon"`
	CharacterChain bool `json:"characterChain"`
	HeldCharacter  int  `json:"heldCharacter"`
	TargetCopies   int  `json:"targetCopies"`
	HeldWeapon     int  `json:"heldWeapon"`
	WeaponRank     bool `json:"weaponRank"`
	Wavebands      int  `json:"wavebands"`
	BuyCounts      bool `json:"buyCounts"`
}

type Character4 struct {
	Name            string `json:"name"`
	Owned           int    `json:"owned"`
	Up              bool   `json:"up"`
	CharacterWeight int    `json:"characterWeight"`
	WeaponWeight    int    `json:"weaponWeight"`
}

type Character5 struct {
	Name  string `json:"name"`
	Owned int    `json:"owned"`
}

type Ownership struct {
	Mode          string       `json:"mode"`
	Four          []Character4 `json:"four"`
	Five          []Character5 `json:"five"`
	WeaponWeights [2]int       `json:"weaponWeights"`
}

type Rules struct {
	Five           [2][]uint32 `json:"five"`
	FourMode       string      `json:"fourMode"`
	FiveResetsFour bool        `json:"fiveResetsFour"`
}

type Config struct {
	Resources   Resources `json:"resources"`
	Pools       [2]Pool   `json:"pools"`
	Goals       Goals     `json:"goals"`
	Ownership   Ownership `json:"ownership"`
	Rules       Rules     `json:"rules"`
	Strategy    string    `json:"strategy"`
	Farm        bool      `json:"farm"`
	Compare     bool      `json:"compare"`
	Baseline    bool      `json:"baseline"`
	StateBudget int       `json:"stateBudget"`
}

func in(n, lo, hi int) bool { return lo <= n && n <= hi }

func (c Config) Validate() error {
	r, g := c.Resources, c.Goals
	for _, value := range []int{r.Astrite, r.Lunite, r.Afterglow, r.Oscillated} {
		if !in(value, 0, 100_000_000) {
			return errors.New("星声、月相及珊瑚须为 0 至 100,000,000 的整数")
		}
	}
	for p := range c.Pools {
		if !in(r.Tides[p], 0, 60_000) || !in(r.OscStock[p], 0, 7) {
			return errors.New("波纹须为 0 至 60,000，残振兑换库存须为 0 至 7")
		}
		pool := c.Pools[p]
		if !in(pool.Pity5, 0, 79) || !in(pool.Pity4, 0, 9) || pool.Pity4 > pool.Pity5 && c.Rules.FiveResetsFour {
			return errors.New("请检查垫抽数。五星为 0–79，四星为 0–9。五星清零模型中四星垫抽不超过五星")
		}
		five := c.Rules.Five[p]
		if len(five) != 80 || five[79] != partPerBillion {
			return errors.New("每条五星曲线须有 80 项，第 80 项须为 100%")
		}
		for i, probability := range five {
			if probability > partPerBillion {
				return fmt.Errorf("五星曲线第 %d 项超出 0–100%%", i+1)
			}
		}
	}
	if !in(g.Character, 0, 30) || !in(g.Weapon, 0, 30) || g.Character == 0 && g.Weapon == 0 {
		return errors.New("请选择目标。新增份数须为 1 至 30")
	}
	if g.CharacterChain && g.Character > 7 || !in(g.HeldCharacter, 0, 7) || !in(g.TargetCopies, 0, 7) ||
		g.WeaponRank && g.Weapon > 5 || !in(g.HeldWeapon, 0, 30) ||
		!in(g.Wavebands, 0, 2) || g.Wavebands > 0 && (!g.CharacterChain || g.Character == 0) {
		return errors.New("请检查共鸣链、已有份数、回音频段库存及武器谐振等级")
	}
	if c.Rules.FourMode != "absolute" && c.Rules.FourMode != "conditional" {
		return errors.New("未知的四星判定方式")
	}
	switch c.Strategy {
	case "optimal", "characterFirst", "weaponFirst":
	default:
		return errors.New("未知的抽取策略")
	}
	if !in(c.StateBudget, 10_000, maxStates) {
		return errors.New("状态预算须在 10,000 至 8,000,000 之间")
	}
	switch c.Ownership.Mode {
	case "bounds", "normal", "maxed":
		return nil
	case "detail":
		up := 0
		var characterWeight, weaponWeight int
		if len(c.Ownership.Four) > 64 || len(c.Ownership.Five) < 1 || len(c.Ownership.Five) > 32 {
			return errors.New("四星角色最多 64 位，常驻五星角色须为 1 至 32 位")
		}
		for _, item := range c.Ownership.Four {
			if !in(item.Owned, 0, 7) || !in(item.CharacterWeight, 0, 1000) || !in(item.WeaponWeight, 0, 1000) {
				return errors.New("四星持有份数须为 0–7，掉落权重须为 0–1000")
			}
			if item.Up {
				up++
			} else {
				characterWeight += item.CharacterWeight
			}
			weaponWeight += item.WeaponWeight
		}
		for _, item := range c.Ownership.Five {
			if !in(item.Owned, 0, 7) {
				return errors.New("常驻五星持有份数须为 0–7")
			}
		}
		if up != 3 {
			return errors.New("逐位追踪时须指定 3 位角色池 UP 四星")
		}
		weights := c.Ownership.WeaponWeights
		if !in(weights[0], 0, 64_000) || !in(weights[1], 0, 64_000) ||
			characterWeight+weights[0] == 0 || weaponWeight+weights[1] == 0 {
			return errors.New("每池的非 UP 四星总权重须大于 0，武器总权重须为 0–64000")
		}
		return nil
	default:
		return errors.New("未知的持有量配置")
	}
}

func (g Goals) remaining() [2]uint8 {
	characterGoal, weaponGoal := g.Character, g.Weapon
	if g.CharacterChain {
		characterGoal = max(0, characterGoal-g.HeldCharacter)
	}
	if g.WeaponRank {
		weaponGoal = max(0, weaponGoal-g.HeldWeapon)
	}
	return [2]uint8{uint8(characterGoal), uint8(weaponGoal)}
}

type pity uint16

const (
	fiveGuarantee = 1 << 11
	fourGuarantee = 1 << 12
)

func makePity(five, four int, upFive, upFour bool) pity {
	p := pity(five | four<<7)
	if upFive {
		p |= fiveGuarantee
	}
	if upFour {
		p |= fourGuarantee
	}
	return p
}

func (p pity) five() int { return int(p & 127) }
func (p pity) four() int { return int(p>>7) & 15 }
func (p pity) up5() bool { return p&fiveGuarantee != 0 }
func (p pity) up4() bool { return p&fourGuarantee != 0 }

type state struct {
	shared   uint32
	coral    uint32
	hold     uint32
	pool     [2]pity
	personal [2]uint16
	need     [2]uint8
	quota    [2]uint8
	blue     uint8
	owned    uint8
	shop     uint8
}

func initial(c Config, holds uint32) state {
	r, g := c.Resources, c.Goals
	s := state{
		shared: uint32((r.Astrite+r.Lunite)/160) * afterglowCost,
		hold:   holds, need: g.remaining(),
		owned: uint8(g.TargetCopies), shop: uint8(g.Wavebands),
	}
	if g.CharacterChain && g.HeldCharacter == 0 {
		s.owned = 0
	}
	if r.SpendAfter {
		s.shared += uint32(r.Afterglow)
	}
	if s.shop != 0 {
		s.coral = uint32(r.Afterglow)
	}
	for index, pool := range c.Pools {
		s.personal[index] = uint16(r.Tides[index])
		s.quota[index] = uint8(r.OscStock[index])
		s.pool[index] = makePity(pool.Pity5, pool.Pity4, index == character && pool.Up5, pool.Up4)
	}
	s.blue = uint8(min(r.Oscillated/5, oscUnits*(int(s.quota[0])+int(s.quota[1]))))
	return s
}
