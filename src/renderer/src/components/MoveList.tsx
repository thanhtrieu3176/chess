import { memo, useEffect, useRef, type ReactNode } from 'react'
import type { Classification } from '@shared/types'
import { CLASS_INFO } from '@shared/analysis/classify'
import type { MoveTree, TreeNode } from '@shared/tree'

interface Props {
  tree: MoveTree
  /** Tăng mỗi khi cây thay đổi (cây là cấu trúc mutable). */
  version: number
  current: TreeNode
  onSelect: (n: TreeNode) => void
  classOf?: (n: TreeNode) => Classification | undefined
}

function moveNo(n: TreeNode): string {
  const parts = n.parent!.fen.split(' ')
  return parts[1] === 'w' ? `${parts[5]}.` : `${parts[5]}...`
}

/** Danh sách nước: biến chính dạng 2 cột, biến phụ hiển thị thụt lề ngay sau nước rẽ nhánh. */
export const MoveList = memo(function MoveList({ tree, current, onSelect, classOf }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-current="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const Move = ({ n, showNo }: { n: TreeNode; showNo?: boolean }) => {
    const cls = classOf?.(n)
    const info = cls ? CLASS_INFO[cls] : null
    return (
      <button
        data-current={n === current ? '1' : undefined}
        onClick={() => onSelect(n)}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-left hover:bg-line ${n === current ? 'bg-accent/30 font-semibold' : ''}`}
        title={info?.vi}
      >
        {showNo && <span className="text-muted">{moveNo(n)}</span>}
        {n.san}
        {info && cls !== 'best' && cls !== 'excellent' && cls !== 'good' && (
          <span className="text-xs font-bold" style={{ color: info.color }}>
            {info.symbol}
          </span>
        )}
        {n.comment && <span className="text-xs text-muted">💬</span>}
      </button>
    )
  }

  /** Một biến phụ (đệ quy cho biến lồng nhau). */
  const variation = (start: TreeNode, depth: number): ReactNode => {
    const items: ReactNode[] = []
    let n: TreeNode | undefined = start
    let first = true
    while (n) {
      const isWhite = n.parent!.fen.split(' ')[1] === 'w'
      items.push(<Move key={n.id} n={n} showNo={first || isWhite} />)
      first = false
      const [next, ...alts]: TreeNode[] = n.children
      for (const alt of alts) items.push(<span key={`v${alt.id}`}>({variation(alt, depth + 1)})</span>)
      if (alts.length) first = true
      n = next
    }
    return <span className="inline">{items}</span>
  }

  const rows: ReactNode[] = []
  const main = tree.mainline()
  let i = 0
  while (i < main.length) {
    const a = main[i]!
    const aWhite = a.parent!.fen.split(' ')[1] === 'w'
    const w = aWhite ? a : null
    const b = aWhite ? main[i + 1] : a
    const no = moveNo(a).replace('...', '.')
    rows.push(
      <div key={`r${a.id}`} className="grid grid-cols-[2.5rem_1fr_1fr] items-center">
        <span className="text-muted">{no}</span>
        <span>{w ? <Move n={w} /> : '…'}</span>
        <span>{b && (b !== w) ? <Move n={b} /> : null}</span>
      </div>
    )
    for (const n of [w, b]) {
      if (!n || n.parent!.children.length < 2) continue
      for (const alt of n.parent!.children.slice(1)) {
        rows.push(
          <div key={`alt${alt.id}`} className="my-0.5 ml-4 border-l-2 border-line pl-2 text-sm text-muted">
            {variation(alt, 1)}
          </div>
        )
      }
    }
    i += aWhite && b ? 2 : 1
  }

  return (
    <div ref={ref} className="space-y-0.5 text-sm">
      {rows.length ? rows : <div className="text-muted">Chưa có nước đi.</div>}
    </div>
  )
})
