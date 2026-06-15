//! Mutex poison 복구 헬퍼.
//!
//! `lock().unwrap()`은 다른 스레드가 락을 든 채 panic하면 락이 poison되어 이후 모든
//! `lock().unwrap()`이 연쇄 panic한다(첫 panic이 무관한 코드까지 무너뜨림).
//! `lock_safe()`는 정상 경로에서 동일한 guard를 그대로 돌려주고, poison된 경우에만
//! panic 대신 guard를 복구한다. → 동작·출력 무변경, post-panic 경로만 graceful.

use std::sync::{Mutex, MutexGuard};

pub(crate) trait LockExt<T> {
    /// poison을 무시하고 guard를 얻는다(`lock().unwrap()`의 panic-free 대체).
    fn lock_safe(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    #[inline]
    fn lock_safe(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
