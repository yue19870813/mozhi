//! Native Windows subtree change notifications. UI retains polling and foreground
//! reconciliation so notification coalescing/overflow never defines correctness.
#[cfg(windows)]
mod windows {
    use std::os::windows::ffi::OsStrExt;
    use std::{
        path::Path,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread::JoinHandle,
    };

    use windows_sys::Win32::{
        Foundation::{INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT},
        Storage::FileSystem::{
            FindCloseChangeNotification, FindFirstChangeNotificationW, FindNextChangeNotification,
            FILE_NOTIFY_CHANGE_ATTRIBUTES, FILE_NOTIFY_CHANGE_DIR_NAME,
            FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE,
        },
        System::Threading::WaitForSingleObject,
    };
    pub struct Watcher {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }
    impl Watcher {
        pub fn start(mut changed: impl FnMut(u64) + Send + 'static, root: &Path) -> Option<Self> {
            let path: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
            // SAFETY: NUL terminated path; the returned handle is owned by the worker.
            let handle = unsafe {
                FindFirstChangeNotificationW(
                    path.as_ptr(),
                    1,
                    FILE_NOTIFY_CHANGE_FILE_NAME
                        | FILE_NOTIFY_CHANGE_DIR_NAME
                        | FILE_NOTIFY_CHANGE_LAST_WRITE
                        | FILE_NOTIFY_CHANGE_SIZE
                        | FILE_NOTIFY_CHANGE_ATTRIBUTES,
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                return None;
            }
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = stop.clone();
            let handle = handle as usize;
            let thread = std::thread::spawn(move || {
                let handle = handle as windows_sys::Win32::Foundation::HANDLE;
                let mut sequence = 0u64;
                while !stopped.load(Ordering::Relaxed) {
                    let result = unsafe { WaitForSingleObject(handle, 250) };
                    if result == WAIT_TIMEOUT {
                        continue;
                    }
                    if result != WAIT_OBJECT_0 {
                        break;
                    }
                    sequence += 1;
                    if unsafe { FindNextChangeNotification(handle) } == 0 {
                        break;
                    }
                    changed(sequence);
                }
                unsafe {
                    FindCloseChangeNotification(handle);
                }
            });
            Some(Self {
                stop,
                thread: Some(thread),
            })
        }
    }
    impl Drop for Watcher {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}
#[cfg(windows)]
pub use windows::Watcher;

#[cfg(test)]
mod tests {
    use super::Watcher;
    use std::{fs, sync::mpsc, time::Duration};
    #[test]
    fn watches_nested_create_rename_delete_and_stops() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("中文目录");
        fs::create_dir(&nested).unwrap();
        let (tx, rx) = mpsc::channel();
        let watcher = Watcher::start(
            move |seq| {
                let _ = tx.send(seq);
            },
            root.path(),
        )
        .unwrap();
        let source = nested.join("a.md");
        let target = nested.join("b.md");
        fs::write(&source, "hello").unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        fs::rename(&source, &target).unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        fs::remove_file(&target).unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        drop(watcher);
    }
}
