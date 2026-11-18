package convene

import (
	"math/big"
	"strconv"
	"testing"
)

func testConfig() Config {
	c := Config{
		Resources: Resources{SpendAfter: true},
		Goals:     Goals{Character: 1, BuyCounts: true},
		Ownership: Ownership{Mode: "normal"},
		Rules:     Rules{FourMode: "absolute", FiveResetsFour: true},
		Strategy:  "optimal", Baseline: true, StateBudget: 100_000,
	}
	for i := range c.Rules.Five {
		c.Rules.Five[i] = make([]uint32, 80)
		c.Rules.Five[i][79] = partPerBillion
	}
	return c
}

func assertContains(t *testing.T, bounds Bounds, n, d int64) {
	t.Helper()
	l, _ := strconv.ParseUint(bounds.Lower, 10, 64)
	h, _ := strconv.ParseUint(bounds.Upper, 10, 64)
	x := big.NewRat(n, d)
	lo := big.NewRat(int64(l), int64(Scale))
	hi := big.NewRat(int64(h), int64(Scale))
	if lo.Cmp(x) > 0 || hi.Cmp(x) < 0 || h-l > 1000 {
		t.Fatalf("interval %v does not tightly enclose %s", bounds, x.RatString())
	}
}

func rows(t *testing.T, c Config) []ResultRow {
	t.Helper()
	result, err := Calculate(c, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range result.Rows {
		if row.Incomplete {
			t.Fatalf("unexpected state cutoff for %s", row.Strategy)
		}
	}
	return result.Rows
}

func TestNoStockAndHardPity(t *testing.T) {
	c := testConfig()
	c.Pools[character] = Pool{Pity5: 79, Pity4: 9, Up5: true, Up4: true}
	assertContains(t, rows(t, c)[0].Probability, 0, 1)
	c.Resources.Tides[character] = 1
	assertContains(t, rows(t, c)[0].Probability, 1, 1)
	c.Pools[character].Up5 = false
	assertContains(t, rows(t, c)[0].Probability, 1, 2)
}

func TestRecursiveRefundsAndMultiCopyTargets(t *testing.T) {
	c := testConfig()
	c.Goals = Goals{Weapon: 5, WeaponRank: true, HeldWeapon: 1}
	c.Resources.Tides[weapon] = 1
	c.Rules.Five[weapon][0] = partPerBillion
	got := rows(t, c)[0]
	assertContains(t, got.Probability, 1, 1)
	assertContains(t, *got.Baseline, 0, 1)
}

func TestJointSharedWalletAndOrdering(t *testing.T) {
	c := testConfig()
	c.Goals.Weapon, c.Compare = 1, true
	c.Resources.Astrite = 160
	c.Pools[character] = Pool{Pity5: 78, Pity4: 9, Up5: true}
	c.Pools[weapon].Pity5 = 79
	got := rows(t, c)
	assertContains(t, got[0].Probability, 0, 1)
	assertContains(t, got[1].Probability, 1, 1)
	assertContains(t, got[2].Probability, 1, 1)
	for _, row := range got {
		assertContains(t, *row.Baseline, 0, 1)
	}
	if len(got[2].Actions) != 2 || got[2].Actions[1].ID != "weapon" {
		t.Fatal("missing first-action comparison")
	}
}

func TestBlueReturnsOnlyOnThreeStarAndStockIsPerPool(t *testing.T) {
	c := testConfig()
	c.Goals = Goals{Weapon: 1}
	c.Pools[weapon].Pity5 = 78
	c.Resources.Tides[weapon] = 1
	c.Resources.Oscillated = 55
	c.Resources.OscStock = [2]int{7, 1}
	got := rows(t, c)[0]
	assertContains(t, got.Probability, 94, 100)
	assertContains(t, *got.Baseline, 0, 1)
	c.Resources.OscStock[weapon] = 0
	assertContains(t, rows(t, c)[0].Probability, 0, 1)
	c.Pools[weapon].Pity4 = 9
	c.Resources.OscStock[weapon] = 1
	assertContains(t, rows(t, c)[0].Probability, 0, 1)
}

func TestFourStarGuaranteeAndSharedOwnership(t *testing.T) {
	c := testConfig()
	c.Goals.Weapon, c.Farm = 1, true
	c.Goals.Character = 0
	c.Resources.Tides = [2]int{1, 1}
	c.Resources.Afterglow = 0
	c.Pools = [2]Pool{{Pity5: 9, Pity4: 9, Up4: true}, {Pity5: 78, Pity4: 9}}
	c.Ownership = Ownership{Mode: "detail",
		Four: []Character4{
			{Name: "A", Owned: 6, Up: true, WeaponWeight: 1}, {Name: "B", Up: true}, {Name: "C", Up: true},
		},
		Five: []Character5{{Name: "5"}}, WeaponWeights: [2]int{1, 0},
	}
	// After two 4-stars, 8 coral are available iff A appeared first and
	// the weapon pool rolled its non-UP item. Baseline payouts total 6.
	assertContains(t, rows(t, c)[0].Probability, 1, 6)
	c.Ownership.Four[0].Owned = 7
	assertContains(t, rows(t, c)[0].Probability, 2, 3)
	c.Pools[weapon].Up4 = true
	assertContains(t, rows(t, c)[0].Probability, 1, 3)
}

func TestOffBannerOverCapReward(t *testing.T) {
	c := testConfig()
	c.Goals = Goals{Character: 1, Weapon: 1}
	c.Resources.Tides[character] = 1
	c.Resources.SpendAfter = true
	c.Pools[character].Pity5 = 79
	c.Rules.Five[character][5] = partPerBillion
	c.Pools[weapon].Pity5 = 79
	c.Pools[weapon].Pity4 = 0
	c.Strategy = "characterFirst"
	c.Ownership.Mode = "bounds"
	// Inspect the actual return values as well as the containment property.
	r := newRoster(Ownership{}, "normal")
	if r.rolls(0, fiveOff)[0].reward != 45 {
		t.Fatal("incorrect ordinary loss refund")
	}
	r = newRoster(Ownership{}, "maxed")
	if r.rolls(0, fiveOff)[0].reward != 70 {
		t.Fatal("incorrect saturated loss refund")
	}
	result := rows(t, c)[0].Probability
	l, _ := strconv.ParseUint(result.Lower, 10, 64)
	h, _ := strconv.ParseUint(result.Upper, 10, 64)
	if l >= h {
		t.Fatalf("ownership bounds must reflect the material refund difference: %+v", result)
	}
}

func TestWavebandEligibilityAndNoDoubleSpend(t *testing.T) {
	c := testConfig()
	c.Goals = Goals{Character: 2, CharacterChain: true, Wavebands: 2, HeldCharacter: 1, TargetCopies: 1}
	c.Resources.Afterglow = 360
	assertContains(t, rows(t, c)[0].Probability, 1, 1)
	c.Goals.HeldCharacter, c.Goals.TargetCopies = 0, 0
	assertContains(t, rows(t, c)[0].Probability, 0, 1)
	c.Goals.HeldCharacter, c.Goals.TargetCopies = 1, 1
	c.Goals.Weapon = 1
	c.Pools[weapon].Pity5 = 79
	got := rows(t, c)[0]
	assertContains(t, got.Probability, 1, 1) // Weapon first, then redeem with its refund.
	assertContains(t, *got.Baseline, 0, 1)
}

func TestIndependentExactRationalEnumerator(t *testing.T) {
	// Exhaustively enumerate one fixed joint setup with nontrivial probabilities,
	// shared balances, and reward-funded continuations using rational arithmetic.
	c := testConfig()
	c.Goals.Weapon = 1
	c.Resources.Astrite = 320
	c.Resources.Afterglow = 5
	c.Pools = [2]Pool{{Pity5: 76, Pity4: 9}, {Pity5: 77, Pity4: 9}}
	for p := range c.Rules.Five {
		c.Rules.Five[p][76], c.Rules.Five[p][77], c.Rules.Five[p][78] = 200_000_000, 300_000_000, 500_000_000
	}
	c.Strategy = "characterFirst"
	var exact func(cPity, wPity, cFour, wFour, resources int, needC, needW, guaranteed bool) *big.Rat
	exact = func(cp, wp, cf, wf, money int, needC, needW, guaranteed bool) *big.Rat {
		if !needC && !needW {
			return big.NewRat(1, 1)
		}
		if money < 8 {
			return new(big.Rat)
		}
		money -= 8
		p5 := c.Rules.Five[weapon][wp]
		p4Pity := wf
		if needC {
			p5, p4Pity = c.Rules.Five[character][cp], cf
		}
		p4 := min(uint32(60_000_000), partPerBillion-p5)
		if p4Pity == 9 {
			p4 = partPerBillion - p5
		}
		total := new(big.Rat)
		add := func(n, d int64, q *big.Rat) {
			total.Add(total, new(big.Rat).Mul(big.NewRat(n, d), q))
		}
		if p5 > 0 {
			if needC {
				if guaranteed {
					add(int64(p5), partPerBillion, exact(0, wp, 0, wf, money+15, false, needW, false))
				} else {
					add(int64(p5), 2*partPerBillion, exact(0, wp, 0, wf, money+15, false, needW, false))
					add(int64(p5), 2*partPerBillion, exact(0, wp, 0, wf, money+45, true, needW, true))
				}
			} else {
				add(int64(p5), partPerBillion, exact(cp, 0, cf, 0, money+15, needC, false, guaranteed))
			}
		}
		if p4 > 0 {
			if needC {
				add(int64(p4), partPerBillion, exact(cp+1, wp, 0, wf, money+3, needC, needW, guaranteed))
			} else {
				add(int64(p4), partPerBillion, exact(cp, wp+1, cf, 0, money+3, needC, needW, guaranteed))
			}
		}
		if p3 := partPerBillion - p5 - p4; p3 > 0 {
			if needC {
				add(int64(p3), partPerBillion, exact(cp+1, wp, cf+1, wf, money, needC, needW, guaranteed))
			} else {
				add(int64(p3), partPerBillion, exact(cp, wp+1, cf, wf+1, money, needC, needW, guaranteed))
			}
		}
		return total
	}
	want := exact(76, 77, 9, 9, 21, true, true, false)
	if !want.Num().IsInt64() || !want.Denom().IsInt64() {
		t.Fatalf("unexpectedly large verification fraction %s", want)
	}
	assertContains(t, rows(t, c)[0].Probability, want.Num().Int64(), want.Denom().Int64())
}

func TestInvalidInputsRejected(t *testing.T) {
	c := testConfig()
	c.Pools[weapon].Pity4 = 8
	if _, err := Calculate(c, nil); err == nil {
		t.Fatal("invalid pity accepted")
	}
}
