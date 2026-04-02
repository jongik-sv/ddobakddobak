# TSK-02-01: Tauri 딥링크 설정 - 설계 문서

> **status:** design
> **updated:** 2026-04-02
> **depends:** -
> **branch:** dev/WP-02

---

## 1. 아키텍처 개요

### 1.1 현재 상태

- `tauri.conf.json`: plugins 섹션 없음
- `Cargo.toml`: `tauri-plugin-deep-link` 미설치
- `package.json`: `@tauri-apps/plugin-deep-link` 미설치
- `capabilities/default.json`: deep-link 관련 permission 없음
- `Info.plist`: 마이크 권한만 존재, URL scheme 미등록
- `lib.rs`: `tauri::Builder`에 shell, fs, dialog, log 플러그인만 등록

### 1.2 목표 상태

```
[브라우저]                              [Tauri 앱]
    │                                       │
    │  인증 성공 후 리다이렉트                 │
    │  ddobak://callback?token=xxx ────────→│ OS가 URL scheme으로 앱 활성화
    │                                       │
    │                               ┌───────┴───────┐
    │                               │  deep-link     │
    │                               │  플러그인       │
    │                               │  (Rust 측)     │
    │                               └───────┬───────┘
    │                                       │ onOpenUrl 이벤트
    │                               ┌───────┴───────┐
    │                               │  useDeepLink   │
    │                               │  (React 훅)    │
    │                               │                │
    │                               │  URL 파싱      │
    │                               │  token 추출    │
    │                               │  localStorage  │
    │                               │  저장           │
    │                               └───────────────┘
```

### 1.3 설계 원칙

- **단일 책임**: 이 태스크는 딥링크 수신 인프라만 구성한다. 인증 상태 관리(authStore), 로그인 흐름 연결은 TSK-02-03에서 구현한다.
- **공유 파일 수정 금지**: `config.ts`, `App.tsx` 등 다른 태스크와 충돌 가능한 파일은 변경하지 않는다.
- **분리된 훅**: 딥링크 수신 로직은 `hooks/useDeepLink.ts`로 분리하여 TSK-02-03에서 authStore와 연결할 수 있도록 한다.

---

## 2. 구현 범위

### 2.1 이 태스크에서 하는 것

| 항목 | 설명 |
|------|------|
| deep-link 플러그인 설치 | Cargo + npm 패키지 설치 |
| Tauri 설정 | tauri.conf.json에 deep-link 스킴 등록 |
| Rust 플러그인 등록 | lib.rs에 `tauri_plugin_deep_link` 등록 |
| capabilities 추가 | deep-link permission 추가 |
| macOS Info.plist | URL scheme (`ddobak://`) 등록 |
| useDeepLink 훅 | `onOpenUrl`로 URL 수신, token 파싱, localStorage 저장 |

### 2.2 이 태스크에서 하지 않는 것 (후속 태스크)

| 항목 | 담당 태스크 |
|------|-----------|
| authStore (Zustand) 인증 상태 관리 | TSK-02-03 |
| 로그인 버튼 -> 브라우저 열기 흐름 | TSK-02-03 |
| API 클라이언트(ky)에 JWT 헤더 첨부 | TSK-02-03 |
| Refresh Token 자동 갱신 | TSK-02-03 |
| 라우팅 인증 가드 | TSK-02-04 |
| 서버 URL 설정 UI | TSK-02-02 |

---

## 3. 파일 변경 목록

### 3.1 신규 생성

| 파일 | 목적 |
|------|------|
| `frontend/src/hooks/useDeepLink.ts` | onOpenUrl 이벤트 리스너, URL 파싱, token 저장 |
| `frontend/src/lib/deepLinkParser.ts` | URL 파싱 유틸 (테스트 용이성을 위해 분리) |
| `frontend/src/__tests__/lib/deepLinkParser.test.ts` | URL 파싱 단위 테스트 |
| `frontend/src/__tests__/hooks/useDeepLink.test.ts` | 훅 테스트 (onOpenUrl mock) |

### 3.2 수정

| 파일 | 변경 내용 |
|------|----------|
| `frontend/src-tauri/Cargo.toml` | `tauri-plugin-deep-link` 의존성 추가 |
| `frontend/src-tauri/src/lib.rs` | deep-link 플러그인 등록 |
| `frontend/src-tauri/tauri.conf.json` | plugins.deep-link 설정 추가 |
| `frontend/src-tauri/capabilities/default.json` | deep-link permission 추가 |
| `frontend/src-tauri/Info.plist` | CFBundleURLTypes URL scheme 등록 |
| `frontend/package.json` | `@tauri-apps/plugin-deep-link` 의존성 추가 |

---

## 4. Rust 측 변경사항

### 4.1 Cargo.toml

```toml
[dependencies]
# ... 기존 의존성 ...
tauri-plugin-deep-link = "2"
```

### 4.2 lib.rs

`tauri::Builder`의 플러그인 체인에 deep-link 플러그인을 추가한다.

```rust
// run() 함수 내 tauri::Builder
tauri::Builder::default()
    .plugin(tauri_plugin_deep_link::init())   // 추가
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    // ... 나머지 동일
```

**변경 위치**: `pub fn run()` 함수의 `tauri::Builder::default()` 체인 (현재 740행 부근)

**주의사항**:
- deep-link 플러그인은 다른 플러그인보다 먼저 등록하는 것을 권장한다 (앱 시작 시 URL 수신이 누락되지 않도록).
- `use` 문 추가는 불필요하다. `tauri_plugin_deep_link::init()`만 호출하면 된다.

---

## 5. Tauri 설정 변경사항

### 5.1 tauri.conf.json

`plugins` 섹션을 최상위에 추가하고, deep-link 스킴을 등록한다.

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "ddobakddobak",
  "version": "0.1.0",
  "identifier": "com.ddobakddobak.app",
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["ddobak"]
      }
    }
  },
  "build": { ... },
  "app": { ... },
  "bundle": { ... }
}
```

**설명**:
- `desktop.schemes`: 데스크톱 환경에서 등록할 URL scheme 배열. `"ddobak"`을 등록하면 `ddobak://` URL을 앱이 수신한다.
- mobile 설정은 현재 불필요하다 (PRD 1.3: 클라이언트는 macOS/Windows).

### 5.2 capabilities/default.json

deep-link 관련 permission을 추가한다.

```json
{
  "permissions": [
    "core:default",
    "deep-link:default",
    ... 기존 permission ...
  ]
}
```

**추가할 permission**: `"deep-link:default"` -- deep-link 이벤트 수신에 필요한 기본 권한.

### 5.3 Info.plist (macOS)

macOS에서 URL scheme을 OS에 등록하려면 `Info.plist`에 `CFBundleURLTypes`를 추가해야 한다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSMicrophoneUsageDescription</key>
    <string>회의 녹음을 위해 마이크 접근 권한이 필요합니다</string>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>com.ddobakddobak.app</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>ddobak</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
```

**참고**: Tauri v2 deep-link 플러그인이 빌드 시 자동으로 Info.plist에 URL scheme을 삽입할 수도 있으나, 명시적 선언을 통해 개발 모드(`tauri dev`)에서도 동작을 보장한다.

---

## 6. Frontend 측 변경사항

### 6.1 package.json

```json
{
  "dependencies": {
    "@tauri-apps/plugin-deep-link": "^2",
    ... 기존 의존성 ...
  }
}
```

### 6.2 lib/deepLinkParser.ts

URL 파싱 로직을 순수 함수로 분리하여 테스트 용이성을 확보한다.

```typescript
// frontend/src/lib/deepLinkParser.ts

export interface DeepLinkResult {
  type: 'callback';
  token: string;
}

/**
 * ddobak:// 딥링크 URL에서 토큰을 추출한다.
 *
 * @param url - 예: "ddobak://callback?token=eyJhbGci..."
 * @returns DeepLinkResult | null
 */
export function parseDeepLink(url: string): DeepLinkResult | null {
  try {
    const parsed = new URL(url);

    // scheme 확인: ddobak://
    if (parsed.protocol !== 'ddobak:') return null;

    // host 확인: callback
    if (parsed.hostname !== 'callback') return null;

    // token 파라미터 추출
    const token = parsed.searchParams.get('token');
    if (!token) return null;

    return { type: 'callback', token };
  } catch {
    return null;
  }
}
```

**URL 파싱 동작**:
- `new URL("ddobak://callback?token=xxx")` 파싱 시:
  - `protocol` = `"ddobak:"`
  - `hostname` = `"callback"`
  - `searchParams.get("token")` = `"xxx"`
- 잘못된 URL이나 token 누락 시 `null` 반환

### 6.3 hooks/useDeepLink.ts

```typescript
// frontend/src/hooks/useDeepLink.ts

import { useEffect } from 'react';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { parseDeepLink } from '../lib/deepLinkParser';

const TOKEN_KEY = 'access_token';

/**
 * Tauri deep-link 이벤트를 수신하여 JWT 토큰을 localStorage에 저장한다.
 *
 * TSK-02-03에서 authStore와 연결할 때 onToken 콜백을 활용할 수 있다.
 */
export function useDeepLink(onToken?: (token: string) => void): void {
  useEffect(() => {
    const unlisten = onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        const result = parseDeepLink(url);
        if (result) {
          localStorage.setItem(TOKEN_KEY, result.token);

          // 콜백이 제공된 경우 호출 (TSK-02-03에서 authStore 연동용)
          onToken?.(result.token);
          break;
        }
      }
    });

    // cleanup: 언마운트 시 리스너 해제
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onToken]);
}
```

**설계 결정**:

1. **onToken 콜백 패턴**: 현재는 localStorage에 직접 저장하고, TSK-02-03에서 authStore를 구현할 때 `onToken` 콜백을 통해 상태 업데이트를 연결한다. 이렇게 하면 이 태스크에서 authStore에 의존하지 않는다.

2. **onOpenUrl의 urls 배열**: Tauri deep-link 플러그인은 `onOpenUrl` 콜백에 URL 배열을 전달한다. 앱이 미실행 상태에서 딥링크를 통해 실행된 경우 큐잉된 URL들이 배열로 전달될 수 있다. 첫 번째 유효한 URL만 처리한다.

3. **TOKEN_KEY 상수**: localStorage 키를 상수로 관리하여 TSK-02-03에서 동일한 키로 접근할 수 있도록 한다.

---

## 7. 딥링크 수신 흐름 상세

### 7.1 앱 실행 중 딥링크 수신

```
[브라우저]
  │ 인증 성공 → 리다이렉트: ddobak://callback?token=eyJhbGci...
  │
  ▼
[macOS]
  │ URL scheme "ddobak://" → com.ddobakddobak.app 앱으로 전달
  │
  ▼
[Tauri deep-link 플러그인 (Rust)]
  │ URL을 프론트엔드로 이벤트 전달
  │
  ▼
[onOpenUrl 콜백 (React)]
  │ urls = ["ddobak://callback?token=eyJhbGci..."]
  │
  ▼
[parseDeepLink]
  │ { type: "callback", token: "eyJhbGci..." }
  │
  ▼
[localStorage.setItem("access_token", "eyJhbGci...")]
  │
  ▼
[onToken 콜백 → (TSK-02-03에서 authStore 연결)]
```

### 7.2 앱 미실행 상태에서 딥링크 수신

```
[브라우저]
  │ 리다이렉트: ddobak://callback?token=xxx
  │
  ▼
[macOS]
  │ URL scheme → 앱 실행 (launch)
  │ URL을 큐에 저장
  │
  ▼
[Tauri 앱 시작]
  │ deep-link 플러그인 초기화
  │ 큐의 URL을 onOpenUrl로 전달
  │
  ▼
[useDeepLink 훅] → 동일한 처리
```

**중요**: deep-link 플러그인을 `tauri::Builder`에서 가장 먼저 등록해야 앱 시작 시 큐잉된 URL이 누락되지 않는다.

---

## 8. 테스트 전략

### 8.1 단위 테스트: deepLinkParser

```typescript
// frontend/src/__tests__/lib/deepLinkParser.test.ts

import { describe, it, expect } from 'vitest';
import { parseDeepLink } from '../../lib/deepLinkParser';

describe('parseDeepLink', () => {
  it('유효한 callback URL에서 token을 추출한다', () => {
    const result = parseDeepLink('ddobak://callback?token=eyJhbGci...');
    expect(result).toEqual({ type: 'callback', token: 'eyJhbGci...' });
  });

  it('token이 없으면 null을 반환한다', () => {
    expect(parseDeepLink('ddobak://callback')).toBeNull();
  });

  it('hostname이 callback이 아니면 null을 반환한다', () => {
    expect(parseDeepLink('ddobak://other?token=xxx')).toBeNull();
  });

  it('protocol이 ddobak이 아니면 null을 반환한다', () => {
    expect(parseDeepLink('https://callback?token=xxx')).toBeNull();
  });

  it('잘못된 URL이면 null을 반환한다', () => {
    expect(parseDeepLink('not-a-url')).toBeNull();
  });

  it('URL-encoded token을 올바르게 처리한다', () => {
    const encoded = encodeURIComponent('eyJ+test/value=');
    const result = parseDeepLink(`ddobak://callback?token=${encoded}`);
    expect(result?.token).toBe('eyJ+test/value=');
  });

  it('빈 문자열이면 null을 반환한다', () => {
    expect(parseDeepLink('')).toBeNull();
  });
});
```

### 8.2 훅 테스트: useDeepLink

```typescript
// frontend/src/__tests__/hooks/useDeepLink.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// @tauri-apps/plugin-deep-link 모킹
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn(),
}));

import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { useDeepLink } from '../../hooks/useDeepLink';

describe('useDeepLink', () => {
  const mockUnlisten = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (onOpenUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUnlisten);
  });

  it('onOpenUrl 리스너를 등록한다', () => {
    renderHook(() => useDeepLink());
    expect(onOpenUrl).toHaveBeenCalledOnce();
  });

  it('유효한 URL 수신 시 token을 localStorage에 저장한다', () => {
    let callback: (urls: string[]) => void;
    (onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb;
      return Promise.resolve(mockUnlisten);
    });

    renderHook(() => useDeepLink());
    callback!(['ddobak://callback?token=test-jwt-token']);

    expect(localStorage.getItem('access_token')).toBe('test-jwt-token');
  });

  it('onToken 콜백을 호출한다', () => {
    let callback: (urls: string[]) => void;
    (onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb;
      return Promise.resolve(mockUnlisten);
    });

    const onToken = vi.fn();
    renderHook(() => useDeepLink(onToken));
    callback!(['ddobak://callback?token=test-jwt-token']);

    expect(onToken).toHaveBeenCalledWith('test-jwt-token');
  });

  it('잘못된 URL은 무시한다', () => {
    let callback: (urls: string[]) => void;
    (onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb;
      return Promise.resolve(mockUnlisten);
    });

    renderHook(() => useDeepLink());
    callback!(['https://malicious.com?token=xxx']);

    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('언마운트 시 리스너를 해제한다', async () => {
    (onOpenUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUnlisten);

    const { unmount } = renderHook(() => useDeepLink());
    unmount();

    // Promise가 resolve될 때까지 대기
    await vi.waitFor(() => {
      expect(mockUnlisten).toHaveBeenCalled();
    });
  });
});
```

### 8.3 수동 테스트 (E2E)

딥링크 수신은 OS 레벨의 URL scheme 등록이 필요하므로, 개발 중 수동 테스트로 검증한다.

**macOS 수동 테스트 절차:**

1. `npm run tauri:dev`로 앱 실행
2. 터미널에서 `open "ddobak://callback?token=test-manual-token"` 실행
3. 확인 사항:
   - 앱이 포커스를 받는가
   - DevTools Console에 URL 수신 로그가 출력되는가
   - `localStorage.getItem('access_token')` = `"test-manual-token"`인가

**앱 미실행 상태 테스트:**

1. 앱을 빌드: `npm run tauri:build`
2. 빌드된 앱을 실행한 후 종료
3. 터미널에서 `open "ddobak://callback?token=test-cold-start"` 실행
4. 앱이 자동으로 실행되고 토큰이 저장되는지 확인

### 8.4 테스트 범위 요약

| 테스트 유형 | 파일 | 검증 내용 |
|------------|------|----------|
| 단위 테스트 | `deepLinkParser.test.ts` | URL 파싱 정확성, 엣지 케이스 |
| 훅 테스트 | `useDeepLink.test.ts` | 리스너 등록/해제, localStorage 저장, 콜백 호출 |
| 수동 E2E | (터미널 + 앱) | OS URL scheme 등록, 실제 딥링크 수신 |

---

## 9. 구현 순서 (체크리스트)

### Phase 1: 의존성 설치

- [ ] `frontend/src-tauri/Cargo.toml`에 `tauri-plugin-deep-link = "2"` 추가
- [ ] `frontend/package.json`에 `@tauri-apps/plugin-deep-link` 추가 -> `npm install`
- [ ] `cargo build` 성공 확인

### Phase 2: Tauri 설정

- [ ] `tauri.conf.json`에 `plugins.deep-link.desktop.schemes` 추가
- [ ] `capabilities/default.json`에 `deep-link:default` permission 추가
- [ ] `Info.plist`에 `CFBundleURLTypes` 추가
- [ ] `lib.rs`에 `tauri_plugin_deep_link::init()` 등록

### Phase 3: Frontend 코드

- [ ] `lib/deepLinkParser.ts` 생성 (URL 파싱 유틸)
- [ ] `hooks/useDeepLink.ts` 생성 (onOpenUrl 리스너)

### Phase 4: 테스트

- [ ] `deepLinkParser.test.ts` 단위 테스트 작성 및 통과
- [ ] `useDeepLink.test.ts` 훅 테스트 작성 및 통과
- [ ] `npm run tauri:dev` 후 수동 딥링크 테스트

### Phase 5: 검증

- [ ] `open "ddobak://callback?token=test"` 로 앱에 토큰 수신 확인
- [ ] localStorage에 `access_token` 저장 확인
- [ ] 기존 기능에 영향 없음 확인 (`npm run test` 전체 통과)

---

## 10. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 개발 모드(`tauri dev`)에서 URL scheme 미등록 | 수동 테스트 불가 | Info.plist 명시적 선언으로 해결. 그래도 안 되면 빌드 후 테스트 |
| `new URL("ddobak://...")` 파싱 실패 (브라우저 호환) | token 추출 불가 | Tauri WebView(WebKit/Chromium)에서 커스텀 스킴 URL 파싱은 정상 동작. 테스트로 검증 |
| 앱 미실행 시 딥링크 큐잉 누락 | cold-start 시 토큰 수신 실패 | deep-link 플러그인을 Builder 최상단에 등록하여 초기화 우선순위 확보 |
| macOS Gatekeeper가 URL scheme 등록 차단 | 개발 빌드에서 딥링크 미동작 | `tauri dev` 모드에서는 Gatekeeper 미적용. 배포 빌드 시 코드 서명 필요 (별도 태스크) |
| Windows에서 URL scheme 등록 방식 상이 | Windows 빌드 시 추가 설정 필요 | Tauri deep-link 플러그인이 Windows 레지스트리 등록을 자동 처리. tauri.conf.json의 desktop.schemes 설정으로 충분 |

---

## 11. 이 태스크 범위 외 (후속 태스크)

| 항목 | 담당 태스크 |
|------|-----------|
| authStore (Zustand) 인증 상태 관리 | TSK-02-03 |
| useDeepLink의 onToken 콜백으로 authStore 연동 | TSK-02-03 |
| 로그인 버튼 -> shell.open() -> 브라우저 | TSK-02-03 |
| API 클라이언트(ky) JWT 헤더 자동 첨부 | TSK-02-03 |
| 서버 URL 설정 UI | TSK-02-02 |
| 라우팅 인증 가드 | TSK-02-04 |
