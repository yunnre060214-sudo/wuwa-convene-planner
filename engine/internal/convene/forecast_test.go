package convene

import (
	"reflect"
	"testing"
)

func calculateForecast(t *testing.T, c Config) ResourceForecast {
	t.Helper()
	result, err := Calculate(c, nil)
	if err != nil {
		t.Fatal(err)
	}
	return result.Resources
}

func assertDrawMean(t *testing.T, estimate *DrawEstimate, want float64) {
	t.Helper()
	if estimate == nil || estimate.Mean != want {
		t.Fatalf("got %+v, want an estimate of %g draws", estimate, want)
	}
}

func TestForecastFollowsRefundsPastTheGoal(t *testing.T) {
	c := testConfig()
	c.Goals = Goals{Weapon: 1}
	c.Resources.Tides[weapon] = 1
	c.Resources.Afterglow = 1
	c.Pools[weapon].Pity5 = 79
	got := calculateForecast(t, c)
	if got.Available != 1 || got.Successful != got.Trials {
		t.Fatalf("unexpected draw forecast: %+v", got)
	}
	assertDrawMean(t, got.Total, 3)
	assertDrawMean(t, got.Leftover, 2)
}

func TestForecastKeepsCompletedPoolsTicketsAndSharedQuota(t *testing.T) {
	c := testConfig()
	c.Goals.Weapon = 1
	c.Pools[character].Up5 = true
	c.Rules.Five[character][0], c.Rules.Five[weapon][0] = partPerBillion, partPerBillion
	c.Resources = Resources{
		Astrite: 159, Lunite: 1, Tides: [2]int{5, 3}, Oscillated: 140, OscStock: [2]int{1, 2},
	}
	got := calculateForecast(t, c)
	if got.Available != 11 {
		t.Fatalf("wrong initial stock: %+v", got)
	}
	assertDrawMean(t, got.Total, 11)
	assertDrawMean(t, got.Leftover, 9)
}

func TestForecastLeftoverUsesOnlySuccessfulPaths(t *testing.T) {
	c := testConfig()
	c.Goals.Weapon = 1
	c.Pools[character].Pity5, c.Pools[weapon].Pity5 = 79, 79
	c.Resources = Resources{Tides: [2]int{1, 3}}
	c.Strategy = "characterFirst"
	got := calculateForecast(t, c)
	if got.Successful <= got.Trials/3 || got.Successful >= 2*got.Trials/3 {
		t.Fatalf("expected roughly half the plans to succeed: %+v", got)
	}
	assertDrawMean(t, got.Total, 4)
	assertDrawMean(t, got.Leftover, 2)
	if again := calculateForecast(t, c); !reflect.DeepEqual(got, again) {
		t.Fatalf("forecast should be reproducible: %+v vs %+v", got, again)
	}
}

func TestForecastChargesWavebandPurchaseToSharedWalletOnce(t *testing.T) {
	c := testConfig()
	c.Goals = Goals{Character: 2, CharacterChain: true, HeldCharacter: 1, TargetCopies: 1, Wavebands: 1}
	c.Resources.Afterglow = 360
	got := calculateForecast(t, c)
	if got.Available != 45 || got.MeanWavebands != 1 {
		t.Fatalf("unexpected stock or waveband count: %+v", got)
	}
	assertDrawMean(t, got.Total, 0)
	assertDrawMean(t, got.Leftover, 0)
}

func TestForecastMarksNonDepletingWallet(t *testing.T) {
	c := testConfig()
	c.Goals = Goals{Weapon: 1}
	c.Resources.Tides[weapon] = 1
	c.Rules.Five[weapon][0] = partPerBillion
	got := calculateForecast(t, c)
	if !got.TotalLimited || got.PlanLimited || got.Total != nil {
		t.Fatalf("an endlessly replenishing wallet has no sampled final total: %+v", got)
	}
	assertDrawMean(t, got.Leftover, 1)
}

func TestForecastDoesNotInventLeftoverForImpossiblePlan(t *testing.T) {
	got := calculateForecast(t, testConfig())
	assertDrawMean(t, got.Total, 0)
	if got.Leftover != nil || got.Successful != 0 {
		t.Fatalf("no successful paths should leave the estimate blank: %+v", got)
	}
}
