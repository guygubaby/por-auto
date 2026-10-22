package automation

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestDeviceQueueIsFIFOAndCancellationDoesNotReplay(t *testing.T) {
	e := NewEngine(t.TempDir(), nil)
	_, release, err := e.acquire(context.Background(), "A")
	if err != nil {
		t.Fatal(err)
	}
	order := make(chan int, 3)
	for i := 1; i <= 3; i++ {
		i := i
		go func() {
			_, done, err := e.acquire(context.Background(), "A")
			if err != nil {
				t.Error(err)
				return
			}
			order <- i
			done()
		}()
		for {
			e.mu.Lock()
			count := len(e.lanes["A"])
			e.mu.Unlock()
			if count == i+1 {
				break
			}
			time.Sleep(time.Millisecond)
		}
	}
	release()
	for i := 1; i <= 3; i++ {
		select {
		case got := <-order:
			if got != i {
				t.Fatalf("queue reordered: %d != %d", got, i)
			}
		case <-time.After(time.Second):
			t.Fatal("queue stuck")
		}
	}
	e.Close()
}
func TestGlobalConcurrencyAndMaintenanceIncludesQueuedJobs(t *testing.T) {
	e := NewEngine(t.TempDir(), nil)
	var maximum, active atomic.Int32
	start := make(chan struct{})
	done := make(chan struct{}, 6)
	for _, serial := range []string{"A", "B", "C", "D", "E", "F"} {
		go func(serial string) {
			_, release, err := e.acquire(context.Background(), serial)
			if err != nil {
				t.Error(err)
				done <- struct{}{}
				return
			}
			n := active.Add(1)
			for old := maximum.Load(); n > old; old = maximum.Load() {
				if maximum.CompareAndSwap(old, n) {
					break
				}
			}
			<-start
			active.Add(-1)
			release()
			done <- struct{}{}
		}(serial)
	}
	for {
		e.mu.Lock()
		tracked := len(e.active)
		e.mu.Unlock()
		if tracked == 6 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	close(start)
	for i := 0; i < 6; i++ {
		<-done
	}
	if maximum.Load() != 4 {
		t.Fatal("global limit changed")
	}
	e.Close()
	if _, _, err := e.acquire(context.Background(), "A"); err == nil {
		t.Fatal("shutdown accepted new work")
	}
}
func TestQueuedJobCanBeCancelledAndBusyMaintenanceIsRejected(t *testing.T) {
	e := NewEngine(t.TempDir(), nil)
	_, release, err := e.acquire(context.Background(), "A")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, finish, err := e.acquire(ctx, "A")
		if err == nil {
			finish()
		}
		done <- err
	}()
	for {
		e.mu.Lock()
		n := len(e.lanes["A"])
		e.mu.Unlock()
		if n == 2 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if e.Maintain(func() error { t.Fatal("maintenance entered with queued jobs"); return nil }) == nil {
		t.Fatal("busy maintenance accepted")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("queued cancellation ignored")
		}
	case <-time.After(time.Second):
		t.Fatal("queued cancellation stuck")
	}
	release()
	e.Close()
}
