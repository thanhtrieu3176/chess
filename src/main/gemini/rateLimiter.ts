/**
 * Hàng đợi tuần tự có giới hạn tốc độ (cửa sổ trượt 60 giây) cho gói Gemini miễn phí.
 * Mỗi lúc chỉ chạy 1 request; request mới phải chờ nếu đã dùng hết `rpm` lượt trong 60s qua.
 */
export class RateLimiter {
  private stamps: number[] = []
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private rpm: () => number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.chain.then(async () => {
      await this.waitSlot()
      this.stamps.push(Date.now())
      return fn()
    })
    this.chain = job.catch(() => undefined)
    return job
  }

  private async waitSlot(): Promise<void> {
    for (;;) {
      const now = Date.now()
      this.stamps = this.stamps.filter((t) => now - t < 60_000)
      if (this.stamps.length < Math.max(1, this.rpm())) return
      await new Promise((r) => setTimeout(r, 60_000 - (now - this.stamps[0]!) + 50))
    }
  }
}
