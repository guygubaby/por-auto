package automation

import (
	"context"
	"testing"
)

func TestProgressCountsOnlyCompletedSteps(t *testing.T) {
	r := NewRuntime(context.Background(), NewCredentials())
	var events []Object
	d := &DeviceIO{Ctx: r.Ctx, Folder: t.TempDir(), ADB: ADB{Serial: "A"}, Total: 2, Emit: func(_ string, value any) { events = append(events, object(value)) }}
	if err := r.VM.Set("io", d.Bind(r)); err != nil {
		t.Fatal(err)
	}
	for i, log := range []string{"step_started", "step_completed", "step_started"} {
		if _, err := r.VM.RunString(`io.log("` + log + `", {name:"步骤"})`); err != nil {
			t.Fatal(err)
		}
		want := []float64{0, 1, 1}[i]
		if len(events) != i+1 || num(events[i]["step"]) != want {
			t.Fatalf("%s: progress=%v, want completed steps %v", log, events, want)
		}
	}
	if d.Step == d.Total {
		t.Fatal("failed final step would show full progress")
	}
	if _, err := r.VM.RunString(`io.log("step_completed", {name:"最后一步"})`); err != nil {
		t.Fatal(err)
	}
	if num(events[len(events)-1]["step"]) != 2 {
		t.Fatal("successful final step did not complete progress")
	}
}
