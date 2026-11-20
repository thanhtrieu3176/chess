import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AnalysisLimit, AnalysisResult, EngineLine } from '@shared/types'
import { sideToMove } from '@shared/fen'
import { parseBestMove, parseInfo, toWhitePov } from './uci'

export interface EngineOptions {
  threads: number
  hashMb: number
  syzygyPath?: string
}

export class EngineError extends Error {
  constructor(
    message: string,
    /** true nếu process chết/treo (job có thể chạy lại trên engine mới). */
    readonly crashed = false
  ) {
    super(message)
  }
}

type Logger = (msg: string) => void
type InfoCallback = (partial: AnalysisResult) => void

interface Running {
  fen: string
  lines: Map<number, EngineLine>
  nodes?: number
  nps?: number
  onInfo?: InfoCallback
  resolve: (r: AnalysisResult) => void
  reject: (e: Error) => void
}

interface Waiter {
  match: (line: string) => boolean
  resolve: () => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/** Chu kỳ watchdog gửi `isready`; nếu quá thời gian này mà chưa có `readyok` → coi như treo. */
const WATCHDOG_MS = 5000

/**
 * Bọc một tiến trình Stockfish chạy liên tục ("warm engine").
 * Mỗi lúc chỉ chạy một lệnh `go`; muốn hủy thì gọi stop() và chờ promise trả về.
 */
export class EngineProcess {
  name: string | null = null
  /** Gọi khi engine chết hoặc treo ngoài ý muốn. */
  onCrash?: (err: EngineError) => void

  private proc: ChildProcessWithoutNullStreams | null = null
  private running: Running | null = null
  private waiters: Waiter[] = []
  private multiPv = 1
  private pingSentAt = 0
  private watchdog: NodeJS.Timeout | null = null
  private quitting = false

  constructor(
    private readonly path: string,
    private readonly opts: EngineOptions,
    private readonly log: Logger = () => {}
  ) {}

  get busy(): boolean {
    return this.running !== null
  }

  async start(): Promise<void> {
    this.quitting = false
    const proc = spawn(this.path, [], { stdio: 'pipe', windowsHide: true })
    this.proc = proc
    proc.on('error', (e) => this.fail(new EngineError(`Không chạy được engine: ${e.message}`, true)))
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null
      if (!this.quitting) this.fail(new EngineError(`Engine đã thoát (code ${code ?? signal})`, true))
    })
    proc.stdin.on('error', () => {}) // ghi vào pipe đã đóng: đã được xử lý qua 'exit'
    createInterface({ input: proc.stdout }).on('line', (l) => this.onLine(l))

    this.send('uci')
    await this.waitFor((l) => l === 'uciok', 10_000)
    this.send(`setoption name Threads value ${this.opts.threads}`)
    this.send(`setoption name Hash value ${this.opts.hashMb}`)
    if (this.opts.syzygyPath) this.send(`setoption name SyzygyPath value ${this.opts.syzygyPath}`)
    this.send('setoption name MultiPV value 1')
    this.multiPv = 1
    this.send('isready')
    // Cấp phát Hash lớn có thể mất vài giây.
    await this.waitFor((l) => l === 'readyok', 20_000)
    this.watchdog = setInterval(() => this.checkAlive(), WATCHDOG_MS)
  }

  /** Phân tích một vị trí. Điểm trả về theo góc nhìn bên Trắng. */
  analyze(fen: string, limit: AnalysisLimit, multipv: number, onInfo?: InfoCallback): Promise<AnalysisResult> {
    if (!this.proc) return Promise.reject(new EngineError('Engine chưa chạy', true))
    if (this.running) return Promise.reject(new EngineError('Engine đang bận'))

    return new Promise((resolve, reject) => {
      this.running = { fen, lines: new Map(), onInfo, resolve, reject }
      if (multipv !== this.multiPv) {
        this.send(`setoption name MultiPV value ${multipv}`)
        this.multiPv = multipv
      }
      this.send(`position fen ${fen}`)
      this.send(goCommand(limit))
    })
  }

  /** Dừng lệnh go hiện tại; promise của analyze() sẽ trả kết quả tốt nhất đã có. */
  stop(): void {
    if (this.running) this.send('stop')
  }

  /** Báo engine bắt đầu ván mới (xóa hash). Chỉ gọi khi rảnh. */
  newGame(): void {
    if (!this.running) this.send('ucinewgame')
  }

  async quit(): Promise<void> {
    this.quitting = true
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    const proc = this.proc
    if (!proc) return
    this.send('stop')
    this.send('quit')
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill()
        resolve()
      }, 1000)
      proc.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
    this.proc = null
  }

  /** Giết process ngay lập tức (dùng khi app thoát gấp). */
  kill(): void {
    this.quitting = true
    if (this.watchdog) clearInterval(this.watchdog)
    this.proc?.kill()
    this.proc = null
  }

  // ---------------------------------------------------------------------------

  private send(cmd: string): void {
    if (this.proc?.stdin.writable) this.proc.stdin.write(cmd + '\n')
  }

  private onLine(raw: string): void {
    const line = raw.trim()
    if (line.startsWith('id name ')) this.name = line.slice(8)
    if (line === 'readyok') this.pingSentAt = 0

    for (const w of [...this.waiters]) {
      if (w.match(line)) {
        clearTimeout(w.timer)
        this.waiters.splice(this.waiters.indexOf(w), 1)
        w.resolve()
      }
    }

    const run = this.running
    if (!run) return

    if (line.startsWith('info ')) {
      const info = parseInfo(line)
      if (!info) return
      run.nodes = info.nodes ?? run.nodes
      run.nps = info.nps ?? run.nps
      // Bỏ qua điểm lowerbound/upperbound: chưa chính xác.
      if (!info.score || info.bound || info.pv.length === 0) return
      run.lines.set(info.multipv, {
        multipv: info.multipv,
        depth: info.depth,
        score: toWhitePov(info.score, sideToMove(run.fen)),
        pv: info.pv
      })
      run.onInfo?.(this.snapshot(run, null))
      return
    }

    const best = parseBestMove(line)
    if (best) {
      this.running = null
      run.resolve(this.snapshot(run, best.bestMove))
    }
  }

  private snapshot(run: Running, bestMove: string | null): AnalysisResult {
    const lines = [...run.lines.values()].sort((a, b) => a.multipv - b.multipv)
    return {
      fen: run.fen,
      depth: lines[0]?.depth ?? 0,
      lines,
      bestMove: bestMove ?? lines[0]?.pv[0] ?? null,
      nodes: run.nodes,
      nps: run.nps
    }
  }

  private waitFor(match: (l: string) => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer)
        reject(new EngineError('Engine không phản hồi (hết thời gian chờ)', true))
      }, timeoutMs)
      this.waiters.push({ match, resolve, reject, timer })
    })
  }

  /** Watchdog: Stockfish trả `readyok` ngay cả khi đang tính, nên không có phản hồi = treo. */
  private checkAlive(): void {
    if (!this.proc) return
    if (this.pingSentAt && Date.now() - this.pingSentAt > WATCHDOG_MS) {
      this.log(`Engine ${this.path} không phản hồi isready, khởi động lại`)
      this.fail(new EngineError('Engine bị treo', true))
      return
    }
    if (!this.pingSentAt) {
      this.pingSentAt = Date.now()
      this.send('isready')
    }
  }

  private fail(err: EngineError): void {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    this.quitting = true // tránh báo lỗi 2 lần khi process thoát
    this.proc?.kill()
    this.proc = null
    this.pingSentAt = 0
    const run = this.running
    this.running = null
    run?.reject(err)
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(err)
    }
    this.waiters = []
    this.onCrash?.(err)
  }
}

function goCommand(limit: AnalysisLimit): string {
  if (limit.infinite) return 'go infinite'
  const parts = ['go']
  if (limit.depth) parts.push('depth', String(limit.depth))
  if (limit.movetime) parts.push('movetime', String(limit.movetime))
  if (limit.nodes) parts.push('nodes', String(limit.nodes))
  if (parts.length === 1) parts.push('depth', '18')
  return parts.join(' ')
}
