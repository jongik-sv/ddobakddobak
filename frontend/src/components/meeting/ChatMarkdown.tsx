import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed break-words space-y-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MAP}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
