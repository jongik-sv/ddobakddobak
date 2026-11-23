import type { DiffOp } from '../../api/sttTermLearning'

interface Props {
  ops: DiffOp[]
  collapseEqual?: boolean
}

const COLLAPSE_MIN = 3

type Block = { kind: 'op'; op: DiffOp } | { kind: 'fold'; count: number }

function toBlocks(ops: DiffOp[], collapse: boolean): Block[] {
  if (!collapse) return ops.map((op) => ({ kind: 'op', op }))
  const out: Block[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].op !== 'equal') {
      out.push({ kind: 'op', op: ops[i++] })
      continue
    }
    let j = i
    while (j < ops.length && ops[j].op === 'equal') j++
    if (j - i >= COLLAPSE_MIN) out.push({ kind: 'fold', count: j - i })
    else for (let k = i; k < j; k++) out.push({ kind: 'op', op: ops[k] })
    i = j
  }
  return out
}

const STYLE: Record<DiffOp['op'], string> = {
  equal: 'text-foreground',
  delete: 'bg-red-100 text-red-800 line-through dark:bg-red-950/40 dark:text-red-300',
  insert: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
}

export default function LineDiffView({ ops, collapseEqual = false }: Props) {
  const blocks = toBlocks(ops, collapseEqual)
  return (
    <div className="font-mono text-xs leading-relaxed">
      {blocks.map((b, idx) =>
        b.kind === 'fold' ? (
          <div key={idx} className="px-2 py-0.5 text-muted-foreground italic">
            … {b.count}줄 동일
          </div>
        ) : (
          <div
            key={idx}
            data-op={b.op.op}
            className={`px-2 py-0.5 whitespace-pre-wrap break-words ${STYLE[b.op.op]}`}
          >
            <span>{b.op.text}</span>
          </div>
        ),
      )}
    </div>
  )
}
