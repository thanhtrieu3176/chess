import { useState } from 'react'
import { Button, Input, Notice } from './ui'

/** Hộp thoại lần đầu mở app khi chưa có Gemini API key. */
export function GeminiKeyDialog({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    try {
      await window.api.setGeminiKey(key)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const skip = () => {
    try {
      localStorage.setItem('skipGeminiKeyDialog', '1')
    } catch {
      // không lưu được thì lần sau hỏi lại, không sao
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[520px] space-y-4 rounded-lg border border-line bg-panel p-6">
        <h2 className="text-lg font-semibold">Nhập Gemini API key</h2>
        <p className="text-muted">
          Gemini dùng để giải thích nước đi bằng lời. Key miễn phí, lấy tại{' '}
          <a className="text-accent underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>{' '}
          → "Create API key". Key được mã hóa và chỉ lưu trên máy này.
        </p>
        <p className="text-muted">Không có key thì các tính năng khác (engine, thống kê, puzzle...) vẫn dùng bình thường.</p>
        <Input type="password" placeholder="AIza..." value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={skip}>Để sau</Button>
          <Button variant="primary" disabled={!key.trim()} onClick={() => void save()}>
            Lưu
          </Button>
        </div>
      </div>
    </div>
  )
}
