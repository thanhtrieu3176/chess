/** fetch có timeout + retry giới hạn (429/5xx/lỗi mạng), dùng cho mọi request ra ngoài. */

export const USER_AGENT = 'ChessAnalyzer/0.2 (personal desktop app; Electron)'

export class NetError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

export interface FetchOpts extends RequestInit {
  timeoutMs?: number
  retries?: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function fetchRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 15_000, retries = 2, ...init } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
        continue
      }
      return res
    } catch (e) {
      lastError = e
      if (attempt < retries) await sleep(1000 * 2 ** attempt)
    }
  }
  throw new NetError(`Không kết nối được (${new URL(url).host}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetchRetry(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers as Record<string, string>) } })
  if (!res.ok) throw new NetError(`HTTP ${res.status} từ ${new URL(url).host}`, res.status)
  return (await res.json()) as T
}
