use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::{AppHandle, Emitter, Manager};

const GRACE_MS: i64 = 60_000;
const MANUAL_LEAD_MS: i64 = 60_000;

const SCHED_URL: &str = "http://127.0.0.1:13323/api/v1/meetings/scheduled";
const POLL_SECS: u64 = 60;

#[derive(Clone, Serialize)]
struct TriggerPayload {
    #[serde(rename = "meetingId")]
    meeting_id: i64,
    mode: String,
}

#[derive(Deserialize)]
struct ScheduledEnvelope {
    meetings: Vec<SchedMeeting>,
}

/// 데스크톱 전용 백그라운드 스케줄러. 60s마다 loopback(무토큰)으로 예약 목록을 폴하고,
/// 트리거 시각 도달 회의는 메인 창을 표시한 뒤 scheduled-meeting-trigger 를 emit 한다.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let mut already: HashSet<i64> = HashSet::new();
        loop {
            match client.get(SCHED_URL).send().await {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(bytes) = resp.bytes().await {
                        if let Ok(env) = serde_json::from_slice::<ScheduledEnvelope>(&bytes) {
                            let now = Utc::now();
                            for act in compute_actions(&env.meetings, now, &already) {
                                already.insert(act.meeting_id);
                                // 1) 메인 창 먼저 표시(웹뷰·AudioContext 복원)
                                if let Some(win) = app.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                                // 2) 프론트로 트리거 emit
                                let _ = app.emit(
                                    "scheduled-meeting-trigger",
                                    TriggerPayload { meeting_id: act.meeting_id, mode: act.mode },
                                );
                                log::info!("예약 트리거: meeting {}", act.meeting_id);
                            }
                            // T-120s 선제 caffeinate: ≤120s 앞 예약 감지 시 (깨어있는 동안) 획득.
                            app.state::<crate::assertion::AssertionState>()
                                .set_lead(assertion_due(&env.meetings, now, 120));
                        }
                    }
                }
                Ok(resp) => log::warn!("scheduled 폴 비정상 status: {}", resp.status()),
                Err(e) => log::debug!("scheduled 폴 실패(부팅 중/오프라인): {e}"),
            }
            tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)).await;
        }
    });
}

#[derive(Debug, Clone, Deserialize)]
pub struct SchedMeeting {
    pub id: i64,
    pub scheduled_start_time: Option<String>,
    pub auto_start_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TriggerAction {
    pub meeting_id: i64,
    pub mode: String,
}

/// 예약 시작이 lead_secs 이내(아직 시작 전~+GRACE)인 회의가 하나라도 있으면 true.
/// T-120s 선제 caffeinate 획득용. now ∈ [scheduled - lead_secs, scheduled + GRACE).
pub fn assertion_due(meetings: &[SchedMeeting], now: DateTime<Utc>, lead_secs: i64) -> bool {
    let now_ms = now.timestamp_millis();
    for m in meetings {
        match m.auto_start_mode.as_deref() {
            Some("auto" | "manual") => {}
            _ => continue,
        }
        let Some(ts) = &m.scheduled_start_time else { continue };
        let Ok(parsed) = DateTime::parse_from_rfc3339(ts) else { continue };
        let s = parsed.with_timezone(&Utc).timestamp_millis();
        let lower = s - lead_secs * 1000;
        let upper = s + GRACE_MS;
        if now_ms >= lower && now_ms < upper {
            return true;
        }
    }
    false
}

/// JS computeScheduleActions와 동일 규칙. auto:[t, t+60s), manual:[t-60s, t+60s), 상한 배타.
pub fn compute_actions(
    meetings: &[SchedMeeting],
    now: DateTime<Utc>,
    already: &HashSet<i64>,
) -> Vec<TriggerAction> {
    let now_ms = now.timestamp_millis();
    let mut out = Vec::new();
    for m in meetings {
        let mode = match m.auto_start_mode.as_deref() {
            Some(x @ ("auto" | "manual")) => x,
            _ => continue,
        };
        if already.contains(&m.id) {
            continue;
        }
        let Some(ts) = &m.scheduled_start_time else { continue };
        let Ok(parsed) = DateTime::parse_from_rfc3339(ts) else { continue };
        let scheduled_ms = parsed.with_timezone(&Utc).timestamp_millis();
        let lower = if mode == "manual" { scheduled_ms - MANUAL_LEAD_MS } else { scheduled_ms };
        let upper = scheduled_ms + GRACE_MS;
        if now_ms >= lower && now_ms < upper {
            out.push(TriggerAction { meeting_id: m.id, mode: mode.to_string() });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(id: i64, t: &str, mode: &str) -> SchedMeeting {
        SchedMeeting { id, scheduled_start_time: Some(t.into()), auto_start_mode: Some(mode.into()) }
    }
    fn now(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn auto_fires_at_scheduled_instant() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "auto")];
        let acts = compute_actions(&ms, now("2026-06-22T14:30:00.000Z"), &HashSet::new());
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].meeting_id, 1);
        assert_eq!(acts[0].mode, "auto");
    }

    #[test]
    fn auto_not_fire_after_grace_upper_exclusive() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "auto")];
        // +60s 정확히 = 상한 배타 → 발화 안 함
        let acts = compute_actions(&ms, now("2026-06-22T14:31:00.000Z"), &HashSet::new());
        assert!(acts.is_empty());
    }

    #[test]
    fn manual_fires_60s_before() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "manual")];
        let acts = compute_actions(&ms, now("2026-06-22T14:29:00.000Z"), &HashSet::new());
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].mode, "manual");
    }

    #[test]
    fn already_triggered_skipped() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "auto")];
        let mut seen = HashSet::new();
        seen.insert(1);
        assert!(compute_actions(&ms, now("2026-06-22T14:30:00.000Z"), &seen).is_empty());
    }

    #[test]
    fn no_mode_or_no_time_skipped() {
        let ms = vec![
            SchedMeeting { id: 1, scheduled_start_time: None, auto_start_mode: Some("auto".into()) },
            SchedMeeting { id: 2, scheduled_start_time: Some("2026-06-22T14:30:00.000Z".into()), auto_start_mode: None },
        ];
        assert!(compute_actions(&ms, now("2026-06-22T14:30:00.000Z"), &HashSet::new()).is_empty());
    }

    #[test]
    fn assertion_lead_120s_before_inclusive() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "auto")];
        // 정확히 T-120s = 하한 포함 → true
        assert!(assertion_due(&ms, now("2026-06-22T14:28:00.000Z"), 120));
    }
    #[test]
    fn assertion_not_due_before_lead_window() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "auto")];
        // T-121s = 창 밖 → false
        assert!(!assertion_due(&ms, now("2026-06-22T14:27:59.000Z"), 120));
    }
    #[test]
    fn assertion_due_through_grace_then_false() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "manual")];
        assert!(assertion_due(&ms, now("2026-06-22T14:30:00.000Z"), 120)); // 정각 = 창 안
        // scheduled+60s = 상한 배타 → false
        assert!(!assertion_due(&ms, now("2026-06-22T14:31:00.000Z"), 120));
    }
    #[test]
    fn assertion_due_ignores_no_mode_or_no_time() {
        let ms = vec![
            SchedMeeting { id: 1, scheduled_start_time: None, auto_start_mode: Some("auto".into()) },
            SchedMeeting { id: 2, scheduled_start_time: Some("2026-06-22T14:28:00.000Z".into()), auto_start_mode: None },
        ];
        assert!(!assertion_due(&ms, now("2026-06-22T14:28:00.000Z"), 120));
    }
}
