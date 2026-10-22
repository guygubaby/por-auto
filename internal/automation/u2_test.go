package automation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestU2NativeTextUsesExplicitUTF8(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "charset=utf-8") {
			t.Error("native HTTP server would decode non-ASCII input using its default charset")
		}
		var body Object
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if list(body["params"])[1] != "Go 迁移预演" {
			t.Error("native text changed in transit")
		}
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":true}`))
	}))
	defer server.Close()
	u := &U2{Port: strings.TrimPrefix(server.URL, "http://127.0.0.1:"), Client: server.Client()}
	if value, err := u.RPC(context.Background(), "setText", []any{Object{}, "Go 迁移预演"}); err != nil || value != true {
		t.Fatal("native text request failed", err)
	}
}
