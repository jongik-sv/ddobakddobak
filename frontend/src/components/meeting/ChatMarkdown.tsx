import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CITATION_RE } from '../../lib/citationMarkers'
import { TimestampBadge } from './TimestampBadge'

// 마커 → 마크다운 링크 치환: ⟦t:125000|s:화자 1⟧ → [⏱](ddobak-seek:125000:화자%201)
function markersToSeekLinks(text: string): string {
  return text.replace(new RegExp(CITATION_RE.source, 'g'), (_m, ms, sp) =>
    `[⏱](ddobak-seek:${ms}:${encodeURIComponent(sp)})`)
}

// ddobak-seek: 프로토콜은 내부 전용 — URL sanitizer에서 허용
function urlTransform(url: string): string {
  if (url.startsWith('ddobak-seek:')) return url
  return defaultUrlTransform(url)
}

// Compact chat-bubble markdown styles. No @tailwindcss/typography is installed,
// so every element is styled explicitly via component overrides.
// react-markdown does NOT render raw HTML by default (no rehype-raw) — keep it safe.
const MAP: Components = {
  h1: ({ children }) => <h1 className="text-base font-semibold mt-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold mt-2 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-1">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-1">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="bg-gray-800 text-gray-100 rounded p-2 overflow-x-auto text-xs my-1 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-blue-600 underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <table className="w-full text-xs border-collapse my-1">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-gray-300 px-1.5 py-0.5 text-left">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-300 px-1.5 py-0.5 text-left">{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-300 pl-2 text-gray-600">{children}</blockquote>
  ),
}

export function ChatMarkdown({ content, onSeek }: { content: string; onSeek?: (ms: number) => void }) {
  const components: Components = {
    ...MAP,
    a: ({ children, href }) => {
      if (href && href.startsWith('ddobak-seek:')) {
        // href format: ddobak-seek:<ms>:<encodedSpeaker>
        const withoutScheme = href.slice('ddobak-seek:'.length)
        const colonIdx = withoutScheme.indexOf(':')
        const ms = Number(withoutScheme.slice(0, colonIdx))
        const sp = decodeURIComponent(withoutScheme.slice(colonIdx + 1))
        return (
          <TimestampBadge
            ms={ms}
            speaker={sp}
            onSeek={onSeek ?? (() => {})}
            isAudioReady={!!onSeek}
          />
        )
      }
      return (
        <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    },
  }
  return (
    <div className="text-sm leading-relaxed break-words space-y-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {markersToSeekLinks(content)}
      </ReactMarkdown>
    </div>
  )
}
