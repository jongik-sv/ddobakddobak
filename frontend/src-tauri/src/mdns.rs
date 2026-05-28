//! mDNS 기반 서버 디스커버리.
//!
//! 데스크톱(맥 본체)은 Rails 서버를 `_ddobak._tcp` 서비스로 LAN에 광고(advertise)하고,
//! 모바일(안드로이드 앱)은 같은 서비스 타입을 브라우즈(browse)해 발견된 서버 목록을
//! UI에 돌려준다. 발견된 `http://<ip>:13323`가 루프백 브릿지(Task 2)의 전달 대상이 된다.
//!
//! 이 모듈은 모든 타겟에서 컴파일되지만, advertise는 데스크톱에서만, browse 커맨드는
//! 모바일에서만 등록된다. 안드로이드는 멀티캐스트 수신을 위해 WifiManager.MulticastLock을
//! JNI로 잡아야 하므로 그 부분만 `cfg(target_os = "android")`로 게이트한다.
// advertise는 데스크톱에서만, browse 관련 항목은 모바일에서만 쓰이므로
// 반대 타겟에서는 미사용 경고가 의도적으로 발생한다 — 억제한다.
#![cfg_attr(not(any(mobile, test)), allow(dead_code))]

use std::time::Duration;

/// 서비스 타입. RFC6763 형식의 완전한 도메인.
const SERVICE_TYPE: &str = "_ddobak._tcp.local.";

/// 머신 hostname을 서버 표시용 라벨로 정규화한다.
/// macOS는 `MacBook-Pro.local`을 돌려주기도 하므로 뒤따르는 `.local`/`.`을 제거해
/// 순수 라벨만 남긴다(이 라벨이 인스턴스명이자 UI 표시 이름).
#[cfg(any(desktop, test))]
fn host_label() -> String {
    let raw = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "ddobak".to_string());
    let trimmed = raw.trim().trim_end_matches('.');
    let label = trimmed
        .strip_suffix(".local")
        .unwrap_or(trimmed)
        .trim_end_matches('.');
    if label.is_empty() {
        "ddobak".to_string()
    } else {
        label.to_string()
    }
}

// ── 데스크톱: 광고 ──────────────────────────────────

/// `_ddobak._tcp` 서비스를 LAN에 광고한다.
///
/// 반환된 `ServiceDaemon`은 앱 수명 동안 살아 있어야 한다. drop되면 서비스가
/// 등록 해제(unregister)되므로, 호출부(lib.rs)에서 manage/forget 등으로 보관한다.
#[cfg(desktop)]
pub fn advertise(port: u16) -> mdns_sd::Result<mdns_sd::ServiceDaemon> {
    use mdns_sd::{ServiceDaemon, ServiceInfo};
    use std::collections::HashMap;

    let label = host_label();
    let host_name = format!("{label}.local.");
    // ip를 ""로 두고 enable_addr_auto()를 켜면 인터페이스 주소를 자동으로 채워
    // IP가 바뀌어도(예: Wi-Fi 재접속) 추종한다. properties는 없음(None).
    let info = ServiceInfo::new(
        SERVICE_TYPE,
        &label,
        &host_name,
        "",
        port,
        None::<HashMap<String, String>>,
    )?
    .enable_addr_auto();

    let daemon = ServiceDaemon::new()?;
    daemon.register(info)?;
    log::info!("mDNS advertise: {label} ({SERVICE_TYPE}) port={port}");
    Ok(daemon)
}

// ── 모바일: 브라우즈 ────────────────────────────────

/// 디스커버리로 발견한 서버 한 건.
#[derive(serde::Serialize)]
pub struct Found {
    /// 인스턴스 라벨(서버 표시 이름).
    pub name: String,
    /// 접속 URL. `http://<ipv4>:<port>`.
    pub url: String,
}

/// fullname(`<instance>._ddobak._tcp.local.`)에서 인스턴스 라벨만 추출한다.
fn instance_label(fullname: &str) -> String {
    fullname
        .strip_suffix(&format!(".{SERVICE_TYPE}"))
        .unwrap_or(fullname)
        .to_string()
}

/// 약 3초간 `_ddobak._tcp` 서비스를 브라우즈해 발견된 서버 목록을 반환한다.
/// 안드로이드에서는 멀티캐스트 락을 잡은 채 수집한다(락 실패해도 브라우즈는 시도).
#[tauri::command]
pub async fn mdns_browse() -> Vec<Found> {
    // 안드로이드: 멀티캐스트 락 획득(수집 동안 유지). 실패해도 계속 진행.
    #[cfg(target_os = "android")]
    let _lock = acquire_multicast_lock();

    let daemon = match mdns_sd::ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            log::warn!("mDNS daemon 생성 실패: {e}");
            return Vec::new();
        }
    };

    let receiver = match daemon.browse(SERVICE_TYPE) {
        Ok(r) => r,
        Err(e) => {
            log::warn!("mDNS browse 시작 실패: {e}");
            return Vec::new();
        }
    };

    let mut found: Vec<Found> = Vec::new();
    let mut seen_urls: std::collections::HashSet<String> = std::collections::HashSet::new();

    // ~3초간 ServiceResolved 이벤트를 수집. timeout은 정상 종료 신호이지 에러 아님.
    let collect = async {
        loop {
            match receiver.recv_async().await {
                Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                    let port = info.get_port();
                    let name = instance_label(info.get_fullname());
                    // 첫 IPv4 주소를 사용.
                    if let Some(ip) = info.get_addresses_v4().into_iter().next() {
                        let url = format!("http://{ip}:{port}");
                        if seen_urls.insert(url.clone()) {
                            found.push(Found { name, url });
                        }
                    }
                }
                Ok(_) => {}
                // 채널이 닫히면(데몬 drop 등) 수집 종료.
                Err(_) => break,
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(3), collect).await;

    // 데몬 정리(브라우즈 중단). 실패는 무시.
    let _ = daemon.shutdown();

    found
}

// ── 안드로이드: 멀티캐스트 락 (JNI) ─────────────────
//
// 안드로이드는 WifiManager.MulticastLock을 잡지 않으면 인바운드 멀티캐스트 패킷을
// 버린다 → mDNS 응답을 받지 못한다. browse 전에 락을 획득하고, 수집이 끝난 뒤
// (반환된 가드가 drop될 때) 해제한다. 어떤 단계든 실패하면 로그만 남기고 계속 진행한다
// (절대 panic 금지 — 락이 없어도 브라우즈는 시도해야 한다).

/// 살아 있는 동안 멀티캐스트 락을 유지하는 가드. drop 시 release한다.
#[cfg(target_os = "android")]
struct MulticastLockGuard {
    lock: jni::objects::GlobalRef,
}

#[cfg(target_os = "android")]
impl Drop for MulticastLockGuard {
    fn drop(&mut self) {
        let result = (|| -> jni::errors::Result<()> {
            let ctx = ndk_context::android_context();
            let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
            let mut env = vm.attach_current_thread()?;
            env.call_method(self.lock.as_obj(), "release", "()V", &[])?;
            Ok(())
        })();
        if let Err(e) = result {
            log::warn!("multicast lock 해제 실패: {e}");
        }
    }
}

/// 멀티캐스트 락을 획득한다. 성공 시 가드를 반환(drop으로 해제), 실패 시 None.
#[cfg(target_os = "android")]
fn acquire_multicast_lock() -> Option<MulticastLockGuard> {
    use jni::objects::JObject;

    let acquire = || -> jni::errors::Result<jni::objects::GlobalRef> {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
        let mut env = vm.attach_current_thread()?;
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };

        let svc = env.new_string("wifi")?;
        let wifi = env
            .call_method(
                &context,
                "getSystemService",
                "(Ljava/lang/String;)Ljava/lang/Object;",
                &[(&svc).into()],
            )?
            .l()?;
        let tag = env.new_string("ddobak-mdns")?;
        let lock = env
            .call_method(
                &wifi,
                "createMulticastLock",
                "(Ljava/lang/String;)Landroid/net/wifi/WifiManager$MulticastLock;",
                &[(&tag).into()],
            )?
            .l()?;
        env.call_method(&lock, "acquire", "()V", &[])?;
        env.new_global_ref(lock)
    };

    match acquire() {
        Ok(lock) => {
            log::info!("multicast lock 획득");
            Some(MulticastLockGuard { lock })
        }
        Err(e) => {
            log::warn!("multicast lock 획득 실패(브라우즈는 계속 시도): {e}");
            None
        }
    }
}

// ── 테스트 ──────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_label_strips_service_suffix() {
        assert_eq!(
            instance_label("MacBook._ddobak._tcp.local."),
            "MacBook"
        );
        // 접미사가 없으면 그대로.
        assert_eq!(instance_label("bare"), "bare");
    }

    #[test]
    fn host_label_is_non_empty() {
        assert!(!host_label().is_empty());
    }

    /// 호스트의 로컬 mDNS 응답자에 실제로 등록되는지 확인(데몬은 keep-alive).
    #[cfg(desktop)]
    #[test]
    fn advertise_registers_ok() {
        let daemon = advertise(13323).expect("advertise should succeed");
        // 즉시 drop되면 unregister되므로 잠깐 보관 후 정리.
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = daemon.shutdown();
    }
}
