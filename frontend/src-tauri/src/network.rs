//! 로컬 서비스 health 체크 + LAN 서버 스캔(디스커버리).
//!
//! lib.rs god 파일에서 분리. 순수 코드 이동 — 로직·동작 무변경.

use serde::Serialize;
use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct HealthStatus {
    pub backend: bool,
    pub sidecar: bool,
}

/// 루프백의 해당 포트가 열려 있는지(서비스 떠 있는지) TCP 연결로 확인한다.
pub fn is_port_open(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
}

#[tauri::command]
pub fn check_health() -> HealthStatus {
    HealthStatus {
        backend: is_port_open(13323),
        sidecar: is_port_open(13324),
    }
}

/// 모든 비루프백 사설 IPv4 인터페이스의 /24 대역(앞 3옥텟)을 수집한다.
/// 기본 경로가 셀룰러로 잡혀도 Wi-Fi LAN 대역을 놓치지 않도록 전 인터페이스를 본다.
fn candidate_subnets() -> Vec<[u8; 3]> {
    let mut set: BTreeSet<[u8; 3]> = BTreeSet::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let IpAddr::V4(v4) = iface.ip() {
                let o = v4.octets();
                let is_private = o[0] == 10
                    || (o[0] == 172 && (16..=31).contains(&o[1]))
                    || (o[0] == 192 && o[1] == 168);
                if is_private {
                    set.insert([o[0], o[1], o[2]]);
                }
            }
        }
    }
    set.into_iter().collect()
}

/// 해당 host:port가 또박또박 서버인지 /api/v1/health 응답(HTTP 200)으로 확인한다.
fn probe_health(ip: Ipv4Addr, port: u16) -> bool {
    let addr = SocketAddr::from((ip, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(700)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(700)));
    let req =
        format!("GET /api/v1/health HTTP/1.0\r\nHost: {ip}:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/") && head.contains(" 200")
        }
        _ => false,
    }
}

/// 사설 /24 대역들에서 또박또박 서버를 스캔해 접속 가능한 URL 목록을 반환한다.
#[tauri::command]
pub fn scan_lan_servers(port: Option<u16>) -> Vec<String> {
    let port = port.unwrap_or(13323);
    let mut found: Vec<String> = Vec::new();
    // 동시 연결 폭주로 SYN 드롭이 나지 않도록 64개씩 끊어서 스캔한다.
    const BATCH: u16 = 64;
    for sub in candidate_subnets() {
        let mut host: u16 = 1;
        while host <= 254 {
            let end = (host + BATCH - 1).min(254);
            let (tx, rx) = mpsc::channel::<String>();
            for h in host..=end {
                let ip = Ipv4Addr::new(sub[0], sub[1], sub[2], h as u8);
                let tx = tx.clone();
                thread::spawn(move || {
                    if probe_health(ip, port) {
                        let _ = tx.send(format!("http://{ip}:{port}"));
                    }
                });
            }
            drop(tx); // 원본 송신자를 닫아야 배치 스레드 종료 시 rx.iter()가 끝난다.
            for url in rx.iter() {
                found.push(url);
            }
            host = end + 1;
        }
    }
    found.sort();
    found.dedup();
    found
}
