#!/usr/bin/env python3
"""또박또박(ddobak) 회의 API CLI — 파이썬 표준 라이브러리만 사용.

환경변수:
  DDOBAK_API_URL       API 베이스 URL (예: https://10.110.2.175)
  DDOBAK_API_TOKEN     Bearer 토큰 (형식: ddbk_...)
  DDOBAK_API_INSECURE  1이면 TLS 인증서 검증을 생략(사설 인증서 환경)

사용법:
  ddobak_api.py <subcommand> [args...] [--json]

서브커맨드 목록은 `ddobak_api.py --help` 참고.
"""

import argparse
import json
import mimetypes
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class ApiError(Exception):
    def __init__(self, code, message, status=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _base_url():
    url = os.environ.get("DDOBAK_API_URL")
    if not url:
        print("오류: 환경변수 DDOBAK_API_URL이 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)
    return url.rstrip("/")


def _token():
    token = os.environ.get("DDOBAK_API_TOKEN")
    if not token:
        print("오류: 환경변수 DDOBAK_API_TOKEN이 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)
    return token


def _ssl_context():
    if os.environ.get("DDOBAK_API_INSECURE") == "1":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return None


def _request(method, path, params=None, json_body=None, raw_body=None, content_type=None, max_retries=3):
    """API 요청 실행. 429는 Retry-After(초, 기본 2초)만큼 대기 후 최대 max_retries회 재시도."""
    url = _base_url() + path
    if params:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        if query:
            url = f"{url}?{query}"

    headers = {
        "Authorization": f"Bearer {_token()}",
        "Accept": "application/json",
    }

    body = None
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif raw_body is not None:
        body = raw_body
        if content_type:
            headers["Content-Type"] = content_type

    attempt = 0
    while True:
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, context=_ssl_context()) as resp:
                raw = resp.read()
                if not raw:
                    return {}
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries:
                wait = int(e.headers.get("Retry-After", "2") or "2")
                time.sleep(wait)
                attempt += 1
                continue
            raw = e.read()
            try:
                payload = json.loads(raw.decode("utf-8"))
                err = payload.get("error", {})
                raise ApiError(err.get("code", str(e.code)), err.get("message", str(e)), status=e.code) from None
            except (json.JSONDecodeError, AttributeError):
                raise ApiError(str(e.code), raw.decode("utf-8", "replace") or str(e), status=e.code) from None
        except urllib.error.URLError as e:
            raise ApiError("connection_error", str(e.reason)) from None


def _out(data, args, formatter=None):
    if getattr(args, "json", False) or formatter is None:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        formatter(data)


def _fmt_ms(ms):
    if ms is None:
        return "--:--"
    total_seconds = int(ms) // 1000
    return f"{total_seconds // 60:02d}:{total_seconds % 60:02d}"


# ---- 서브커맨드 -----------------------------------------------------------

def cmd_me(args):
    _out(_request("GET", "/api/ext/v1/me"), args, lambda d: print(json.dumps(d, ensure_ascii=False, indent=2)))


def cmd_projects(args):
    def fmt(d):
        for p in d.get("projects", []):
            print(f"{p.get('id')}\t{p.get('name')}")
    _out(_request("GET", "/api/ext/v1/projects"), args, fmt)


def cmd_folders(args):
    def fmt(d):
        for f in d.get("folders", []):
            print(f"{f.get('id')}\t{f.get('name')}\t(parent={f.get('parent_id')})")
    _out(_request("GET", f"/api/ext/v1/projects/{args.project_id}/folders"), args, fmt)


def cmd_meetings(args):
    params = {
        "project_id": args.project,
        "folder_id": args.folder,
        "from": args.from_,
        "to": args.to,
        "status": args.status,
        "page": args.page,
        "per_page": args.per_page,
    }

    def fmt(d):
        for m in d.get("meetings", []):
            print(f"{m.get('id')}\t{m.get('title')}\t{m.get('created_at', '')}")
        meta = d.get("meta", {})
        if meta:
            page = meta.get("page")
            total_pages = meta.get("total_pages")
            if total_pages and page and page < total_pages:
                print(f"# 다음 페이지: --page {page + 1} (총 {total_pages}페이지)", file=sys.stderr)
    _out(_request("GET", "/api/ext/v1/meetings", params=params), args, fmt)


def cmd_meeting(args):
    def fmt(d):
        m = d.get("meeting", d)
        print(f"제목: {m.get('title')}")
        print(f"ID: {m.get('id')}")
        print(f"상태: {m.get('status')}")
        print(f"생성: {m.get('created_at')}")
    _out(_request("GET", f"/api/ext/v1/meetings/{args.id}"), args, fmt)


def cmd_transcript(args):
    def fmt(d):
        for seg in d.get("transcripts", []):
            ts = _fmt_ms(seg.get("started_at_ms"))
            speaker = seg.get("speaker_name", "?")
            print(f"[{ts}] {speaker}: {seg.get('content', '')}")
    _out(_request("GET", f"/api/ext/v1/meetings/{args.id}/transcripts"), args, fmt)


def cmd_summary(args):
    def fmt(d):
        s = d.get("summary", d)
        kp = s.get("key_points") or []
        if kp:
            print("## 핵심 요약")
            for line in kp:
                print(f"- {line}")
        dec = s.get("decisions") or []
        if dec:
            print("\n## 결정 사항")
            for line in dec:
                print(f"- {line}")
        notes = s.get("notes_markdown")
        if notes:
            print("\n## 상세")
            print(notes)
    _out(_request("GET", f"/api/ext/v1/meetings/{args.id}/summary"), args, fmt)


def cmd_search(args):
    params = {"q": args.query, "project_id": args.project, "limit": args.limit}

    def fmt(d):
        results = d.get("results", {})
        transcripts = results.get("transcripts", [])
        summaries = results.get("summaries", [])
        if transcripts:
            print("## 전사 매치")
            for r in transcripts:
                print(f"[{r.get('meeting_id')}] {r.get('meeting_title')}")
                snippet = r.get("snippet")
                if snippet:
                    print(f"    {snippet}")
        if summaries:
            print("## 요약 매치")
            for r in summaries:
                print(f"[{r.get('meeting_id')}] {r.get('meeting_title')}")
                snippet = r.get("snippet")
                if snippet:
                    print(f"    {snippet}")
    _out(_request("GET", "/api/ext/v1/search", params=params), args, fmt)


def cmd_create(args):
    with open(args.transcript_file, "r", encoding="utf-8") as f:
        transcripts = json.load(f)
    body = {
        "title": args.title,
        "project_id": args.project,
        "folder_id": args.folder,
        "transcripts": transcripts,
    }
    _out(_request("POST", "/api/ext/v1/meetings", json_body=body), args,
         lambda d: print(f"생성됨: {d.get('meeting', d).get('id')}"))


def cmd_note(args):
    if args.content:
        result = _request("POST", f"/api/ext/v1/meetings/{args.id}/notes", json_body={"content": args.content})
        _out(result, args, lambda d: print("노트가 추가되었습니다."))
    else:
        def fmt(d):
            for n in d.get("notes", []):
                print(f"[{n.get('created_at')}] {n.get('content')}")
        _out(_request("GET", f"/api/ext/v1/meetings/{args.id}/notes"), args, fmt)


def cmd_summarize(args):
    def fmt(d):
        skipped = d.get("skipped")
        if skipped:
            print(f"건너뜀: {skipped}")
        else:
            print("요약 재생성이 시작되었습니다.")
    _out(_request("POST", f"/api/ext/v1/meetings/{args.id}/summarize"), args, fmt)


def cmd_upload_audio(args):
    boundary = uuid.uuid4().hex
    filename = os.path.basename(args.file)
    file_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    with open(args.file, "rb") as f:
        file_bytes = f.read()

    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
    )
    parts.append(f"Content-Type: {file_type}\r\n\r\n".encode())
    parts.append(file_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)

    result = _request(
        "POST",
        f"/api/ext/v1/meetings/{args.id}/audio",
        raw_body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    _out(result, args, lambda d: print("업로드되었습니다. STT 큐에 등록됨."))


def cmd_dump(args):
    meeting = _request("GET", f"/api/ext/v1/meetings/{args.id}").get("meeting", {})
    transcripts = _request("GET", f"/api/ext/v1/meetings/{args.id}/transcripts").get("transcripts", [])
    try:
        summary = _request("GET", f"/api/ext/v1/meetings/{args.id}/summary").get("summary")
    except ApiError:
        summary = None

    out_dir = args.out or "."
    os.makedirs(out_dir, exist_ok=True)
    title = meeting.get("title", f"meeting-{args.id}")
    safe_title = "".join(c for c in title if c not in '/\\:*?"<>|').strip() or f"meeting-{args.id}"
    path = os.path.join(out_dir, f"{safe_title}.md")

    lines = [f"# {title}", "", f"- ID: {meeting.get('id')}", f"- 생성: {meeting.get('created_at')}", ""]
    if summary:
        kp = summary.get("key_points") or []
        if kp:
            lines.append("## 핵심 요약")
            lines.extend(f"- {p}" for p in kp)
            lines.append("")
        dec = summary.get("decisions") or []
        if dec:
            lines.append("## 결정 사항")
            lines.extend(f"- {p}" for p in dec)
            lines.append("")
        if summary.get("notes_markdown"):
            lines.append("## 상세 요약")
            lines.append(summary["notes_markdown"])
            lines.append("")

    lines.append("## 전사")
    for seg in transcripts:
        ts = _fmt_ms(seg.get("started_at_ms"))
        lines.append(f"[{ts}] {seg.get('speaker_name', '?')}: {seg.get('content', '')}")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"저장됨: {path}")


# ---- argparse 조립 ---------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(prog="ddobak_api.py", description="또박또박 회의 API CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    def add(name, help_text):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--json", action="store_true", help="원본 JSON 출력")
        return p

    add("me", "토큰·사용자·스코프 확인").set_defaults(func=cmd_me)
    add("projects", "프로젝트 목록").set_defaults(func=cmd_projects)

    p = add("folders", "폴더 트리")
    p.add_argument("project_id")
    p.set_defaults(func=cmd_folders)

    p = add("meetings", "회의 목록")
    p.add_argument("--project", type=int)
    p.add_argument("--folder", type=int)
    p.add_argument("--from", dest="from_")
    p.add_argument("--to")
    p.add_argument("--status")
    p.add_argument("--page", type=int)
    p.add_argument("--per-page", dest="per_page", type=int)
    p.set_defaults(func=cmd_meetings)

    p = add("meeting", "회의 상세")
    p.add_argument("id")
    p.set_defaults(func=cmd_meeting)

    p = add("transcript", "전사 전체")
    p.add_argument("id")
    p.set_defaults(func=cmd_transcript)

    p = add("summary", "요약")
    p.add_argument("id")
    p.set_defaults(func=cmd_summary)

    p = add("search", "하이브리드 검색")
    p.add_argument("query")
    p.add_argument("--project", type=int)
    p.add_argument("--limit", type=int)
    p.set_defaults(func=cmd_search)

    p = add("create", "텍스트 전사 임포트 회의 생성")
    p.add_argument("--title", required=True)
    p.add_argument("--project", type=int, required=True)
    p.add_argument("--folder", type=int)
    p.add_argument("--transcript-file", required=True, help="[{speaker_name, content, started_at_ms?, ended_at_ms?}] JSON 파일")
    p.set_defaults(func=cmd_create)

    p = add("note", "노트 조회(기본) 또는 추가(--content)")
    p.add_argument("id")
    p.add_argument("--content")
    p.set_defaults(func=cmd_note)

    p = add("summarize", "요약 재생성 트리거")
    p.add_argument("id")
    p.set_defaults(func=cmd_summarize)

    p = add("upload-audio", "오디오 업로드 → STT 큐")
    p.add_argument("id")
    p.add_argument("file")
    p.set_defaults(func=cmd_upload_audio)

    p = add("dump", "회의 상세+전사+요약을 마크다운으로 저장")
    p.add_argument("id")
    p.add_argument("--out", help="출력 디렉토리 (기본: 현재 디렉토리)")
    p.set_defaults(func=cmd_dump)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except ApiError as e:
        print(f"오류: {e.message}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
