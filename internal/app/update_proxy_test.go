package app

import (
	"strings"
	"testing"
)

func TestMacOSUpdateProxy(t *testing.T) {
	settings := `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : proxy.example
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
}`
	for _, tt := range []struct {
		name, settings, scheme, want string
		wantError                    bool
	}{
		{"HTTPS uses HTTP CONNECT proxy", settings, "https", "http://127.0.0.1:7890", false},
		{"HTTP uses its own proxy", settings, "http", "http://proxy.example:8080", false},
		{"disabled proxy", strings.ReplaceAll(settings, "HTTPSEnable : 1", "HTTPSEnable : 0"), "https", "", false},
		{"no system proxy", "<dictionary> {}", "https", "", false},
		{"IPv6 proxy", strings.ReplaceAll(settings, "127.0.0.1", "::1"), "https", "http://[::1]:7890", false},
		{"missing host", strings.ReplaceAll(settings, "HTTPSProxy : 127.0.0.1", ""), "https", "", true},
		{"invalid port", strings.ReplaceAll(settings, "HTTPSPort : 7890", "HTTPSPort : 0"), "https", "", true},
		{"ignore scoped interfaces", strings.TrimSuffix(settings, "}") + `  __SCOPED__ : <dictionary> {
    en0 : <dictionary> {
      HTTPSEnable : 0
      HTTPSPort : 8081
      HTTPSProxy : other.proxy
    }
  }
}`, "https", "http://127.0.0.1:7890", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			proxy, err := macOSUpdateProxy(tt.settings, tt.scheme, "github.com")
			if (err != nil) != tt.wantError {
				t.Fatalf("unexpected error: %v", err)
			}
			got := ""
			if proxy != nil {
				got = proxy.String()
			}
			if got != tt.want {
				t.Fatalf("proxy = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMacOSUpdateProxyRespectsSystemExceptions(t *testing.T) {
	settings := `<dictionary> {
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  ExcludeSimpleHostnames : 1
  ExceptionsList : <array> {
    0 : github.com
    1 : *.internal.example
    2 : 192.168.0.0/16
    3 : ::1
  }
}`
	for _, host := range []string{"github.com", "GITHUB.COM.", "api.internal.example", "192.168.1.5", "::1", "printer"} {
		proxy, err := macOSUpdateProxy(settings, "https", host)
		if err != nil || proxy != nil {
			t.Fatalf("excluded host %q used a proxy: %v %v", host, proxy, err)
		}
	}
	proxy, err := macOSUpdateProxy(settings, "https", "release-assets.githubusercontent.com")
	if err != nil || proxy == nil {
		t.Fatalf("non-excluded request lost system proxy: %v %v", proxy, err)
	}
}
