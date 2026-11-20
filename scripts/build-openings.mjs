// Chuyển dữ liệu lichess-org/chess-openings (TSV a–e, CC0) thành src/shared/openings/openings.json.
// Cách dùng: node scripts/build-openings.mjs <thư mục chứa a.tsv ... e.tsv>
// JSON: { o: [[eco, tên, pgn, epd], ...], b: [epd, ...] }
//   o: các khai cuộc có tên. EPD = 4 trường đầu của FEN (khóa tra cứu).
//   b: các vị trí trung gian trên đường tới một khai cuộc có tên (vẫn là "lý thuyết").
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Chess } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { parseSan } from 'chessops/san'

const dir = process.argv[2]
if (!dir) throw new Error('Thiếu thư mục chứa file TSV')
const out = []
const prefixes = new Set()
const epdOf = (pos) => makeFen(pos.toSetup()).split(' ').slice(0, 4).join(' ')
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const lines = readFileSync(join(dir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1)
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t')
    const pos = Chess.default()
    for (const tok of pgn.split(/\s+/)) {
      if (/^\d+\./.test(tok)) continue
      const move = parseSan(pos, tok)
      if (!move) throw new Error(`Nước không hợp lệ ${tok} trong ${name}`)
      pos.play(move)
      prefixes.add(epdOf(pos))
    }
    const epd = epdOf(pos)
    out.push([eco, name, pgn, epd])
  }
}
const named = new Set(out.map((r) => r[3]))
const b = [...prefixes].filter((e) => !named.has(e))
writeFileSync(new URL('../src/shared/openings/openings.json', import.meta.url), JSON.stringify({ o: out, b }))
console.log(`Đã ghi ${out.length} khai cuộc`)
