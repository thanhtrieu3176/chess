import { useEffect, useRef, useState } from 'react'
import type { ExplainRequest, ExplainResult } from '@shared/types'
import { parsePartialJson } from '@shared/partialJson'
import { Button, Notice } from './ui'

const LABELS: Record<string, string> = {
  tom_tat: 'Tóm tắt',
  vi_sao_nuoc_di_kem: 'Vì sao nước đi kém',
  vi_sao_nuoc_tot_nhat_tot_hon: 'Nước tốt nhất',
  y_tuong_chien_thuat: 'Ý tưởng chiến thuật',
  ke_hoach_tiep_theo: 'Kế hoạch tiếp theo',
  bai_hoc: 'Bài học',
  dien_bien: 'Diễn biến',
  buoc_ngoat: 'Bước ngoặt',
  y_tuong_chinh: 'Ý tưởng chính',
  ke_hoach_trang: 'Kế hoạch của Trắng',
  ke_hoach_den: 'Kế hoạch của Đen',
  cam_bay: 'Cạm bẫy phổ biến',
  cau_truc_tot: 'Cấu trúc tốt đặc trưng',
  loi_khuyen: 'Lời khuyên',
  tong_quan: 'Tổng quan',
  diem_yeu: 'Điểm yếu',
  goi_y_luyen_tap: 'Gợi ý luyện tập',
  vi_sao_loi_giai_dung: 'Vì sao lời giải đúng',
  vi_sao_nuoc_trong_van_sai: 'Vì sao nước trong ván sai'
}

function Value({ v, onPly }: { v: unknown; onPly?: (ply: number) => void }) {
  if (typeof v === 'string') return <p className="whitespace-pre-wrap">{v}</p>
  if (Array.isArray(v))
    return (
      <ul className="list-disc space-y-1 pl-5">
        {v.map((x, i) =>
          x && typeof x === 'object' && 'ply' in x ? (
            <li key={i}>
              <button className="text-accent hover:underline" onClick={() => onPly?.(Number((x as { ply: number }).ply))}>
                Nước {Math.ceil(Number((x as { ply: number }).ply) / 2)}
              </button>
              : {String((x as { mo_ta?: string }).mo_ta ?? '')}
            </li>
          ) : (
            <li key={i}>{String(x ?? '')}</li>
          )
        )}
      </ul>
    )
  return null
}

export function ExplanationView({ data, onPly }: { data: Record<string, unknown>; onPly?: (ply: number) => void }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {Object.entries(data)
        .filter(([k, v]) => LABELS[k] && v !== '' && v !== null && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => (
          <div key={k}>
            <div className="mb-0.5 text-xs font-semibold tracking-wide text-muted uppercase">{LABELS[k]}</div>
            <Value v={v} onPly={onPly} />
          </div>
        ))}
    </div>
  )
}

/**
 * Khung giải thích bằng Gemini: hiện ngay nếu đã có trong cache; tự gọi nếu `auto`;
 * ngược lại hiện nút "Giải thích". Chữ hiện dần khi đang stream.
 */
export function Explanation({
  req,
  auto,
  label = 'Giải thích',
  onPly
}: {
  req: ExplainRequest | null
  auto: boolean
  label?: string
  onPly?: (ply: number) => void
}) {
  const [result, setResult] = useState<ExplainResult | null>(null)
  const [streaming, setStreaming] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const reqKey = req ? JSON.stringify(req) : ''
  const active = useRef('')

  const run = async (cacheOnly: boolean) => {
    if (!req) return
    const id = `${reqKey}#${Math.random()}`
    active.current = id
    if (!cacheOnly) setLoading(true)
    const r = await window.api.explain(req, id, cacheOnly)
    if (active.current !== id) return
    setLoading(false)
    setStreaming(null)
    setResult(r.ok || !cacheOnly ? r : null)
    if (!r.ok && cacheOnly && auto) void run(false)
  }

  useEffect(() => {
    setResult(null)
    setStreaming(null)
    setLoading(false)
    active.current = ''
    if (req) void run(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey])

  useEffect(
    () =>
      window.api.onExplainChunk((c) => {
        if (c.requestId === active.current) setStreaming(parsePartialJson(c.text))
      }),
    []
  )

  if (!req) return null
  const data = streaming ?? (result?.ok ? result.data : null)
  return (
    <div className="space-y-2">
      {data ? (
        <ExplanationView data={data} onPly={onPly} />
      ) : loading ? (
        <Notice kind="info">Gemini đang viết...</Notice>
      ) : (
        <Button onClick={() => void run(false)}>✨ {label}</Button>
      )}
      {result && !result.ok && result.error && <Notice kind="error">{result.error}</Notice>}
      {result?.warnings?.map((w) => (
        <Notice key={w} kind="error">
          ⚠ {w}
        </Notice>
      ))}
      {result?.ok && result.cached && <div className="text-xs text-muted">(đã lưu sẵn)</div>}
    </div>
  )
}
