use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    recording: bool,
    lead: bool,
}

/// caffeinate -is 자식을 (녹음 || 예약 lead) 동안 보유. 둘 다 false면 해제.
#[derive(Default)]
pub struct AssertionState(Mutex<Inner>);

impl AssertionState {
    /// 보유 조건 = recording || lead. 자식 상태를 desired에 수렴시킨다(idempotent).
    fn reconcile(inner: &mut Inner) {
        let want = inner.recording || inner.lead;
        if want && inner.child.is_none() {
            match Command::new("caffeinate").arg("-is").spawn() {
                Ok(c) => inner.child = Some(c),
                Err(e) => log::warn!("caffeinate 시작 실패: {e}"),
            }
        } else if !want {
            if let Some(mut c) = inner.child.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }

    pub fn set_recording(&self, active: bool) {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        g.recording = active;
        Self::reconcile(&mut g);
    }

    /// 폴 루프가 매 틱 호출: ≤120s 앞 예약 존재 여부.
    pub fn set_lead(&self, due: bool) {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        g.lead = due;
        Self::reconcile(&mut g);
    }

    /// 앱 종료(Destroyed) 누수 정리: 모든 사유 해제 + 자식 kill.
    pub fn force_release(&self) {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        g.recording = false;
        g.lead = false;
        if let Some(mut c) = g.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

/// 프론트의 녹음 on/off 통지(데스크톱 전용 command).
#[tauri::command]
pub fn set_recording(active: bool, state: State<'_, AssertionState>) {
    state.set_recording(active);
}
