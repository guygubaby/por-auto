use crate::android;
use std::path::Path;

const SETTING: &str = "stay_on_while_plugged_in";
type Shell<'a> = Box<dyn Fn(&[&str]) -> Result<String, String> + 'a>;

pub struct ScreenAwake<'a> {
    shell: Shell<'a>,
    original: String,
    applied: String,
    changed: bool,
}
impl<'a> ScreenAwake<'a> {
    pub fn start(adb: &'a Path, serial: &'a str) -> Result<Self, String> {
        Self::acquire(Box::new(move |args| {
            let mut command = vec!["-s", serial, "shell"];
            command.extend_from_slice(args);
            android::text(adb, &command)
        }))
    }
    fn acquire(shell: Shell<'a>) -> Result<Self, String> {
        let original = shell(&["settings", "get", "global", SETTING])?
            .trim()
            .to_owned();
        let bits = if original == "null" {
            0
        } else {
            original
                .parse::<i32>()
                .map_err(|_| "不能读取手机唤醒设置，未更改")?
        };
        let applied = (bits | 2).to_string();
        let mut lease = Self {
            shell,
            original,
            applied,
            changed: false,
        };
        if bits & 2 == 0 {
            lease.changed = true;
            (lease.shell)(&["settings", "put", "global", SETTING, &lease.applied])?;
            if (lease.shell)(&["settings", "get", "global", SETTING])?.trim() != lease.applied {
                return Err("手机未接受运行时保持唤醒设置，已停止".into());
            }
        }
        Ok(lease)
    }
    pub fn restore(&mut self) -> Result<(), String> {
        if !self.changed {
            return Ok(());
        }
        // Preserve a preference changed by the user or another tool during this run.
        if (self.shell)(&["settings", "get", "global", SETTING])?.trim() != self.applied {
            self.changed = false;
            return Ok(());
        }
        if self.original == "null" {
            (self.shell)(&["settings", "delete", "global", SETTING])?;
        } else {
            (self.shell)(&["settings", "put", "global", SETTING, &self.original])?;
        }
        if (self.shell)(&["settings", "get", "global", SETTING])?.trim() != self.original {
            return Err("手机唤醒设置未能恢复，请在开发者选项检查「保持唤醒」".into());
        }
        self.changed = false;
        Ok(())
    }
}
impl Drop for ScreenAwake<'_> {
    fn drop(&mut self) {
        // shortcut: a forced process kill cannot run Drop; unplugging USB ends the USB wake condition.
        if let Err(error) = self.restore() {
            eprintln!("恢复手机唤醒设置失败：{error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    fn shell(value: &RefCell<String>) -> Shell<'_> {
        Box::new(move |args| match args {
            ["settings", "get", "global", SETTING] => Ok(value.borrow().clone()),
            ["settings", "put", "global", SETTING, next] => {
                *value.borrow_mut() = next.to_string();
                Ok(String::new())
            }
            ["settings", "delete", "global", SETTING] => {
                *value.borrow_mut() = "null".into();
                Ok(String::new())
            }
            _ => panic!("unexpected command"),
        })
    }
    #[test]
    fn usb_wake_is_scoped_to_execution_preserves_other_bits_and_respects_user_changes() {
        for original in ["0", "1", "2", "7", "null"] {
            let value = RefCell::new(original.to_owned());
            {
                let _lease = ScreenAwake::acquire(shell(&value)).unwrap();
                assert_ne!(value.borrow().parse::<i32>().unwrap() & 2, 0);
            }
            assert_eq!(*value.borrow(), original);
        }
        let value = RefCell::new("1".to_owned());
        {
            let _lease = ScreenAwake::acquire(shell(&value)).unwrap();
            *value.borrow_mut() = "4".into();
        }
        assert_eq!(*value.borrow(), "4");
        let value = RefCell::new("invalid".to_owned());
        assert!(ScreenAwake::acquire(shell(&value)).is_err());
        assert_eq!(*value.borrow(), "invalid");
    }
    #[test]
    fn a_write_reporting_failure_is_rolled_back_and_restore_errors_are_visible() {
        let value = RefCell::new("0".to_owned());
        let read = shell(&value);
        assert!(ScreenAwake::acquire(Box::new(|args| {
            let result = read(args)?;
            if args.last() == Some(&"2") {
                Err("connection lost after write".into())
            } else {
                Ok(result)
            }
        }))
        .is_err());
        assert_eq!(*value.borrow(), "0");
        let mut lease = ScreenAwake::acquire(shell(&value)).unwrap();
        lease.shell = Box::new(|_| Err("disconnected".into()));
        assert!(lease.restore().is_err());
        lease.changed = false;
    }
}
