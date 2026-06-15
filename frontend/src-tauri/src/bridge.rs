//! 인앱 루프백 리버스 프록시 브릿지.
//!
//! 안드로이드 WebView는 `https://tauri.localhost`(secure origin, 마이크 동작)에서 구동되지만,
//! LAN의 평문 `http://<ip>:13323` Rails 서버를 직접 호출하면 mixed-content로 차단된다.
//! 해결책: 앱 내부에 `127.0.0.1`로 바인딩된 작은 리버스 프록시를 띄운다.
//! 루프백 origin은 "potentially trustworthy"이므로 secure 페이지에서 호출 가능하다.
//! 프론트는 API base + ActionCable URL을 이 브릿지로 향하게 하고,
//! 브릿지는 현재 선택된 서버 `http://<ip>:13323`로 모든 요청을 전달한다.
//!
//! 이 모듈은 모든 타겟에서 컴파일되지만(호스트 유닛테스트 포함), 실제 기동/커맨드 등록은
//! 모바일에서만 일어난다. 데스크톱 빌드에서 미사용 경고가 나는 것은 의도된 것이라 억제한다.
#![cfg_attr(not(any(mobile, test)), allow(dead_code))]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::sync_ext::LockExt;

use axum::{
    body::Body,
    extract::{Query, State, WebSocketUpgrade},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use futures_util::{SinkExt, StreamExt};

// ── State ───────────────────────────────────────────

#[derive(Default)]
pub struct BridgeState {
    /// 정규화된 "http://<ip>:<port>" (끝 슬래시 없음). 미설정 시 None.
    pub target: Arc<Mutex<Option<String>>>,
    /// 브릿지가 바인딩한 루프백 포트.
    pub port: Arc<Mutex<Option<u16>>>,
}

// ── Tauri Commands ──────────────────────────────────

/// 브릿지가 바인딩한 루프백 포트를 반환한다 (아직 바인딩 전이면 None).
#[tauri::command]
pub fn bridge_port(state: tauri::State<'_, Arc<BridgeState>>) -> Option<u16> {
    *state.port.lock_safe()
}

/// 전달 대상 서버 URL을 설정한다. 끝 슬래시를 제거해 정규화한다.
#[tauri::command]
pub fn set_bridge_target(url: String, state: tauri::State<'_, Arc<BridgeState>>) {
    let normalized = url.trim().trim_end_matches('/').to_string();
    *state.target.lock_safe() = Some(normalized);
}

/// 대상 서버가 또박또박 서버인지 네이티브로 확인(webview mixed-content 회피). http(s) 모두 가능.
#[tauri::command]
pub async fn probe_url(url: String) -> bool {
    let base = url.trim().trim_end_matches('/');
    let target = format!("{base}/api/v1/health");
    let client = shared_client();
    match client
        .get(&target)
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
    {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

// ── Hop-by-hop 헤더 ─────────────────────────────────

/// 프록시가 전달하지 않아야 하는 hop-by-hop 헤더들.
/// reqwest/hyper가 직접 관리하거나, 연결 단위라 전달하면 안 되는 것들.
fn is_hop_by_hop(name: &HeaderName) -> bool {
    let n = name.as_str();
    n.eq_ignore_ascii_case("host")
        || n.eq_ignore_ascii_case("connection")
        || n.eq_ignore_ascii_case("content-length")
        || n.eq_ignore_ascii_case("transfer-encoding")
        || n.eq_ignore_ascii_case("accept-encoding")
        || n.eq_ignore_ascii_case("upgrade")
        || n.starts_with("proxy-")
}

// ── HTTP 프록시 ─────────────────────────────────────

/// 모든 비-WS 경로의 평문 HTTP 요청을 대상 서버로 전달한다.
async fn http_proxy_handler(
    State(state): State<Arc<BridgeState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    // 락을 await 너머로 들고 가지 않도록 즉시 스냅샷.
    let target = { state.target.lock_safe().clone() };
    let Some(target) = target else {
        return (StatusCode::BAD_GATEWAY, "bridge target not set").into_response();
    };

    // 경로 + 쿼리 보존.
    let path_and_query = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or_else(|| uri.path());
    let url = format!("{}{}", target, path_and_query);

    // 요청 바디를 바이트로 수집.
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_GATEWAY, "failed to read request body").into_response(),
    };

    let client = shared_client();
    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return (StatusCode::BAD_GATEWAY, "bad method").into_response(),
    };

    let mut req = client.request(reqwest_method, &url).body(body_bytes.to_vec());
    // hop-by-hop 제외하고 헤더 전달 (authorization, content-type 등은 그대로).
    for (name, value) in headers.iter() {
        if is_hop_by_hop(name) {
            continue;
        }
        if let Ok(v) = HeaderValue::from_bytes(value.as_bytes()) {
            req = req.header(name.as_str(), v);
        }
    }

    let upstream = match req.send().await {
        Ok(r) => r,
        Err(_) => return (StatusCode::BAD_GATEWAY, "upstream request failed").into_response(),
    };

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();
    let bytes = match upstream.bytes().await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_GATEWAY, "failed to read upstream body").into_response(),
    };

    // 응답 빌드: 상태 + 헤더(hop-by-hop 제외) + 바디.
    let mut builder = Response::builder().status(status.as_u16());
    for (name, value) in upstream_headers.iter() {
        if let Ok(hn) = HeaderName::from_bytes(name.as_str().as_bytes()) {
            if is_hop_by_hop(&hn) {
                continue;
            }
            if let Ok(hv) = HeaderValue::from_bytes(value.as_bytes()) {
                builder = builder.header(hn, hv);
            }
        }
    }
    builder
        .body(Body::from(bytes))
        .unwrap_or_else(|_| (StatusCode::BAD_GATEWAY, "failed to build response").into_response())
}

/// 공유 reqwest 클라이언트 (연결 재사용). 평문 HTTP 전용.
fn shared_client() -> reqwest::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| reqwest::Client::builder().build().expect("build reqwest client"))
        .clone()
}

// ── WebSocket 프록시 (ActionCable /cable) ───────────

/// `/cable` WebSocket 업그레이드를 받아 대상 서버의 `/cable`로 양방향 중계한다.
async fn ws_handler(
    State(state): State<Arc<BridgeState>>,
    ws: WebSocketUpgrade,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let target = { state.target.lock_safe().clone() };
    let Some(target) = target else {
        return (StatusCode::BAD_GATEWAY, "bridge target not set").into_response();
    };

    // http(s):// → ws(s):// 변환.
    let ws_base = if let Some(rest) = target.strip_prefix("https://") {
        format!("wss://{}", rest)
    } else if let Some(rest) = target.strip_prefix("http://") {
        format!("ws://{}", rest)
    } else {
        format!("ws://{}", target)
    };

    // 원본 쿼리스트링 재구성.
    let qs = if query.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = query
            .iter()
            .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
            .collect();
        format!("?{}", parts.join("&"))
    };
    let upstream_url = format!("{}/cable{}", ws_base, qs);

    // 들어온 Sec-WebSocket-Protocol을 전달용으로 보존.
    let incoming_protocol = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // ActionCable 클라이언트(connection.js)는 협상된 서브프로토콜을 echo받지 못하면
    // (webSocket.protocol == "") open 즉시 "Protocol is unsupported"로 연결을 끊는다.
    // axum은 자동으로 echo하지 않으므로, 지원 프로토콜을 지정해 101 응답에 포함시킨다.
    ws.protocols(["actioncable-v1-json", "actioncable-unsupported"])
        .on_upgrade(move |client_socket| async move {
            if let Err(e) = pump_ws(client_socket, upstream_url, incoming_protocol).await {
                log::warn!("bridge ws pump ended: {}", e);
            }
        })
}

/// axum 소켓 ↔ 업스트림 WS 간 양방향 메시지 펌프.
async fn pump_ws(
    client_socket: axum::extract::ws::WebSocket,
    upstream_url: String,
    incoming_protocol: Option<String>,
) -> Result<(), String> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::HeaderValue as TungHeaderValue;
    use tokio_tungstenite::tungstenite::Message as TungMsg;

    // 업스트림 연결 요청 빌드 — Origin을 ActionCable이 허용하는 값으로 설정.
    let mut request = upstream_url
        .into_client_request()
        .map_err(|e| format!("build ws request: {}", e))?;
    request.headers_mut().insert(
        "Origin",
        TungHeaderValue::from_static("http://tauri.localhost"),
    );
    if let Some(proto) = incoming_protocol {
        if let Ok(v) = TungHeaderValue::from_str(&proto) {
            request
                .headers_mut()
                .insert("Sec-WebSocket-Protocol", v);
        }
    }

    let (upstream_ws, _resp) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("connect upstream ws: {}", e))?;

    let (mut up_sink, mut up_stream) = upstream_ws.split();
    let (mut cl_sink, mut cl_stream) = client_socket.split();

    use axum::extract::ws::Message as AxMsg;

    loop {
        tokio::select! {
            // 클라이언트 → 업스트림
            msg = cl_stream.next() => {
                match msg {
                    Some(Ok(m)) => {
                        let forward = match m {
                            AxMsg::Text(t) => Some(TungMsg::Text(t)),
                            AxMsg::Binary(b) => Some(TungMsg::Binary(b)),
                            AxMsg::Ping(p) => Some(TungMsg::Ping(p)),
                            AxMsg::Pong(p) => Some(TungMsg::Pong(p)),
                            AxMsg::Close(_) => { let _ = up_sink.send(TungMsg::Close(None)).await; break; }
                        };
                        if let Some(fm) = forward {
                            if up_sink.send(fm).await.is_err() { break; }
                        }
                    }
                    Some(Err(_)) | None => { let _ = up_sink.send(TungMsg::Close(None)).await; break; }
                }
            }
            // 업스트림 → 클라이언트
            msg = up_stream.next() => {
                match msg {
                    Some(Ok(m)) => {
                        let forward = match m {
                            TungMsg::Text(t) => Some(AxMsg::Text(t)),
                            TungMsg::Binary(b) => Some(AxMsg::Binary(b)),
                            TungMsg::Ping(p) => Some(AxMsg::Ping(p)),
                            TungMsg::Pong(p) => Some(AxMsg::Pong(p)),
                            TungMsg::Close(_) => { let _ = cl_sink.send(AxMsg::Close(None)).await; break; }
                            TungMsg::Frame(_) => None, // raw frame은 무시 (split 스트림에서는 발생하지 않음)
                        };
                        if let Some(fm) = forward {
                            if cl_sink.send(fm).await.is_err() { break; }
                        }
                    }
                    Some(Err(_)) | None => { let _ = cl_sink.send(AxMsg::Close(None)).await; break; }
                }
            }
        }
    }

    Ok(())
}

/// 최소 퍼센트 인코딩 (쿼리 값/키용).
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// ── 서버 ────────────────────────────────────────────

/// 루프백 리버스 프록시를 시작한다. 바인딩한 포트를 `state.port`에 기록한다.
pub async fn serve(state: Arc<BridgeState>) {
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            log::error!("bridge bind failed: {}", e);
            return;
        }
    };
    if let Ok(addr) = listener.local_addr() {
        *state.port.lock_safe() = Some(addr.port());
        log::info!("bridge listening on 127.0.0.1:{}", addr.port());
    }

    let router = Router::new()
        .route("/cable", any(ws_handler))
        .fallback(http_proxy_handler)
        .with_state(state);

    if let Err(e) = axum::serve(listener, router).await {
        log::error!("bridge serve error: {}", e);
    }
}

// ── Tests ───────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// 브릿지 포트가 채워질 때까지 짧게 폴링한다 (고정 sleep 회피).
    async fn wait_for_port(state: &Arc<BridgeState>) -> u16 {
        for _ in 0..200 {
            if let Some(p) = *state.port.lock().unwrap() {
                return p;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("bridge port never bound");
    }

    /// 모의 업스트림이 본 cable 핸드셰이크의 Origin 헤더를 기록하는 공유 슬롯.
    type OriginSlot = Arc<Mutex<Option<String>>>;

    /// 모의 업스트림 서버를 127.0.0.1:0에 띄우고 (포트, Origin 기록 슬롯)을 반환한다.
    async fn start_mock_upstream() -> (u16, OriginSlot) {
        use axum::extract::ws::{Message, WebSocket};
        use axum::routing::get;

        async fn health() -> impl IntoResponse {
            ([("content-type", "application/json")], r#"{"status":"ok"}"#)
        }

        async fn cable(
            ws: WebSocketUpgrade,
            headers: HeaderMap,
            State(origin_slot): State<OriginSlot>,
        ) -> Response {
            // 핸드셰이크의 Origin을 기록 — 브릿지가 올바른 값을 보냈는지 검증용.
            let origin = headers
                .get("origin")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            *origin_slot.lock().unwrap() = origin;

            // 실제 ActionCable과 동일하게 서브프로토콜을 협상해 echo한다.
            ws.protocols(["actioncable-v1-json", "actioncable-unsupported"])
                .on_upgrade(|mut socket: WebSocket| async move {
                while let Some(Ok(msg)) = socket.next().await {
                    match msg {
                        Message::Text(t) => {
                            if socket.send(Message::Text(t)).await.is_err() {
                                break;
                            }
                        }
                        Message::Close(_) => break,
                        _ => {}
                    }
                }
            })
        }

        let origin_slot: OriginSlot = Arc::new(Mutex::new(None));
        let app = Router::new()
            .route("/api/v1/health", get(health))
            .route("/cable", any(cable))
            .with_state(origin_slot.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (port, origin_slot)
    }

    #[tokio::test]
    async fn http_request_is_forwarded() {
        let (mock_port, _origin) = start_mock_upstream().await;
        let state = Arc::new(BridgeState::default());

        let serve_state = state.clone();
        tokio::spawn(async move { serve(serve_state).await });

        let bridge_port = wait_for_port(&state).await;
        *state.target.lock().unwrap() = Some(format!("http://127.0.0.1:{}", mock_port));

        let resp = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/api/v1/health", bridge_port))
            .send()
            .await
            .expect("bridge request failed");
        assert_eq!(resp.status(), 200);
        let body = resp.text().await.unwrap();
        assert!(body.contains("ok"), "unexpected body: {}", body);
    }

    #[tokio::test]
    async fn websocket_is_forwarded() {
        use tokio_tungstenite::tungstenite::Message;

        let (mock_port, origin_slot) = start_mock_upstream().await;
        let state = Arc::new(BridgeState::default());

        let serve_state = state.clone();
        tokio::spawn(async move { serve(serve_state).await });

        let bridge_port = wait_for_port(&state).await;
        *state.target.lock().unwrap() = Some(format!("http://127.0.0.1:{}", mock_port));

        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        use tokio_tungstenite::tungstenite::http::HeaderValue as TungHeaderValue;

        // ActionCable 클라이언트와 동일하게 서브프로토콜을 제공한다.
        let url = format!("ws://127.0.0.1:{}/cable", bridge_port);
        let mut request = url.into_client_request().expect("build ws request");
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            TungHeaderValue::from_static("actioncable-v1-json, actioncable-unsupported"),
        );
        let (mut ws, resp) = tokio_tungstenite::connect_async(request)
            .await
            .expect("bridge ws connect failed");

        // 핵심 제약: 브릿지는 협상된 서브프로토콜을 클라이언트에 echo해야 한다.
        // 안 하면 ActionCable(connection.js)이 open 즉시 연결을 끊는다.
        let negotiated = resp
            .headers()
            .get("sec-websocket-protocol")
            .and_then(|v| v.to_str().ok());
        assert_eq!(
            negotiated,
            Some("actioncable-v1-json"),
            "bridge must echo negotiated subprotocol to client (else ActionCable disconnects on open)"
        );

        ws.send(Message::Text("ping-1".to_string()))
            .await
            .expect("send failed");

        let reply = ws.next().await.expect("no reply").expect("ws error");
        match reply {
            Message::Text(t) => assert_eq!(t, "ping-1"),
            other => panic!("unexpected ws message: {:?}", other),
        }

        // 핵심 제약: 브릿지는 ActionCable이 허용하는 Origin을 업스트림에 보내야 한다.
        // (라운드트립이 끝났으므로 슬롯은 이미 채워져 있다.)
        let seen_origin = origin_slot.lock().unwrap().clone();
        assert_eq!(
            seen_origin.as_deref(),
            Some("http://tauri.localhost"),
            "bridge must forward Origin: http://tauri.localhost to upstream cable"
        );
    }
}
