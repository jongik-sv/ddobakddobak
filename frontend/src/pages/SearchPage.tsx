import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react'
import { searchMeetings } from '../api/search'
import type { SearchResult, SearchResponse } from '../api/search'

function TypeBadge({ type }: { type: SearchResult['type'] }) {
  if (type === 'transcript') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
        전사
      </span>
    )
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
      요약
    </span>
  )
}

function HighlightSnippet({ html }: { html: string }) {
  return (
    <p
      className="text-sm text-muted-foreground line-clamp-2 [&>mark]:bg-yellow-200 [&>mark]:text-foreground [&>mark]:rounded-sm [&>mark]:px-0.5"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default function SearchPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQ = searchParams.get('q') || ''

  const [query, setQuery] = useState(initialQ)
  const [results, setResults] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [isLoading, setIsLoading] = useState(false)

  // 필터
  const [showFilters, setShowFilters] = useState(false)
  const [speaker, setSpeaker] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [status, setStatus] = useState('')

  const doSearch = useCallback(async (searchQuery: string, searchPage: number) => {
    if (!searchQuery.trim()) {
      setResults([])
      setTotal(0)
      return
    }
    setIsLoading(true)
    try {
      const res: SearchResponse = await searchMeetings({
        q: searchQuery,
        page: searchPage,
        per_page: perPage,
        speaker: speaker || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        status: status || undefined,
      })
      setResults(res.results)
      setTotal(res.total)
      setPage(res.page)
    } catch {
      setResults([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }, [perPage, speaker, dateFrom, dateTo, status])

  useEffect(() => {
    if (initialQ) {
      doSearch(initialQ, 1)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchParams(query ? { q: query } : {})
    doSearch(query, 1)
  }

  const totalPages = Math.ceil(total / perPage)

  return (
    <div className="flex flex-col h-full">
      {/* 검색 헤더 */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-2 items-center max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="회의록, 전사 내용 검색..."
              className="w-full pl-10 pr-4 py-2 border border-input rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            검색
          </button>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg border transition-colors ${showFilters ? 'bg-accent text-accent-foreground border-accent' : 'border-input text-muted-foreground hover:bg-accent'}`}
            title="필터"
          >
            <Filter className="w-4 h-4" />
          </button>
        </form>

        {/* 필터 패널 */}
        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-3 max-w-2xl">
            <input
              type="text"
              value={speaker}
              onChange={(e) => setSpeaker(e.target.value)}
              placeholder="화자 (예: SPEAKER_00)"
              className="px-3 py-1.5 border border-input rounded-md text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring w-44"
            />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-1.5 border border-input rounded-md text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="self-center text-muted-foreground text-sm">~</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-1.5 border border-input rounded-md text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="px-3 py-1.5 border border-input rounded-md text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">상태 전체</option>
              <option value="pending">대기중</option>
              <option value="recording">녹음중</option>
              <option value="completed">완료</option>
            </select>
          </div>
        )}
      </div>

      {/* 결과 영역 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="text-center text-muted-foreground py-20">
            {query ? '검색 결과가 없습니다.' : '검색어를 입력하세요.'}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              총 {total}건의 결과
            </p>
            <div className="space-y-2">
              {results.map((result, idx) => (
                <button
                  key={`${result.meeting_id}-${result.type}-${idx}`}
                  onClick={() => navigate(`/meetings/${result.meeting_id}`)}
                  className="w-full text-left p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <TypeBadge type={result.type} />
                    <span className="text-sm font-medium text-foreground truncate">
                      {result.meeting_title}
                    </span>
                    {result.speaker && (
                      <span className="text-xs text-muted-foreground">
                        {result.speaker}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {new Date(result.created_at).toLocaleDateString('ko-KR')}
                    </span>
                  </div>
                  <HighlightSnippet html={result.snippet} />
                </button>
              ))}
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  onClick={() => doSearch(query, page - 1)}
                  disabled={page <= 1}
                  className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => doSearch(query, page + 1)}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
