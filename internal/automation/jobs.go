package automation

import (
	"context"
	"sync"
)

type queuedJob struct {
	ready  chan struct{}
	cancel context.CancelFunc
}

func (e *Engine) acquire(parent context.Context, serial string) (context.Context, func(), error) {
	ctx, cancel := context.WithCancel(parent)
	job := &queuedJob{ready: make(chan struct{}), cancel: cancel}
	e.mu.Lock()
	if e.closing || e.maintenance || len(e.lanes[serial]) >= 16 {
		e.mu.Unlock()
		cancel()
		return nil, nil, errf("维护中或此设备等待队列已满")
	}
	e.lanes[serial] = append(e.lanes[serial], job)
	e.active[serial] = func() {
		for _, j := range e.lanes[serial] {
			j.cancel()
		}
	}
	if len(e.lanes[serial]) == 1 {
		close(job.ready)
	}
	e.wg.Add(1)
	e.mu.Unlock()
	var once sync.Once
	release := func() {
		once.Do(func() {
			cancel()
			e.mu.Lock()
			lane := e.lanes[serial]
			for i, j := range lane {
				if j == job {
					lane = append(lane[:i], lane[i+1:]...)
					if i == 0 && len(lane) > 0 {
						close(lane[0].ready)
					}
					break
				}
			}
			if len(lane) == 0 {
				delete(e.lanes, serial)
				delete(e.active, serial)
				delete(e.progress, serial)
			} else {
				e.lanes[serial] = lane
			}
			e.mu.Unlock()
			e.wg.Done()
		})
	}
	select {
	case <-ctx.Done():
		release()
		return nil, nil, ctx.Err()
	case <-job.ready:
	}
	select {
	case e.slots <- struct{}{}:
		return ctx, func() { <-e.slots; release() }, nil
	case <-ctx.Done():
		release()
		return nil, nil, ctx.Err()
	}
}
func (e *Engine) Maintain(fn func() error) error {
	e.mu.Lock()
	if e.maintenance || len(e.active) > 0 || e.closing {
		e.mu.Unlock()
		return errf("请等待设备任务和维护操作完成")
	}
	e.maintenance = true
	e.mu.Unlock()
	defer func() { e.mu.Lock(); e.maintenance = false; e.mu.Unlock() }()
	return fn()
}
