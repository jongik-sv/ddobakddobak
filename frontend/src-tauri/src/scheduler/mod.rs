use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashSet;

const GRACE_MS: i64 = 60_000;
const MANUAL_LEAD_MS: i64 = 60_000;

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
}
