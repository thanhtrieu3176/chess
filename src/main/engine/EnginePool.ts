import type { AnalysisLimit, AnalysisResult, Priority } from '@shared/types'
import { normalizeFen } from '@shared/fen'
import { EngineError, EngineProcess, type EngineOptions } from './EngineProcess'

export interface PoolConfig {
  path: string
  poolSize: number
  poolThreads: number
  liveThreads: number
  hashMb: number
  syzygyPath?: string
}

export class CancelledError extends Error {
  constructor() {
    super('Đã hủy')
  }
}

const RANK: Record<Priority, number> = { interactive: 0, game: 1, background: 2 }
const MAX_RETRIES = 2

interface Job {
  seq: number
  fen: string
  key: string
  limit: AnalysisLimit
  multipv: number
  priority: Priority
  retries: number
  resolve: (r: AnalysisResult) => void
  reject: (e: Error) => void
}

type Logger = (msg: string) => void

/**
 * Nhóm engine:
 *  - N engine "batch" lấy việc từ một hàng đợi ưu tiên (quét cả ván, phân tích nền).
 *  - 1 engine "live" riêng cho phân tích vô hạn (nước đang xem, sandbox), để UI luôn
 *    có đánh giá ngay mà không phải chờ hàng đợi.
 * Engine nào crash/treo thì được khởi động lại và job đang chạy được đưa lại vào hàng đợi.
 */
export class EnginePool {
  name: string | null = null
  private batch: EngineProcess[] = []
  private idle: EngineProcess[] = []
  private live: EngineProcess | null = null
  private liveRun: Promise<AnalysisResult> | null = null
  private queue: Job[] = []
  private runningJobs = new Map<EngineProcess, Job>()
  private seq = 0
  private stopped = true

  constructor(private readonly log: Logger = () => {}) {}

  get size(): number {
    return this.batch.length
  }

  get queued(): number {
    return this.queue.length
  }

  async start(cfg: PoolConfig): Promise<void> {
    await this.shutdown()
    this.stopped = false
    const batchOpts: EngineOptions = { threads: cfg.poolThreads, hashMb: cfg.hashMb, syzygyPath: cfg.syzygyPath }
    const liveOpts: EngineOptions = { threads: cfg.liveThreads, hashMb: cfg.hashMb, syzygyPath: cfg.syzygyPath }

    const live = new EngineProcess(cfg.path, liveOpts, this.log)
    const batch = Array.from({ length: Math.max(1, cfg.poolSize) }, () => new EngineProcess(cfg.path, batchOpts, this.log))
    // Khởi động song song; lỗi ở bất kỳ engine nào → báo lỗi cấu hình.
    try {
      await Promise.all([live, ...batch].map((e) => e.start()))
    } catch (e) {
      for (const x of [live, ...batch]) x.kill()
      this.stopped = true
      throw e
    }
    // Chỉ bật tự khởi động lại sau khi engine đã chạy được ít nhất một lần.
    live.onCrash = (err) => void this.recover(live, err, false)
    for (const e of batch) e.onCrash = (err) => void this.recover(e, err, true)
    this.live = live
    this.batch = batch
    this.idle = [...batch]
    this.name = live.name
    this.dispatch()
  }

  /** Đưa một yêu cầu phân tích vào hàng đợi. */
  analyze(fen: string, limit: AnalysisLimit, multipv: number, priority: Priority): Promise<AnalysisResult> {
    if (this.stopped) return Promise.reject(new EngineError('Chưa cấu hình engine'))
    return new Promise((resolve, reject) => {
      this.enqueue({
        seq: this.seq++,
        fen,
        key: normalizeFen(fen),
        limit,
        multipv,
        priority,
        retries: 0,
        resolve,
        reject
      })
      this.dispatch()
    })
  }

  /** Đẩy các job của vị trí này lên đầu hàng đợi (khi người dùng bấm vào nước chưa phân tích). */
  promote(fen: string): void {
    const key = normalizeFen(fen)
    for (const j of this.queue) if (j.key === key) j.priority = 'interactive'
    this.sortQueue()
  }

  /** Hủy các job có độ ưu tiên cho trước (hoặc tất cả), kể cả job đang chạy. */
  cancel(priority?: Priority): void {
    const keep: Job[] = []
    for (const j of this.queue) {
      if (!priority || j.priority === priority) j.reject(new CancelledError())
      else keep.push(j)
    }
    this.queue = keep
    for (const [engine, job] of this.runningJobs) {
      if (!priority || job.priority === priority) {
        // Đánh dấu để kết quả trả về bị coi là hủy; engine sẽ rảnh lại khi có bestmove.
        job.reject(new CancelledError()) // promise đã settle, kết quả về sau bị bỏ qua
        engine.stop()
      }
    }
  }

  /** Gửi `ucinewgame` cho các engine đang rảnh (khi chuyển sang ván khác). */
  newGame(): void {
    for (const e of this.idle) e.newGame()
  }

  /**
   * Phân tích vô hạn trên engine live. Gọi lại với vị trí mới sẽ tự dừng vị trí cũ.
   * onUpdate được gọi theo mỗi dòng info (bên gọi tự throttle) và lần cuối với done=true.
   */
  async startLive(fen: string, multipv: number, onUpdate: (r: AnalysisResult, done: boolean) => void): Promise<void> {
    await this.stopLive()
    const live = this.live
    if (!live) throw new EngineError('Chưa cấu hình engine')
    const run = live.analyze(fen, { infinite: true }, multipv, (r) => onUpdate(r, false))
    this.liveRun = run
    run.then(
      (r) => onUpdate(r, true),
      (e: unknown) => this.log(`Live analysis lỗi: ${String(e)}`)
    )
  }

  async stopLive(): Promise<void> {
    const run = this.liveRun
    if (!run) return
    this.liveRun = null
    this.live?.stop()
    await run.catch(() => undefined)
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    this.cancel()
    const all = [...this.batch, ...(this.live ? [this.live] : [])]
    this.batch = []
    this.idle = []
    this.live = null
    this.liveRun = null
    await Promise.all(all.map((e) => e.quit()))
  }

  /** Dùng trong sự kiện thoát app: giết ngay, không chờ. */
  killAll(): void {
    this.stopped = true
    for (const e of [...this.batch, ...(this.live ? [this.live] : [])]) e.kill()
  }

  // ---------------------------------------------------------------------------

  /** Watchdog: khởi động lại engine hỏng, đưa job đang dở về hàng đợi. */
  private async recover(engine: EngineProcess, err: EngineError, isBatch: boolean): Promise<void> {
    if (this.stopped) return
    this.log(`Engine lỗi: ${err.message}. Đang khởi động lại...`)
    const job = this.runningJobs.get(engine)
    this.runningJobs.delete(engine)
    this.idle = this.idle.filter((e) => e !== engine)
    if (job) {
      if (job.retries < MAX_RETRIES) {
        job.retries++
        this.enqueue(job)
      } else {
        job.reject(err)
      }
    }
    if (!isBatch) this.liveRun = null

    for (let attempt = 0; attempt < 3 && !this.stopped; attempt++) {
      try {
        await engine.start()
        if (isBatch && this.batch.includes(engine)) this.idle.push(engine)
        this.dispatch()
        return
      } catch (e) {
        this.log(`Khởi động lại thất bại (lần ${attempt + 1}): ${String(e)}`)
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }

  private enqueue(job: Job): void {
    this.queue.push(job)
    this.sortQueue()
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq)
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const engine = this.idle.shift()!
      const job = this.queue.shift()!
      this.runningJobs.set(engine, job)
      engine.analyze(job.fen, job.limit, job.multipv).then(
        (r) => {
          this.runningJobs.delete(engine)
          this.idle.push(engine)
          job.resolve(r)
          this.dispatch()
        },
        (e: unknown) => {
          // Lỗi crash đã được recover() xử lý (job được chạy lại).
          if (!(e instanceof EngineError && e.crashed)) {
            this.runningJobs.delete(engine)
            this.idle.push(engine)
            job.reject(e instanceof Error ? e : new Error(String(e)))
            this.dispatch()
          }
        }
      )
    }
  }
}

/**
 * Cấu hình mặc định theo số nhân CPU: chừa 1 nhân cho hệ thống. Với thời gian ngắn mỗi vị trí
 * (quét nhanh), nhiều engine 1 thread chạy song song hiệu quả hơn 1 engine nhiều thread.
 */
export function defaultEngineConfig(cores: number): { poolSize: number; poolThreads: number; liveThreads: number } {
  const usable = Math.max(1, cores - 1)
  const poolSize = Math.min(4, usable)
  return { poolSize, poolThreads: Math.max(1, Math.floor(usable / poolSize)), liveThreads: usable }
}
