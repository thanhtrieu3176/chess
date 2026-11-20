# Kiến trúc tổng thể — Chess Analyzer (bản đề xuất để duyệt)

## 1. Tech stack (và những chỗ tôi đề xuất đổi so với yêu cầu)

| Thành phần | Chọn | Ghi chú |
|---|---|---|
| Desktop shell | **Electron + electron-vite** | Giữ nguyên. Tauri nhẹ hơn (~10MB) nhưng phải viết lại toàn bộ backend bằng Rust (UCI, SQLite, Gemini…), không đáng với app cá nhân. |
| UI | React 19 + TypeScript strict + Tailwind v4 | Giữ nguyên. |
| State | **zustand** | Nhỏ (~1KB), đủ dùng; không cần Redux. |
| Bàn cờ | **chessground** (tự viết wrapper React mỏng ~80 dòng) | Giữ nguyên. Hỗ trợ mũi tên/vòng tròn/tô ô sẵn. |
| Luật cờ | **chessops** thay cho chess.js | **Đổi.** Cùng tác giả với Lichess, dùng bitboard nên nhanh hơn nhiều; có sẵn tập ô bị tấn công (cần cho SEE và phát hiện motif), parse/xuất **PGN có biến phụ + chú thích** (cần cho Sandbox, Repertoire), chuẩn hóa FEN/EPD. chess.js không có cây biến và không có API tấn công dạng bitboard. |
| Engine | Stockfish 19 qua UCI, child_process ở main | Giữ nguyên. |
| DB | better-sqlite3 (WAL) | Giữ nguyên — nhanh nhất cho Node, đồng bộ, đơn giản. |
| Biểu đồ | recharts | Giữ nguyên. |
| Validate IPC | zod v4 | Giữ nguyên. |
| Gemini | `@google/genai`, gọi từ main | Giữ nguyên. Model để ô nhập/dropdown, mặc định một model Flash hiện hành. |
| Test | vitest | |
| Đóng gói | electron-builder → NSIS `.exe` | |

Lưu ý giấy phép: chessground và chessops là GPL-3.0. Dùng cá nhân thì không sao; nếu sau này phát hành công khai thì mã nguồn app cũng phải GPL-3.0.

### Những chỗ tôi đề xuất điều chỉnh yêu cầu
1. **Quét nhanh dùng MultiPV = 2, không phải 1.** Phân loại *Great* ("nước duy nhất") và điều kiện tạo puzzle ("nước tốt nhất vượt trội nước thứ 2") đều cần biết nước tốt thứ 2. Với MultiPV 1 thì không thể phát hiện Great nếu nước đó không lọt vào lượt 2. MultiPV 2 tốn thêm ~30–40% thời gian — vẫn nằm trong mục tiêu < 30s/ván. MultiPV 3 chỉ dùng cho nước đang xem và lượt 2.
2. **Dữ liệu khai cuộc không cần bảng SQLite.** File TSV a–e (~3.500 dòng) được chuyển thành `openings.json` lúc build và nạp thẳng vào `Map<EPD, Opening>` khi khởi động (~20ms). Bảng SQLite chỉ là bản sao thừa.
3. **Motif chiến thuật chạy ở main process**, không phải Web Worker ở renderer. Mỗi vị trí chỉ mất < 1ms, và main cần kết quả này để lưu DB, gắn nhãn puzzle, đưa vào prompt Gemini. Renderer vẫn không bao giờ phải tính nặng (đúng tinh thần 8B). Nếu đo thấy chậm thì chuyển sang `utilityProcess`.
4. **Chỉ virtualize Thư viện ván.** Danh sách nước tối đa vài trăm dòng, render thường đã < 5ms; virtualize thêm chỉ làm phức tạp việc cuộn tới nước đang chọn.

## 2. Sơ đồ tiến trình

```
┌──────────────────────── Renderer (React) ─────────────────────────┐
│ screens/*  components/*  store (zustand)                           │
│ chỉ hiển thị; gọi window.api.*  (typed, không có Node)             │
└──────────────▲───────────────────────────────┬─────────────────────┘
   events (throttle ≤10/s)                      │ invoke (zod-validated)
┌──────────────┴──────── preload (contextBridge) ┴────────────────────┐
└──────────────▲───────────────────────────────┬──────────────────────┘
┌──────────────┴──────────── Main process ─────▼──────────────────────┐
│ ipc/handlers ─► GameAnalyzer ─► EnginePool ─► EngineProcess × N      │
│                     │              (priority queue, watchdog)  │     │
│                     ├─► EvalCache (LRU + SQLite)              stdin/out
│                     ├─► CloudEval / Tablebase (net/)          ▼     │
│                     └─► tactics/, classify, accuracy     stockfish.exe
│ GeminiService (rate limiter, cache, verify)                          │
│ Chess.com / Lichess importers · Settings (safeStorage) · Logger      │
│ SQLite (better-sqlite3, WAL)                                         │
└──────────────────────────────────────────────────────────────────────┘
```

Logic cờ thuần (không phụ thuộc Node/DOM) nằm ở `src/shared/` → dùng chung ở main, renderer và unit test.

## 3. Cấu trúc thư mục

```
chess/
├─ package.json · electron.vite.config.ts · electron-builder.yml
├─ tsconfig.json (+ tsconfig.node.json, tsconfig.web.json) · vitest.config.ts
├─ .env.example · .gitignore · README.md
├─ resources/                  icon, sounds/, openings.json (sinh từ TSV)
├─ scripts/
│  ├─ build-openings.ts         TSV a–e → resources/openings.json
│  └─ bench.ts                  benchmark các chỉ tiêu ở mục 8B
└─ src/
   ├─ shared/                   ← thuần TS, có unit test
   │  ├─ ipc.ts                 tên kênh + zod schema + kiểu request/response
   │  ├─ types.ts               Game, MoveAnalysis, EngineLine, Classification…
   │  ├─ chess/                 fen.ts (chuẩn hóa), material.ts, phase.ts, see.ts
   │  ├─ analysis/              winPercent.ts, accuracy.ts, classify.ts, thresholds.ts
   │  ├─ tactics/               hanging, fork, pin, skewer, discovered, mateThreat,
   │  │                         backRank, overloaded, sacrifice, index.ts
   │  ├─ openings/              lookup.ts (Map EPD → opening, "nước tiếp theo")
   │  ├─ pgn/                   tree.ts (cây nước có nhánh), clock.ts (%clk)
   │  └─ sm2.ts
   ├─ main/
   │  ├─ index.ts               vòng đời app, cửa sổ, tắt engine khi thoát
   │  ├─ logger.ts              log ra userData/logs
   │  ├─ settings.ts            settings + API key mã hóa (safeStorage)
   │  ├─ db/                    index.ts, migrations/001_init.sql…, repos/*.ts
   │  ├─ engine/                uci.ts (parse info), EngineProcess.ts,
   │  │                         EnginePool.ts, PriorityQueue.ts
   │  ├─ analysis/              GameAnalyzer.ts (2 lượt, progressive), EvalCache.ts
   │  ├─ net/                   http.ts (timeout+retry), chesscom.ts, lichess.ts,
   │  │                         cloudEval.ts, tablebase.ts
   │  ├─ gemini/                GeminiService.ts, rateLimiter.ts, verify.ts,
   │  │                         prompts/{move,game,opening,overview,puzzle}.v1.ts
   │  ├─ stats/                 dashboard queries
   │  └─ ipc/                   handlers theo domain
   ├─ preload/index.ts          expose window.api (typed)
   └─ renderer/
      ├─ index.html · main.tsx · App.tsx (sidebar + lazy screens)
      ├─ i18n/                  vi.ts, en.ts, t()
      ├─ store/                 zustand slices
      ├─ components/            Board, EvalBar, MoveList, EngineLines, EvalChart,
      │                         ExplanationPanel, OpeningPanel, ErrorBoundary…
      └─ screens/               Library, Analysis, Sandbox, Stats, Puzzles,
                                Repertoire, Settings
```

## 4. Engine (mục 2 + 8B)

- **EngineProcess**: 1 tiến trình Stockfish sống suốt phiên. Handshake `uci/uciok` → `setoption` → `isready/readyok`. Một job tại một thời điểm; `stop` để hủy. Parse `info depth seldepth multipv score cp|mate [lowerbound|upperbound] nodes nps pv`.
- **EnginePool**: N instance. Mặc định với C nhân: `N = clamp(floor((C-1)/2), 1, 4)`, `threads/instance = max(1, floor((C-1)/N))`, `Hash = 256MB / N`. Chỉnh được trong Cài đặt.
- **PriorityQueue**: 3 mức — `interactive` (nước đang xem / sandbox, chiếm 1 instance ngay, có thể preempt job nền), `game` (ván đang mở), `background` (quét nền ván mới). Bấm vào nước chưa có kết quả → job của vị trí đó được nâng lên đầu.
- **Watchdog**: mỗi job có deadline (movetime + 5s); hết hạn hoặc process `exit` bất thường → kill, khởi động lại, đưa job về hàng đợi. Kết quả đã có nằm trong cache nên không mất.
- **Phân tích ván (n+1 vị trí)**:
  - Lượt 1: `go movetime 250` (chỉnh được), MultiPV 2. Vị trí khai cuộc (ply ≤ 20) thử Lichess Cloud Eval trước (1 request/lúc, cache, 429 → tạm dừng 60s).
  - Lượt 2: `go depth 22`, MultiPV 3 cho các nước Mistake/Blunder/Miss/Brilliant/Great và các vị trí có |ΔWin%| ≥ 15.
  - Kết quả từng vị trí đẩy lên UI ngay (progressive).
  - Ước tính: 41 vị trí ÷ 2 instance × 0.25s ≈ 5s cho lượt 1 trên máy 4 nhân.
- **EvalCache**: LRU 5.000 vị trí trong RAM + bảng `position_cache`. Khóa `(fen chuẩn hóa, multipv)`, chỉ giữ kết quả **sâu nhất**; yêu cầu depth ≤ depth đã lưu thì trả luôn.
- Tắt app: `quit` → đợi 500ms → `kill`; thêm hook `process.on('exit')` để không sót process.

## 5. Công thức & quy tắc

- **Win%** = `50 + 50·(2/(1+exp(-0.00368208·cp)) − 1)`; cp kẹp trong ±1000; mate quy đổi thành ±1000 (Win% ≈ 97.5/2.5 → coi như 100/0 khi mate).
- **Accuracy mỗi nước** = `103.1668·exp(−0.04354·(winBefore − winAfter)) − 3.1669`, kẹp [0,100], Win% tính theo góc nhìn người đi.
- **Accuracy cả ván** (cách Lichess): tạo dãy Win% theo từng ply; cửa sổ trượt kích thước `clamp(nMoves/10, 2, 8)`; trọng số mỗi nước = độ lệch chuẩn Win% trong cửa sổ, kẹp [0.5, 12] (thế cờ biến động → nước đó quan trọng hơn). Accuracy bên = trung bình (trung bình có trọng số, trung bình điều hòa) của accuracy các nước bên đó. Trung bình điều hòa phạt nặng vài nước rất tệ.
- **Phân loại** (ΔW = Win% mất so với nước tốt nhất, hằng số trong `thresholds.ts`):
  | Loại | Điều kiện |
  |---|---|
  | Book | vị trí sau nước đi nằm trong dữ liệu khai cuộc |
  | Best | trùng nước tốt nhất |
  | Excellent | ΔW < 2 |
  | Good | ΔW < 5 |
  | Inaccuracy | 5 ≤ ΔW < 10 (Lichess: 0.1 trên thang [−1,1]) |
  | Mistake | 10 ≤ ΔW < 15 |
  | Blunder | ΔW ≥ 15 |
  | Miss | nước trước của đối thủ là Mistake/Blunder, nước tốt nhất cho Win% ≥ 70, người đi mất ΔW ≥ 10 và Win% sau < 70 (bỏ lỡ cơ hội) |
  | Great | là Best, nước tốt thứ 2 kém hơn ≥ 15 Win%, và không phải nước "hiển nhiên" (không phải ăn lại quân duy nhất) |
  | Brilliant | ΔW < 2, SEE của nước đi < 0 hoặc quân còn treo sau nước đi (thí quân), Win% trước < 90, Win% sau ≥ 50 |
  Tablebase (≤7 quân) ghi đè đánh giá engine khi tính ΔW.
- **Giai đoạn ván** (đơn giản hóa từ Lichess Divider): đếm quân nhẹ+nặng (M) của cả 2 bên. Trung cuộc bắt đầu khi `M ≤ 10` hoặc hàng cuối của một bên còn < 4 quân của chính bên đó; tàn cuộc khi `M ≤ 6`.
- **SEE**: thuật toán swap-list chuẩn dùng attacks của chessops (có xét quân bị "lộ" phía sau — x-ray).

## 6. Database schema (SQLite, WAL)

Migration: thư mục `db/migrations/NNN_*.sql`, chạy tuần tự trong transaction, phiên bản lưu bằng `PRAGMA user_version`.

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                -- JSON; API key lưu ở dạng blob safeStorage (base64)
);

CREATE TABLE games (
  id              INTEGER PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('pgn','chesscom','lichess')),
  source_id       TEXT,              -- URL ván chess.com / id lichess / hash PGN
  white           TEXT NOT NULL,
  black           TEXT NOT NULL,
  white_elo       INTEGER,
  black_elo       INTEGER,
  result          TEXT NOT NULL,     -- '1-0' | '0-1' | '1/2-1/2' | '*'
  termination     TEXT,
  played_at       INTEGER,           -- unix ms
  time_control    TEXT,
  speed           TEXT,              -- bullet|blitz|rapid|classical|daily
  eco             TEXT,
  opening_name    TEXT,
  user_color      TEXT CHECK (user_color IN ('w','b')),   -- NULL nếu không phải ván của tôi
  user_result     TEXT CHECK (user_result IN ('win','draw','loss')),
  pgn             TEXT NOT NULL,
  analysis_status TEXT NOT NULL DEFAULT 'none',          -- none|quick|deep
  white_accuracy  REAL,
  black_accuracy  REAL,
  created_at      INTEGER NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX idx_games_played_at ON games(played_at DESC);
CREATE INDEX idx_games_user      ON games(user_color, user_result);
CREATE INDEX idx_games_opening   ON games(eco, opening_name);
CREATE INDEX idx_games_white     ON games(white COLLATE NOCASE);
CREATE INDEX idx_games_black     ON games(black COLLATE NOCASE);

CREATE TABLE moves (                 -- kết quả phân tích từng nước của ván gốc
  game_id        INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply            INTEGER NOT NULL,   -- 1 = nước đầu của trắng
  san            TEXT NOT NULL,
  uci            TEXT NOT NULL,
  fen_before     TEXT NOT NULL,      -- FEN chuẩn hóa
  color          TEXT NOT NULL,      -- 'w'|'b'
  win_before     REAL,               -- góc nhìn bên đi
  win_after      REAL,
  accuracy       REAL,
  classification TEXT,
  best_uci       TEXT,
  best_san       TEXT,
  phase          TEXT,               -- opening|middlegame|endgame
  clock_ms       INTEGER,            -- từ %clk
  tactics        TEXT,               -- JSON motif
  depth          INTEGER,
  PRIMARY KEY (game_id, ply)
) WITHOUT ROWID;
CREATE INDEX idx_moves_class ON moves(classification);

CREATE TABLE position_cache (
  fen        TEXT NOT NULL,          -- FEN bỏ halfmove/fullmove
  multipv    INTEGER NOT NULL,
  depth      INTEGER NOT NULL,
  lines      TEXT NOT NULL,          -- JSON [{cp|mate, pv: uci[]}]
  source     TEXT NOT NULL,          -- local|cloud
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (fen, multipv)
) WITHOUT ROWID;

CREATE TABLE explanations_cache (
  key            TEXT PRIMARY KEY,   -- sha1(kind|fen|move|model|promptVersion)
  kind           TEXT NOT NULL,      -- move|game|opening|overview|puzzle
  model          TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  response       TEXT NOT NULL,      -- JSON đã hậu kiểm
  warnings       TEXT,               -- JSON: nước SAN không hợp lệ (nếu có)
  created_at     INTEGER NOT NULL
);

CREATE TABLE tablebase_cache (
  fen        TEXT PRIMARY KEY,
  response   TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE puzzles (
  id            INTEGER PRIMARY KEY,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply           INTEGER NOT NULL,
  fen           TEXT NOT NULL,
  solution      TEXT NOT NULL,       -- JSON uci[] (nước của tôi và đáp trả)
  motifs        TEXT NOT NULL,       -- JSON string[]
  source_class  TEXT NOT NULL,       -- mistake|blunder|miss
  -- SM-2
  ease          REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions   INTEGER NOT NULL DEFAULT 0,
  due_at        INTEGER NOT NULL,
  last_result   TEXT,
  UNIQUE (game_id, ply)
);
CREATE INDEX idx_puzzles_due ON puzzles(due_at);

CREATE TABLE repertoire_nodes (
  id        INTEGER PRIMARY KEY,
  color     TEXT NOT NULL CHECK (color IN ('w','b')),
  parent_id INTEGER REFERENCES repertoire_nodes(id) ON DELETE CASCADE,  -- NULL = gốc
  fen       TEXT NOT NULL,           -- FEN chuẩn hóa SAU nước đi
  uci       TEXT,
  san       TEXT,
  comment   TEXT,
  UNIQUE (color, parent_id, uci)
);
CREATE INDEX idx_rep_fen ON repertoire_nodes(color, fen);
```

Ghi chú: tra lệch repertoire dùng `(color, fen)` nên các thứ tự nước khác nhau (transposition) vẫn khớp.

## 7. IPC (ví dụ)

```ts
// shared/ipc.ts
export const ipc = {
  'engine:analyze':  { req: z.object({ fen: z.string(), multipv: z.number().int().min(1).max(5), infinite: z.boolean() }), res: z.void() },
  'game:analyze':    { req: z.object({ gameId: z.number().int() }), res: z.void() },
  'games:list':      { req: GameFilter, res: z.array(GameRow) },
  ...
} as const;
// events main → renderer: 'engine:info' (throttle 100ms), 'analysis:progress', 'analysis:move', 'gemini:chunk'
```

## 8. Lộ trình

Theo đúng 13 giai đoạn trong yêu cầu; dừng sau mỗi giai đoạn để bạn chạy thử.
