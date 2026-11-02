package automation

import (
	"errors"
	"testing"
)

func TestNativeEmptyEditorCanCorroborateAnUnreadableVisualDraft(t *testing.T) {
	if !nativeEmptyEditor(&InputFrame{Text: "", Complete: true, Action: 6}, "message_editor") {
		t.Fatal("native empty message editor was rejected")
	}
	if corroborateEmptyEditor(nil, nil) || !corroborateEmptyEditor(nil, "") {
		t.Fatal("unreadable visual draft did not require a readable native empty editor")
	}
	for _, value := range []struct {
		frame *InputFrame
		kind  string
	}{
		{nil, "message_editor"},
		{&InputFrame{Text: "existing", Complete: true, Action: 6}, "message_editor"},
		{&InputFrame{Text: "", Complete: true, Action: 3}, "message_editor"},
		{&InputFrame{Text: "", Complete: true, Action: 6}, "search_input"},
	} {
		if nativeEmptyEditor(value.frame, value.kind) {
			t.Fatal("non-empty or mismatched native editor was trusted")
		}
	}
}

func TestInputRestoreRetainsOwnershipUntilConfirmed(t *testing.T) {
	for _, stage := range []string{"initial read", "select", "verification", "still selected"} {
		t.Run(stage, func(t *testing.T) {
			s := &Input{Original: "daily.keyboard/.IME", Changed: true}
			reads := 0
			err := s.restoreUsing(func() (string, error) {
				reads++
				if stage == "initial read" || stage == "verification" && reads == 2 {
					return "", errors.New("device disconnected")
				}
				return inputIME, nil
			}, func() error {
				if stage == "select" {
					return errors.New("device disconnected")
				}
				return nil
			})
			if err == nil || !s.Changed {
				t.Fatal("unconfirmed restoration lost its ownership")
			}
			reads = 0
			err = s.restoreUsing(func() (string, error) {
				reads++
				if reads == 1 {
					return inputIME, nil
				}
				return s.Original, nil
			}, func() error { return nil })
			if err != nil || s.Changed {
				t.Fatal("reconnected restoration was not confirmed", err)
			}
		})
	}
	s := &Input{Original: "daily.keyboard/.IME", Changed: true}
	if err := s.restoreUsing(func() (string, error) { return "user.choice/.IME", nil }, func() error { t.Fatal("user-selected keyboard was overwritten"); return nil }); err != nil || s.Changed {
		t.Fatal("user keyboard choice was not preserved")
	}
}
