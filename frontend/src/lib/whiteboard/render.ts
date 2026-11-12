import type { WhiteboardBoard, WhiteboardItem, WhiteboardTag, WhiteboardZone, ZoneKind } from './schema'

const CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src data:"

// 글꼴만 외부 허용(회의 데이터는 나가지 않음). 오프라인이면 시스템 글꼴로 폴백.
const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&family=Gowun+Dodum&family=IBM+Plex+Mono:wght@500&display=swap'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const TAG_CLASS: Record<WhiteboardTag, string> = { 확정: 'ok', 검토: 'rv', 미결: 'op' }
const KIND_COLOR: Record<ZoneKind, string> = {
  topic: 'blue',
  decision: 'green',
  issue: 'red',
  todo: 'blue',
  schedule: 'green',
}
const NOTE_COLORS = ['', 'p', 'b', 'm']

const STYLE = `
:root{--room:#dfe4e7;--board:#fbfcfc;--frame:#b8c1c7;--grid:#e9eef1;--ink:#1c262e;--muted:#5d6b75;--blue:#1d58b8;--red:#c33228;--green:#18774a;--sy:#fff1a1;--sp:#ffd7e1;--sm:#cdeedb;--sb:#d6e6ff;--sticky-ink:#26231a;--shadow:0 1px 1px rgba(30,40,50,.12),0 6px 14px -6px rgba(30,40,50,.28);--marker:"Nanum Pen Script","Gowun Dodum","Apple SD Gothic Neo","Malgun Gothic",cursive;--body:"Gowun Dodum","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--room:#0f1417;--board:#1a2126;--frame:#3a464e;--grid:#222b31;--ink:#e4eaee;--muted:#9aa8b2;--blue:#7fb0ff;--red:#ff8a7e;--green:#6fd3a0;--sy:#4b4421;--sp:#4d2a33;--sm:#1f4231;--sb:#233a5c;--sticky-ink:#f1ede0;--shadow:0 1px 1px rgba(0,0,0,.4),0 8px 16px -6px rgba(0,0,0,.6);color-scheme:dark}}
:root[data-theme="dark"]{--room:#0f1417;--board:#1a2126;--frame:#3a464e;--grid:#222b31;--ink:#e4eaee;--muted:#9aa8b2;--blue:#7fb0ff;--red:#ff8a7e;--green:#6fd3a0;--sy:#4b4421;--sp:#4d2a33;--sm:#1f4231;--sb:#233a5c;--sticky-ink:#f1ede0;--shadow:0 1px 1px rgba(0,0,0,.4),0 8px 16px -6px rgba(0,0,0,.6);color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--room);color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.6;padding:24px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px))}
.board{max-width:1240px;margin:0 auto;background:var(--board);border:10px solid var(--frame);border-radius:6px;background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:32px 32px;padding:clamp(16px,3vw,36px);display:grid;gap:36px}
.mk{font-family:var(--marker);font-weight:400;line-height:1.1;text-wrap:balance}
h1.mk{font-size:clamp(40px,6vw,64px);margin:0;color:var(--blue)}
h2.mk{font-size:clamp(30px,4vw,40px);margin:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px}
h2 .u{text-decoration:underline;text-decoration-thickness:3px;text-underline-offset:6px}
.c-blue{color:var(--blue)}.c-red{color:var(--red)}.c-green{color:var(--green)}
header{display:grid;gap:14px}
.headline{margin:0;font-size:18px;max-width:70ch}
.meta{font-family:var(--mono);font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 14px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.filter{display:flex;gap:8px;flex-wrap:wrap}
button{font:inherit;font-size:14px;background:transparent;color:var(--ink);border:2px solid var(--frame);border-radius:999px;padding:3px 14px;cursor:pointer}
.filter button[aria-pressed="true"]{border-color:var(--ink);background:var(--ink);color:var(--board)}
button:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.zones{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:36px 28px;align-items:start}
.zone{display:grid;gap:16px;min-width:0;align-content:start}
.zone.wide{grid-column:1/-1}
@media (max-width:760px){.zones{grid-template-columns:minmax(0,1fr)}}
.it{transition:opacity .2s;overflow-wrap:anywhere;min-width:0}
.notes{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px}
.note{background:var(--sy);color:var(--sticky-ink);padding:14px 14px 16px;box-shadow:var(--shadow);border-radius:2px;display:grid;gap:6px;align-content:start}
.note:nth-child(3n+1){transform:rotate(-1deg)}.note:nth-child(3n+2){transform:rotate(.8deg)}.note:nth-child(3n){transform:rotate(-.4deg)}
.note.p{background:var(--sp)}.note.m{background:var(--sm)}.note.b{background:var(--sb)}
.note p{margin:0;font-size:14px}
.note.issue{background:var(--sp)}
.note .warn{color:var(--red);font-size:13.5px}
.note .warn::before{content:"⚠ "}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.card{border:2px solid var(--ink);border-radius:8px;padding:12px 14px;background:var(--board);display:grid;gap:8px;align-content:start}
.card p{margin:0;font-size:14.5px}
.checks{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.check{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:start;background:var(--board);border:2px dashed var(--frame);border-radius:8px;padding:8px 12px}
.check::before{content:"";width:16px;height:16px;margin-top:4px;border:2px solid var(--ink);border-radius:3px;background:var(--board)}
.check p{margin:0;font-size:14.5px}
.check .chips{grid-column:2}
.chips{display:flex;flex-wrap:wrap;gap:4px 8px}
.chip{font-family:var(--mono);font-size:12px;border:1.5px solid var(--muted);color:var(--muted);border-radius:999px;padding:0 9px;white-space:nowrap}
.chip.due{border-color:var(--red);color:var(--red)}
.chip.who{border-color:var(--blue);color:var(--blue)}
.timeline{list-style:none;margin:0;padding:0 0 0 14px;border-left:3px dashed var(--green);display:grid;gap:14px}
.when{position:relative;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline}
.when::before{content:"";position:absolute;left:-23px;top:9px;width:11px;height:11px;border-radius:50%;background:var(--green)}
.when .date{font-family:var(--marker);font-size:26px;line-height:1.1;color:var(--green);white-space:nowrap}
.when p{margin:0;font-size:14.5px}
.when .chips{grid-column:2}
.tag{font-size:12px;font-family:var(--mono);border-radius:3px;padding:1px 7px;white-space:nowrap;border:1.5px solid currentColor;justify-self:start;background:var(--board)}
.tag.ok{color:var(--green)}.tag.rv{color:var(--blue)}.tag.op{color:var(--red)}
.board[data-filter="확정"] .it:not([data-tag="확정"]),.board[data-filter="검토"] .it:not([data-tag="검토"]),.board[data-filter="미결"] .it:not([data-tag="미결"]){opacity:.22}
@media (prefers-reduced-motion:reduce){.it{transition:none}}
footer{font-size:12.5px;color:var(--muted);border-top:2px solid var(--frame);padding-top:12px}
@media print{body{background:#fff}.bar{display:none}}
`

const SCRIPT = `
(function(){
  var board=document.getElementById('board');
  var btns=board.querySelectorAll('.filter button');
  btns.forEach(function(b){
    b.addEventListener('click',function(){
      board.setAttribute('data-filter',b.getAttribute('data-f'));
      btns.forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});
    });
  });
  var root=document.documentElement,t=document.getElementById('theme');
  t.addEventListener('click',function(){
    var dark=root.getAttribute('data-theme')==='dark'||(root.getAttribute('data-theme')!=='light'&&window.matchMedia('(prefers-color-scheme:dark)').matches);
    root.setAttribute('data-theme',dark?'light':'dark');
  });
})();
`

function tagChip(item: WhiteboardItem): string {
  return item.tag ? `<span class="tag ${TAG_CLASS[item.tag]}">${escapeHtml(item.tag)}</span>` : ''
}

function chips(item: WhiteboardItem, withDue = true): string {
  const c: string[] = []
  if (item.who) c.push(`<span class="chip who">담당 ${escapeHtml(item.who)}</span>`)
  if (withDue && item.due) c.push(`<span class="chip due">기한 ${escapeHtml(item.due)}</span>`)
  return c.length ? `<div class="chips">${c.join('')}</div>` : ''
}

function dataTag(item: WhiteboardItem): string {
  return item.tag ? ` data-tag="${escapeHtml(item.tag)}"` : ''
}

function renderItem(kind: ZoneKind, item: WhiteboardItem, idx: number): string {
  const dt = dataTag(item)
  const text = escapeHtml(item.text)
  switch (kind) {
    case 'decision':
      return `<div class="it card"${dt}>${tagChip(item)}<p>${text}</p>${chips(item)}</div>`
    case 'issue':
      return `<div class="it note issue"${dt}>${tagChip(item)}<p class="warn">${text}</p>${chips(item)}</div>`
    case 'todo':
      return `<li class="it check"${dt}><p>${text}${item.tag ? ' ' + tagChip(item) : ''}</p>${chips(item)}</li>`
    case 'schedule':
      return (
        `<li class="it when"${dt}>` +
        `<span class="date">${item.due ? escapeHtml(item.due) : '일정'}</span>` +
        `<p>${text}${item.tag ? ' ' + tagChip(item) : ''}</p>${chips(item, false)}</li>`
      )
    default: {
      const color = NOTE_COLORS[idx % NOTE_COLORS.length]
      const cls = color ? `it note ${color}` : 'it note'
      return `<div class="${cls}"${dt}>${tagChip(item)}<p>${text}</p>${chips(item)}</div>`
    }
  }
}

function renderZone(z: WhiteboardZone, wide: boolean): string {
  const items = z.items.map((it, i) => renderItem(z.kind, it, i)).join('')
  let body: string
  switch (z.kind) {
    case 'decision':
      body = `<div class="cards">${items}</div>`
      break
    case 'todo':
      body = `<ul class="checks">${items}</ul>`
      break
    case 'schedule':
      body = `<ul class="timeline">${items}</ul>`
      break
    default:
      body = `<div class="notes">${items}</div>`
  }
  return (
    `<section class="zone${wide ? ' wide' : ''}"><h2 class="mk"><span class="u c-${KIND_COLOR[z.kind]}">${escapeHtml(z.title)}</span></h2>` +
    `${body}</section>`
  )
}

/** 구역 폭 결정: 항목이 많으면 전폭, 짧은 구역은 2열 짝짓기(짝이 없으면 전폭). */
function layoutWide(zones: WhiteboardZone[]): boolean[] {
  const wide = zones.map((z) => z.items.length >= 3)
  let i = 0
  while (i < zones.length) {
    if (wide[i]) {
      i++
      continue
    }
    if (i + 1 < zones.length && !wide[i + 1]) i += 2
    else {
      wide[i] = true
      i++
    }
  }
  return wide
}

/** 보드 JSON → 자기완결 HTML. 모든 데이터 문자열은 escape 되며 script 에는 데이터가 들어가지 않는다. */
export function renderBoardHtml(board: WhiteboardBoard): string {
  const wide = layoutWide(board.zones)
  const zones = board.zones.map((z, i) => renderZone(z, wide[i])).join('\n')
  const itemCount = board.zones.reduce((n, z) => n + z.items.length, 0)
  const filters = [
    ['all', '전체'],
    ['확정', '확정'],
    ['검토', '검토'],
    ['미결', '미결'],
  ]
    .map(([f, label], i) => `<button type="button" data-f="${escapeHtml(f)}" aria-pressed="${i === 0}">${label}</button>`)
    .join('')
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(board.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_LINK}">
<style>${STYLE}</style>
</head>
<body>
<div class="board" id="board" data-filter="all">
<header>
<h1 class="mk">${escapeHtml(board.title)}</h1>
<p class="headline">${escapeHtml(board.headline)}</p>
<div class="meta"><span>${escapeHtml(board.date)}</span><span>구역 ${board.zones.length} · 항목 ${itemCount}</span></div>
<div class="bar"><div class="filter" role="group" aria-label="태그로 강조">${filters}</div><button type="button" id="theme" aria-label="다크 모드 전환">다크 모드</button></div>
</header>
<div class="zones">
${zones}
</div>
<footer>또박또박 AI 회의록으로 생성 · ${escapeHtml(board.date)}</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`
}
