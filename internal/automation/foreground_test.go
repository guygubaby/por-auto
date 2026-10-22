package automation

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestForegroundWaitsOnlyForMissingFocus(t *testing.T) {
	for _, tc := range []struct {
		name, firstOwner string
		locked           bool
		err              error
		wantCalls        int
		wantError        bool
	}{
		{"transition", "", false, nil, 2, false},
		{"foreign app", "com.android.systemui", false, nil, 1, true},
		{"lock screen", "", true, nil, 1, true},
		{"ADB failure", "", false, errors.New("unavailable"), 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			err := awaitForeground(context.Background(), "com.tencent.mm", func() (string, bool, error) {
				calls++
				if calls == 1 {
					return tc.firstOwner, tc.locked, tc.err
				}
				return "com.tencent.mm", false, nil
			})
			if calls != tc.wantCalls || (err != nil) != tc.wantError {
				t.Fatalf("calls=%d error=%v", calls, err)
			}
		})
	}
	calls := 0
	if err := awaitForeground(context.Background(), "com.tencent.mm", func() (string, bool, error) { calls++; return "", false, nil }); err == nil || calls != 4 {
		t.Fatalf("missing focus did not stop after four reads: calls=%d error=%v", calls, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := awaitForeground(ctx, "com.tencent.mm", func() (string, bool, error) { t.Fatal("canceled read was executed"); return "", false, nil }); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation was lost")
	}
}

func TestForegroundUsesExactFocusedWindowOwnerIncludingPopup(t *testing.T) {
	if focusedPackage("mCurrentFocus=null\nmFocusedApp=AppWindowToken{com.tencent.mm/.ui.LauncherUI}") != "" {
		t.Fatal("background activity was trusted")
	}
	if focusedPackage("mCurrentFocus=Window{main u0 com.bbk.launcher2/.Launcher}\nmFocusedApp=AppWindowToken{com.tencent.mm/.ui.LauncherUI}") != "com.bbk.launcher2" {
		t.Fatal("launcher focus was ignored")
	}
	windows := "Window #1 Window{bad u0 PopupWindow:other}:\n package=other.app\nWindow #2 Window{match u0 PopupWindow:123}:\n mOwnerUid=10163 package=com.tencent.mm appop=NONE\nWindow #3 Window{main u0 com.tencent.mm/.ui.LauncherUI}:\n package=com.tencent.mm\n mCurrentFocus=Window{match u0 PopupWindow:123}\n mFocusedApp=AppWindowToken{com.tencent.mm/.ui.LauncherUI}"
	if focusedPackage(windows) != "com.tencent.mm" {
		t.Fatal("WeChat menu owner could not be read")
	}
	if focusedPackage(strings.Replace(windows, "mOwnerUid=10163 package=com.tencent.mm", "mOwnerUid=10163 package=com.android.systemui", 1)) != "com.android.systemui" {
		t.Fatal("notification was mistaken for WeChat")
	}
	if focusedPackage(strings.Replace(windows, "mOwnerUid=10163 package=com.tencent.mm appop=NONE", "mOwnerUid=10163", 1)) != "" {
		t.Fatal("another window's owner was trusted")
	}
	if owner, app := focusedPackages("mCurrentFocus=null\nmFocusedApp=AppWindowToken{abc u0 com.tencent.mm/.ui.chatting.variants.ChattingMainUI t5}"); owner != "" || app != "com.tencent.mm" {
		t.Fatal("transient focused app was not retained for bounded retry")
	}
	if owner, app := focusedPackages("mCurrentFocus=null\nmFocusedApp=AppWindowToken{abc u0 com.bbk.launcher2/.Launcher t5}"); owner != "" || app != "com.bbk.launcher2" {
		t.Fatal("focused app fallback was not restricted to the target")
	}
}
