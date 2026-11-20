import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DownloadProgress } from '@shared/types'

/**
 * Bản phát hành chính thức Stockfish 19 (GPL-3.0) trên GitHub.
 * Từ bản 19, Stockfish phát hành "universal binary": một file exe tự nhận diện tính năng CPU
 * (AVX2, AVX-512...), nên không cần chọn phiên bản theo CPU nữa.
 */
const RELEASE = {
  url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip',
  sha256: '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7'
}

/** Tải, kiểm tra SHA-256, giải nén vào `dir` và trả về đường dẫn file .exe. */
export async function downloadStockfish(dir: string, onProgress: (p: DownloadProgress) => void): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('Tự tải Stockfish chỉ hỗ trợ Windows. Hãy chọn file engine thủ công.')
  }
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const zip = join(dir, 'stockfish.zip')

  const res = await fetch(RELEASE.url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`Tải thất bại: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || undefined
  let received = 0
  let lastReport = 0
  const hash = createHash('sha256')
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    hash.update(chunk)
    if (Date.now() - lastReport > 200) {
      lastReport = Date.now()
      onProgress({ stage: 'download', received, total })
    }
  })
  await pipeline(body, createWriteStream(zip))

  onProgress({ stage: 'verify' })
  if (hash.digest('hex') !== RELEASE.sha256) throw new Error('File tải về không khớp SHA-256, đã hủy.')

  onProgress({ stage: 'extract' })
  const q = (s: string): string => s.replaceAll("'", "''") // escape cho chuỗi PowerShell
  // Expand-Archive có sẵn trên mọi Windows 10/11 → không cần thư viện giải nén.
  await promisify(execFile)('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(dir)}' -Force`
  ])
  await rm(zip, { force: true })

  const exe = await findExe(dir)
  if (!exe) throw new Error('Không tìm thấy stockfish*.exe trong file nén.')
  onProgress({ stage: 'done' })
  return exe
}

async function findExe(dir: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /^stockfish.*\.exe$/i.test(entry.name)) return join(entry.parentPath, entry.name)
  }
  return null
}
