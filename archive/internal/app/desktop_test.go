package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDataDirectoryKeepsExistingWindowsLocationAndOverride(t *testing.T) {
	t.Setenv("POR_AUTO_DATA_DIR", "")
	root := t.TempDir()
	t.Setenv("LOCALAPPDATA", root)
	got, err := dataDir("windows")
	if err != nil || got != filepath.Join(root, "com.por.wechatreader") {
		t.Fatalf("Windows data location changed: %q %v", got, err)
	}
	override := t.TempDir()
	t.Setenv("POR_AUTO_DATA_DIR", override)
	got, err = dataDir("windows")
	if err != nil || got != override {
		t.Fatalf("Override ignored: %q %v", got, err)
	}
}

func TestInvalidThemePreferencesFallBackWithoutChangingSavedFile(t *testing.T) {
	d := New()
	d.root = t.TempDir()
	path := filepath.Join(d.root, "ui-settings.json")
	if err := os.WriteFile(path, []byte("null"), 0600); err != nil {
		t.Fatal(err)
	}
	settings := d.readSettings()
	if settings["theme"] != "system" || settings["autoCheck"] != true {
		t.Fatal("invalid settings did not use safe defaults")
	}
	if raw, _ := os.ReadFile(path); string(raw) != "null" {
		t.Fatal("original preferences were overwritten")
	}
}
