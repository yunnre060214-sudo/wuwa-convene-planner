package convene

import (
	"testing"
)

func TestFullFourPresetAtTheRefundThreshold(t *testing.T) {
	c := testConfig()
	c.Ownership = Ownership{Mode: fullFourPreset}
	c.Resources.Tides[character] = 1
	c.Pools[character] = Pool{Pity5: 78, Pity4: 9, Up5: true}

	result, err := Calculate(c, nil)
	if err != nil {
		t.Fatal(err)
	}
	wantLower := fraction(1, 2).bounds().Lower
	if result.Uncertainty != "fullFourRange" || result.Rows[0].Probability != (Bounds{wantLower, one.bounds().Upper}) {
		t.Fatalf("unknown four-star mix should give 50%%–100%%, got %+v", result)
	}

	// Off-banner four-stars include 9 characters and 15 weapons. The
	// character route refunds enough for one more draw at hard pity.
	c.Ownership.FourPools[character] = &FourStarCounts{Characters: 12, Weapons: 15}
	result, err = Calculate(c, nil)
	if err != nil || result.Uncertainty != fullFourPreset {
		t.Fatalf("an unplayed weapon pool should not widen the result: %+v, %v", result, err)
	}
	assertContains(t, result.Rows[0].Probability, 11, 16)

	// On the weapon banner, the featured option pays three coral. Of the
	// off-banner items, 12 out of 24 pay the saturated character reward.
	c.Goals = Goals{Weapon: 1}
	c.Pools[weapon] = Pool{Pity5: 78, Pity4: 9}
	c.Resources.Tides = [2]int{0, 1}
	c.Ownership.FourPools[weapon] = &FourStarCounts{Characters: 12, Weapons: 15}
	assertContains(t, rows(t, c)[0].Probability, 1, 4)
}

func TestFullFourPresetKeepsFiveStarHoldingsSeparate(t *testing.T) {
	input := Ownership{Mode: fullFourPreset}
	for _, scenario := range []string{fullFourPreset, fullFourHigh} {
		got := newRoster(input, scenario).rolls(0, fiveOff)
		if len(got) != 1 || got[0].reward != 45 {
			t.Fatalf("preset must not treat a five-star as saturated by default: %+v", got)
		}
	}
	input.Five = []Character5{{Name: "Standard", Owned: 7}}
	got := newRoster(input, fullFourPreset).rolls(0, fiveOff)
	if len(got) != 1 || got[0].reward != 70 {
		t.Fatalf("preset should use an explicitly entered five-star roster: %+v", got)
	}
}

func TestFullFourPresetRejectsInvalidPoolTotals(t *testing.T) {
	c := testConfig()
	c.Ownership = Ownership{Mode: fullFourPreset}
	c.Ownership.FourPools[character] = &FourStarCounts{Characters: 2, Weapons: 15}
	if err := c.Validate(); err == nil {
		t.Fatal("accepted a character pool with fewer than three featured four-stars")
	}
	c.Ownership.FourPools[character] = &FourStarCounts{Characters: 3, Weapons: 0}
	if err := c.Validate(); err == nil {
		t.Fatal("accepted a pool without off-banner four-stars")
	}
	c.Ownership.FourPools[character] = nil
	if err := c.Validate(); err != nil {
		t.Fatalf("empty optional pool counts must allow the preset: %v", err)
	}
}
