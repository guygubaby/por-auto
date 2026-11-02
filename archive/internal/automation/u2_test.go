package automation

import (
	"context"
	"encoding/json"
	"errors"
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

func TestU2SlowResponseCanBeCanceledWithoutReplayingAction(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		cancel()
		<-r.Context().Done()
	}))
	defer server.Close()
	u := &U2{Port: strings.TrimPrefix(server.URL, "http://127.0.0.1:"), Client: server.Client()}
	if _, err := u.RPC(ctx, "setText", []any{Object{}, "等待输入"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("manual stop was lost while reading a slow response: %v", err)
	}
	if calls != 1 {
		t.Fatalf("write was replayed %d times", calls)
	}
}
