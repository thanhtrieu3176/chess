# Kiến trúc tổng thể — Chess Analyzer

## 1. Tech stack (đã tinh gọn cho app 1 người dùng)

| Thành phần | Chọn | Lý do |
|---|---|---|
| Desktop shell | Electron + electron-vite | Tauri nhẹ hơn nhưng phải viết lại backend bằng Rust. |
| UI | React 19 + TypeScript strict + Tailwind v4 | |
| State | zustand | ~1KB, không cần Redux. |
| Bàn cờ | chessground | Có sẵn mũi tên/vòng tròn/tô ô. |
| Luật cờ | **chessops** (thay chess.js) | Nhanh (bitboard), có tập ô bị tấn công cho SEE/motif, PGN có biến phụ. |
| Engine | Stockfish 19 (universal binary), app **tự tải** bản chính thức từ GitHub + kiểm tra SHA-256 | |
| DB | **`node:sqlite`** có sẵn trong Electron (thay better-sqlite3) | Không có module native → không phải biên dịch/rebuild trên Windows. |
| Biểu đồ | recharts | |
| Gemini | `@google/genai` | |
| Test | vitest | |
| Đóng gói | electron-builder (NSIS) | |

Bỏ so với yêu cầu ban đầu, vì app chỉ có một người dùng:
- **zod/validate IPC**: renderer là code của chính mình, chỉ cần type TS.
- **i18n**: chuỗi tiếng Việt viết thẳng trong component.
- **react-window**: thư viện ván phân trang là đủ.
- **Lichess Cloud Eval**: engine cục bộ đã đủ nhanh (~4s/ván), bớt một phụ thuộc mạng.
- **Script benchmark riêng**: thời gian được ghi log và hiển thị trong app.

Giấy phép: chessground, chessops và Stockfish đều là GPL-3.0. Dùng cá nhân thì không sao.

## 2. Sơ đồ tiến trình

```
┌──────────────────────── Renderer (React) ─────────────────────────┐
│ screens/*  components/*  store (zustand)                           │
│ chỉ hiển thị; gọi window.api.*  (typed, không có Node)             │
└──────────────▲───────────────────────────────┬─────────────────────┘
   events (throttle ≤10/s)                      │ invoke (typed)        
┌──────────────┴──────── preload (contextBridge) ┴────────────────────┐
└──────────────▲───────────────────────────────┬──────────────────────┘
┌──────────────┴──────────── Main process ─────▼──────────────────────┐
│ ipc ─► GameAnalyzer ─► EnginePool ─► N engine quét + 1 engine live   │
│                     │              (priority queue, watchdog)  │     │
│                     ├─► EvalCache (LRU + SQLite)              stdin/out
│                     ├─► Tablebase (net/)                      ▼     │
│                     └─► tactics/, classify, accuracy     stockfish.exe
│ GeminiService (rate limiter, cache, verify)                          │
│ Chess.com / Lichess importers · Settings (safeStorage) · Logger      │
│ SQLite (node:sqlite, WAL)                                            │
└──────────────────────────────────────────────────────────────────────┘
```

Logic cờ thuần (không phụ thuộc Node/DOM) nằm ở `src/shared/` → dùng chung ở main, renderer và unit test.

## 3. Cấu trúc thư mục

```
chess/
├─ package.json · electron.vite.config.ts · electron-builder.yml · tsconfig.json · vitest.config.ts
├─ docs/ARCHITECTURE.md · README.md · .env.example
├─ scripts/build-openings.mjs   TSV lichess-org/chess-openings → src/shared/openings/openings.json
└─ src/
   ├─ shared/                   ← thuần TS (không Node/DOM), dùng chung, có unit test
   │  ├─ api.ts                 hợp đồng IPC (Api + sự kiện), kiểm tra đủ method lúc compile
   │  ├─ types.ts · fen.ts · pgn.ts (đọc PGN, %clk, thể loại) · tree.ts (cây nước có nhánh, xuất PGN)
   │  ├─ sm2.ts · partialJson.ts
   │  ├─ chess/                 position.ts, material.ts, phase.ts, see.ts (SEE)
   │  ├─ analysis/              winPercent.ts, accuracy.ts, classify.ts (ngưỡng THRESHOLDS), game.ts
   │  ├─ tactics/               phát hiện motif (index.ts) + test FEN mẫu
   │  └─ openings/              openings.json + tra cứu EPD, bảng "Nước tiếp theo"
   ├─ main/
   │  ├─ index.ts               vòng đời app, việc nền khi mở app, tắt engine khi thoát
   │  ├─ ipc.ts                 handler cho mọi method trong Api
   │  ├─ db.ts                  node:sqlite, WAL, migration (PRAGMA user_version)
   │  ├─ settings.ts            cài đặt + Gemini key (safeStorage)
   │  ├─ EvalCache.ts · logger.ts
   │  ├─ engine/                uci.ts, EngineProcess.ts, EnginePool.ts, download.ts
   │  ├─ services/              games.ts, analyzer.ts, stats.ts, puzzles.ts, repertoire.ts
   │  ├─ net/                   http.ts (timeout+retry), sites.ts (Chess.com, Lichess), tablebase.ts
   │  └─ gemini/                service.ts, rateLimiter.ts, verify.ts, context.ts, prompts/
   ├─ preload/index.ts          expose window.api
   └─ renderer/src/
      ├─ App.tsx · store.ts · lib/sound.ts · assets/ (bộ quân, màu bàn cờ)
      ├─ components/            Board (chessground), EvalBar, MoveList, EngineLines, EvalChart,
      │                         Explanation, Motifs, ErrorBoundary, ui
      └─ screens/               Library, Workspace (Phân tích + Sandbox), Stats, Puzzles,
                                Repertoire, Settings
```

## 4. Engine (mục 2 + 8B)

- **EngineProcess**: 1 tiến trình Stockfish sống suốt phiên. Handshake `uci/uciok` → `setoption` → `isready/readyok`. Một job tại một thời điểm; `stop` để hủy. Parse `info depth seldepth multipv score cp|mate [lowerbound|upperbound] nodes nps pv`.
- **EnginePool**: N engine "quét" lấy việc từ một hàng đợi ưu tiên, cộng 1 engine "live" riêng để phân tích vô hạn nước đang xem/sandbox (UI luôn có đánh giá ngay, không phải xếp hàng). Mặc định (chế độ nhẹ máy): `N = min(2, C−1)` engine × 1 thread; engine live dùng C−1 thread; Hash 32MB/engine. Mỗi tiến trình Stockfish 19 tốn thêm ~70MB cho mạng NNUE, nên giữ ít tiến trình.
- **Giới hạn dung lượng**: `maxGames` (mặc định 5) — sau mỗi lần nhập/tải ván và khi mở app, `GamesRepo.prune()` xóa các ván ngoài N ván mới nhất (theo lượt nhập rồi ngày chơi). CASCADE xóa `moves` và `puzzles`; xóa thêm `explanations_cache` theo `game_id` (migration 3), `position_cache` không thuộc ván còn lại, `tablebase_cache` cũ hơn 30 ngày; rồi `VACUUM`.
- **Hàng đợi ưu tiên**: `interactive` > `game` > `background`; bấm vào nước chưa phân tích thì job của vị trí đó được nâng lên đầu.
- **Watchdog**: cứ 5 giây gửi `isready`; không có `readyok` trong 5 giây (treo) hoặc process `exit` bất thường → kill, khởi động lại, đưa job đang dở về hàng đợi (tối đa 2 lần). Kết quả đã có nằm trong cache nên không mất.
- **Phân tích nền**: ván mới tải về được quét nhanh với độ ưu tiên `background`, dùng tối đa `backgroundEngines` engine (giới hạn CPU). Phân tích nền không ghi đè kết quả phân tích sâu.
- **Phân tích ván (n+1 vị trí)**:
  - Lượt 1: `go movetime 250` (chỉnh được), MultiPV 2.
  - Lượt 2: `go depth 20` (chỉnh được), MultiPV 3 cho vị trí trước/sau các nước Mistake/Blunder/Miss/Brilliant/Great và các nước có |ΔWin%| ≥ 15.
  - Vị trí ≤ 7 quân: tra Lichess Tablebase (cache SQLite, mất mạng thì bỏ qua 60 giây).
  - Kết quả từng vị trí đẩy lên UI ngay (progressive).
  - Đo thực tế: 43 vị trí, 3 engine, 250ms/vị trí → 3,8s (máy 4 nhân).
- **EvalCache**: LRU 500 vị trí trong RAM + bảng `position_cache`. Khóa là FEN chuẩn hóa; mỗi vị trí giữ kết quả sâu nhất (cùng độ sâu thì nhiều MultiPV hơn). Yêu cầu nông hơn hoặc ít biến hơn thì dùng lại luôn.
- Tắt app: `quit` → đợi 500ms → `kill`; thêm hook `process.on('exit')` để không sót process.

## 5. Công thức & quy tắc

- **Win%** = `50 + 50·(2/(1+exp(-0.00368208·cp)) − 1)`; cp kẹp trong ±1000; mate N quy đổi thành ±1000 (≈ 97,5%); vị trí đã bị chiếu hết = 100/0.
- **Accuracy mỗi nước** = `103.1668·exp(−0.04354·(winBefore − winAfter)) − 3.1669 + 1`, kẹp [0,100], Win% theo góc nhìn người đi. "+1" là "uncertainty bonus" giống code Lichess: tránh một nước accuracy 0 làm trung bình điều hòa của cả ván sụp về 0.
- **Accuracy cả ván** (cách Lichess): tạo dãy Win% theo từng ply; cửa sổ trượt kích thước `clamp(nMoves/10, 2, 8)`; trọng số mỗi nước = độ lệch chuẩn Win% trong cửa sổ, kẹp [0.5, 12] (thế cờ biến động → nước đó quan trọng hơn). Accuracy bên = trung bình (trung bình có trọng số, trung bình điều hòa) của accuracy các nước bên đó. Trung bình điều hòa phạt nặng vài nước rất tệ.
- **Phân loại** (ΔW = Win% mất so với nước tốt nhất, hằng số `THRESHOLDS` trong `shared/analysis/classify.ts`):
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
  | Great | là Best, nước tốt thứ 2 kém hơn ≥ 15 Win%, không phải ăn lại quân trên cùng ô, không phải nước bắt buộc duy nhất |
  | Brilliant | ΔW < 2, thí ≥ 2 điểm vật chất (SEE của nước đi ≤ −2, hoặc để một quân khác bị treo ≥ 2 điểm), Win% trước < 90, Win% sau ≥ 45 |

  Tablebase (≤7 quân) ghi đè engine: thắng→thua/hòa→thua = Blunder, thắng→hòa = Mistake, giữ nguyên kết quả = Best/Excellent.
- **Giai đoạn ván** (đơn giản hóa từ Lichess Divider): đếm quân nhẹ+nặng (M) của cả 2 bên. Trung cuộc bắt đầu khi `M ≤ 10` hoặc hàng cuối của một bên còn < 4 quân của chính bên đó; tàn cuộc khi `M ≤ 6`.
- **SEE**: thuật toán swap-list chuẩn dùng attacks của chessops (có xét quân bị "lộ" phía sau — x-ray; vua không ăn vào ô còn bị tấn công).
- **Motif chiến thuật** (`shared/tactics`, phát hiện trên vị trí và dọc biến PV của engine):
  - quân treo (SEE > 0)
  - nĩa: quân vừa đi tấn công ≥ 2 mục tiêu đắt hơn nó hoặc không được bảo vệ, và bản thân không bị ăn có lãi
  - ghim tuyệt đối/tương đối và xiên: duyệt tia quân trượt
  - tấn công mở / chiếu mở / chiếu kép: tia mới mở qua ô vừa rời
  - đe dọa chiếu hết: "nước đi rỗng" rồi tìm mate-in-1
  - yếu hàng cuối: vua ở hàng cuối không có ô thoát ngoài hàng cuối, đối phương có xe/hậu với tới hàng cuối
  - quân phòng thủ quá tải: là quân bảo vệ duy nhất của ≥ 2 quân bị tấn công
  - thí quân
- **Puzzle**: từ nước Mistake/Blunder/Miss của tôi, khi nước tốt nhất hơn nước thứ 2 ≥ 10 Win%. Lời giải đi tiếp khi nước kế tiếp của mình là ép buộc (chiếu/ăn), tối đa 3 nước của mình. SM-2: đúng ngay = 5, cần gợi ý = 4, có sai = 2, xem lời giải = 0; sai thì quay lại sau 10 phút.

## 5b. Gemini

- **Thứ tự xử lý**: cache SQLite (khóa: loại + dữ liệu vị trí + model + phiên bản prompt) → hàng đợi tuần tự giới hạn request/phút → `generateContentStream` với `responseJsonSchema` (structured output), timeout 60 giây → hậu kiểm.
- **Lỗi 429**: retry với exponential backoff (2, 4, 8 giây). Hết quota ngày thì báo thân thiện.
- **Dữ liệu gửi đi**:
  - FEN, nước đã đi, nước tốt nhất, top 3 biến (SAN), điểm trước/sau, Win% mất, phân loại
  - motif (nước đi tạo ra / cơ hội bị bỏ lỡ / đe dọa sau nước đi / đặc điểm vị trí)
  - vật chất, khai cuộc, giai đoạn, tablebase
- **Hậu kiểm**: trích mọi nước quân/nước ăn/phong cấp/nhập thành trong câu trả lời và so với tập nước đã cung cấp. Nước tốt đơn thuần như "e4" trùng với tên ô nên không kiểm. Nếu có nước lạ → gọi lại 1 lần kèm nhắc nhở; vẫn còn thì gắn cảnh báo.
- **Tiết kiệm quota**: chỉ tự giải thích khoảnh khắc quan trọng, tải trước ở chế độ nền sau khi phân tích, gộp tối đa 6 khoảnh khắc/request.

## 6. Database schema (SQLite, WAL)

Migration: mảng `MIGRATIONS` trong `main/db.ts`, chạy tuần tự trong transaction, phiên bản lưu bằng `PRAGMA user_version`. Migration 2 thêm `repertoire_nodes.parent_fen` (tra repertoire theo vị trí trước nước đi để khớp transposition).

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
  fen        TEXT PRIMARY KEY,       -- FEN bỏ halfmove/fullmove
  multipv    INTEGER NOT NULL,       -- số biến đã yêu cầu
  depth      INTEGER NOT NULL,
  lines      TEXT NOT NULL,          -- JSON [{multipv, depth, score{cp|mate} (góc nhìn Trắng), pv: uci[]}]
  best_move  TEXT,
  updated_at INTEGER NOT NULL
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

## 7. IPC

`src/shared/api.ts` định nghĩa interface `Api`. Mỗi method là một kênh `ipcRenderer.invoke`. Preload sinh `window.api` từ danh sách method; main đăng ký handler với cùng type, nên sai tên hoặc sai tham số sẽ báo lỗi ngay lúc compile. Sự kiện main → renderer (`onLiveUpdate`, được throttle ≤ 10 lần/giây) đi qua `webContents.send`.

## 8. Trạng thái

Đã có đủ 13 giai đoạn của yêu cầu ban đầu:
1. Nền tảng
2. Bàn cờ và nhập ván
3. Phân tích cốt lõi
4. Khai cuộc
5. Motif chiến thuật
6. Gemini
7. Tự lấy ván
8. Sandbox
9. Tablebase
10. Thống kê
11. Puzzle
12. Repertoire
13. Hoàn thiện (theme, bộ quân, phím tắt, âm thanh, đóng gói)

Test: `npm test`. Gồm unit test cho logic cờ và test tích hợp với Stockfish thật nếu tìm thấy engine.
