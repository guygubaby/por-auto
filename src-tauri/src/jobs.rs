use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex, RwLock, RwLockReadGuard,
    },
};

#[derive(Default)]
pub struct Jobs {
    pub maintenance: RwLock<()>,
    devices: Mutex<HashMap<String, Arc<Queue>>>,
    slots: (Mutex<usize>, Condvar),
}

#[derive(Default)]
struct Queue {
    tickets: Mutex<(u64, u64)>,
    ready: Condvar,
    generation: AtomicU64,
}

pub struct Permit<'a> {
    jobs: &'a Jobs,
    queue: Arc<Queue>,
    _maintenance: RwLockReadGuard<'a, ()>,
    generation: u64,
}

impl Jobs {
    pub fn acquire(&self, serial: &str) -> Result<Permit<'_>, String> {
        let maintenance = self
            .maintenance
            .try_read()
            .map_err(|_| "维护操作正在进行，请稍后运行")?;
        let queue = self
            .devices
            .lock()
            .map_err(|_| "设备队列不可用")?
            .entry(serial.into())
            .or_default()
            .clone();
        let mut tickets = queue.tickets.lock().map_err(|_| "设备队列不可用")?;
        let generation = queue.generation.load(Ordering::SeqCst);
        if tickets.0 - tickets.1 >= 16 {
            return Err("此手机等待任务过多，请稍后重试".into());
        }
        let ticket = tickets.0;
        tickets.0 += 1;
        while tickets.1 != ticket {
            tickets = queue.ready.wait(tickets).map_err(|_| "设备队列不可用")?;
        }
        drop(tickets);
        let mut active = self.slots.0.lock().map_err(|_| "执行队列不可用")?;
        while *active >= 4 {
            active = self.slots.1.wait(active).map_err(|_| "执行队列不可用")?;
        }
        *active += 1;
        Ok(Permit {
            jobs: self,
            queue,
            _maintenance: maintenance,
            generation,
        })
    }
    pub fn cancel(&self, serial: &str) -> Result<(), String> {
        if let Some(queue) = self
            .devices
            .lock()
            .map_err(|_| "设备队列不可用")?
            .get(serial)
        {
            queue.generation.fetch_add(1, Ordering::SeqCst);
        }
        Ok(())
    }
}
impl Permit<'_> {
    pub fn check(&self) -> Result<(), String> {
        if self.queue.generation.load(Ordering::SeqCst) != self.generation {
            Err("用户已停止此手机的任务；已发送内容与待核对结果均已保留".into())
        } else {
            Ok(())
        }
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.jobs.slots.0.lock() {
            *active -= 1;
            self.jobs.slots.1.notify_one();
        }
        if let Ok(mut tickets) = self.queue.tickets.lock() {
            tickets.1 += 1;
            self.queue.ready.notify_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Barrier,
        },
        thread,
    };
    #[test]
    fn cancellation_is_per_device_and_does_not_cancel_new_runs() {
        let jobs = Jobs::default();
        let a = jobs.acquire("A").unwrap();
        let b = jobs.acquire("B").unwrap();
        jobs.cancel("A").unwrap();
        assert!(a.check().is_err());
        assert!(b.check().is_ok());
        drop(a);
        let next = jobs.acquire("A").unwrap();
        assert!(next.check().is_ok());
    }

    #[test]
    fn devices_run_in_parallel_but_same_device_waits_and_maintenance_is_exclusive() {
        let jobs = Jobs::default();
        let first = jobs.acquire("A").unwrap();
        assert!(jobs.maintenance.try_write().is_err());
        let barrier = Barrier::new(2);
        let completed = AtomicUsize::new(0);
        thread::scope(|scope| {
            scope.spawn(|| {
                let _b = jobs.acquire("B").unwrap();
                barrier.wait();
            });
            barrier.wait(); // B ran while A was still held.
            scope.spawn(|| {
                let _a = jobs.acquire("A").unwrap();
                completed.fetch_add(1, Ordering::SeqCst);
            });
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while jobs.devices.lock().unwrap()["A"].tickets.lock().unwrap().0 < 2 {
                assert!(
                    std::time::Instant::now() < deadline,
                    "second A was never queued"
                );
                thread::yield_now();
            }
            assert_eq!(completed.load(Ordering::SeqCst), 0);
            drop(first);
        });
        assert_eq!(completed.load(Ordering::SeqCst), 1);
        let _maintenance = jobs.maintenance.try_write().unwrap();
        assert!(jobs.acquire("C").is_err());
    }
}
