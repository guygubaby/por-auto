package automation

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func launchTestADB(t *testing.T) (ADB, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake ADB requires a POSIX shell")
	}
	folder := t.TempDir()
	t.Setenv("POR_TEST_ADB_DIR", folder)
	path := filepath.Join(folder, "adb")
	script := `#!/bin/sh
printf '%s\n' "$*" >> "$POR_TEST_ADB_DIR/commands"
case "$*" in
  "shell cmd statusbar collapse") rm -f "$POR_TEST_ADB_DIR/shade" ;;
  "shell input keyevent KEYCODE_HOME") : ;;
  "shell input keyevent KEYCODE_BACK") printf x >> "$POR_TEST_ADB_DIR/backs" ;;
  "shell am start "*) echo 'Starting: Intent' ;;
  "shell dumpsys window policy") echo 'showing=false' ;;
  "shell dumpsys window windows")
    if [ -f "$POR_TEST_ADB_DIR/shade" ]; then
      echo 'Window #0 Window{shade u0 StatusBar}:'
      echo '  package=com.android.systemui'
      echo 'mCurrentFocus=Window{shade u0 StatusBar}'
    elif [ -f "$POR_TEST_ADB_DIR/ready" ]; then
      echo 'mCurrentFocus=Window{main u0 com.tencent.wework/.launch.WwMainActivity}'
    else
      echo 'mCurrentFocus=Window{launcher u0 com.bbk.launcher2/.Launcher}'
    fi ;;
  *) echo "unexpected ADB command: $*" >&2; exit 1 ;;
esac
`
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	return ADB{Path: path}, folder
}

func TestLaunchClosesNotificationShade(t *testing.T) {
	a, folder := launchTestADB(t)
	for _, name := range []string{"shade", "ready"} {
		if err := os.WriteFile(filepath.Join(folder, name), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := a.Launch(ctx, "com.tencent.wework", ".launch.LaunchSplashActivity"); err != nil {
		t.Fatal(err)
	}
	commands, err := os.ReadFile(filepath.Join(folder, "commands"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(commands), "shell cmd statusbar collapse\nshell input keyevent KEYCODE_HOME\nshell am start ") {
		t.Fatalf("notification shade and home were not reset before launch: %s", commands)
	}
}

func TestLaunchWaitsPastTwelveSeconds(t *testing.T) {
	a, folder := launchTestADB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ready := time.AfterFunc(13*time.Second, func() {
		if err := os.WriteFile(filepath.Join(folder, "ready"), nil, 0600); err != nil {
			t.Error(err)
		}
	})
	defer ready.Stop()
	if _, err := a.Launch(ctx, "com.tencent.wework", ".launch.LaunchSplashActivity"); err != nil {
		t.Fatal(err)
	}
}

func TestLaunchWaitingCanBeCanceled(t *testing.T) {
	a, _ := launchTestADB(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop := time.AfterFunc(time.Second, cancel)
	defer stop.Stop()
	if _, err := a.Launch(ctx, "com.tencent.wework", ".launch.LaunchSplashActivity"); !errors.Is(err, context.Canceled) {
		t.Fatalf("launch did not preserve cancellation: %v", err)
	}
}

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
	if err := awaitForeground(context.Background(), "com.tencent.mm", func() (string, bool, error) {
		calls++
		if calls > 6 {
			return "com.tencent.mm", false, nil
		}
		return "", false, nil
	}); err != nil || calls != 7 {
		t.Fatalf("missing focus did not wait for recovery: calls=%d error=%v", calls, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := awaitForeground(ctx, "com.tencent.mm", func() (string, bool, error) { t.Fatal("canceled read was executed"); return "", false, nil }); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation was lost")
	}
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	if err := awaitForeground(ctx, "com.tencent.mm", func() (string, bool, error) { cancel(); return "", false, nil }); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation during a transition was lost")
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
