use std::{
    collections::HashMap,
    sync::{Arc, Condvar, Mutex, RwLock, RwLockReadGuard},
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
}

pub struct Permit<'a> {
    jobs: &'a Jobs,
    queue: Arc<Queue>,
    _maintenance: RwLockReadGuard<'a, ()>,
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
        })
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
