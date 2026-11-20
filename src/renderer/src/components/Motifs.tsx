import type { Motif } from '@shared/types'
import { MOTIF_VI } from '@shared/tactics'

/** Danh sách motif chiến thuật; rê chuột để tô sáng các ô liên quan trên bàn cờ. */
export function MotifList({
  title,
  motifs,
  onHover
}: {
  title: string
  motifs: Motif[]
  onHover: (squares: string[] | null) => void
}) {
  if (motifs.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</div>
      <div className="space-y-1">
        {motifs.map((m, i) => (
          <div
            key={i}
            className="cursor-default rounded border border-line bg-panel-2 px-2 py-1 text-sm hover:border-warn"
            onMouseEnter={() => onHover(m.squares)}
            onMouseLeave={() => onHover(null)}
          >
            <span className="font-medium text-warn">{MOTIF_VI[m.kind]}</span> — {m.text}
          </div>
        ))}
      </div>
    </div>
  )
}
