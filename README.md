# Chess Analyzer

Ứng dụng desktop cá nhân để phân tích ván cờ vua. Engine là **Stockfish 19**, phần giải thích bằng lời dùng **Google Gemini** (gói miễn phí).

## Tính năng

| Màn hình | Có gì |
|---|---|
| **Thư viện ván** | Dán PGN, mở file `.pgn` (nhiều ván), tự tải ván từ **Chess.com** / **Lichess** (lọc số ván, ngày, thể loại, màu quân; không tải trùng). Tìm và lọc theo đối thủ, kết quả, khai cuộc, ngày, thể loại. |
| **Phân tích** | Phân tích 2 lượt (quét nhanh song song + phân tích sâu các nước quan trọng), kết quả hiện dần. Win%, accuracy kiểu Lichess. Phân loại nước Book / Brilliant / Great / Best / Excellent / Good / Inaccuracy / Mistake / Miss / Blunder. Mũi tên nước tốt nhất, top 3 biến, "Xem biến", eval bar, biểu đồ lợi thế (bấm để nhảy tới nước). Motif chiến thuật, khai cuộc cập nhật theo từng nước, bảng "Nước tiếp theo", tablebase (≤ 7 quân), kiểm tra lệch repertoire, giải thích bằng Gemini. |
| **Sandbox** | Đi thử tự do với engine phân tích vô hạn (MultiPV). Cây nước có nhánh: xóa nhánh, nâng thành biến chính, chú thích. Nhập FEN/PGN, xuất PGN có biến phụ và chú thích. |
| **Thống kê** | Thắng/hòa/thua theo khai cuộc (riêng Trắng/Đen), accuracy và lỗi theo giai đoạn, blunder theo thời gian còn lại trên đồng hồ, motif hay bỏ lỡ / hay dính, xu hướng accuracy, rating Chess.com hiện tại và theo thời gian, nhận xét tổng quan bằng Gemini. |
| **Puzzle** | Tự tạo puzzle từ các nước Mistake/Blunder/Miss của bạn (chỉ khi lời giải rõ ràng), lặp lại ngắt quãng SM-2, gợi ý, xem lời giải, luyện theo chủ đề (motif), giải thích lời giải. |
| **Repertoire** | Cây khai cuộc riêng cho Trắng/Đen (đi trên bàn cờ hoặc nhập PGN), ghi chú từng nước, chế độ luyện tập. |

- Phím tắt: ←/→ đi qua lại · ↑/↓ về đầu/cuối · `F` lật bàn · `Space` bật/tắt engine.
- Có giao diện sáng/tối, 4 màu bàn cờ, 3 bộ quân, âm thanh đi quân (tắt được).

## Cài đặt (Windows)

1. Cài **Node.js 22 LTS trở lên** từ https://nodejs.org (bản LTS, Windows Installer).
2. Mở **PowerShell** trong thư mục dự án:
   ```powershell
   npm install
   npm run dev
   ```
   Không cần Visual Studio Build Tools, vì app không có module native (SQLite dùng `node:sqlite` có sẵn trong Electron).

## Cấu hình Stockfish

Vào **Cài đặt → Engine**:
- Bấm **"Tự tải Stockfish 19"**. App tải bản chính thức `stockfish-windows-x86-64-universal.zip` từ GitHub (~78MB), kiểm tra SHA-256 rồi giải nén vào thư mục dữ liệu. Bản 19 tự nhận diện CPU (AVX2, AVX-512...).
- Hoặc bấm **"Chọn file..."** để dùng file `stockfish.exe` bạn đã có.

Mặc định với máy C nhân:
- Quét cả ván: min(4, C−1) engine × 1 thread.
- Engine trực tiếp (nước đang xem, sandbox): C−1 thread.
- Phân tích nền: dùng tối đa 1 engine.

Tất cả đều chỉnh được trong Cài đặt.

## Gemini API key

1. Vào https://aistudio.google.com/apikey → **Create API key** (miễn phí).
2. Dán key vào **Cài đặt → Gemini**, bấm **Lưu key**, rồi **Kiểm tra kết nối**.

Key được mã hóa bằng `safeStorage` và không bao giờ được gửi xuống giao diện. Khi chạy dev, bạn cũng có thể chép `.env.example` thành `.env` và điền `GEMINI_API_KEY`.

Để tiết kiệm quota miễn phí:
- App chỉ tự giải thích các khoảnh khắc quan trọng (Brilliant, Great, Mistake, Miss, Blunder), gộp tối đa 6 khoảnh khắc vào một request. Các nước khác có nút "Giải thích".
- Lời giải thích được cache.
- Có giới hạn số request/phút (chỉnh trong Cài đặt).
- Khi hết quota ngày, app báo lỗi thân thiện; các tính năng khác vẫn chạy bình thường.

Gemini chỉ diễn giải dữ liệu do Stockfish tính. Mọi nước đi trong câu trả lời được kiểm tra lại; nếu có nước không nằm trong phân tích, app gọi lại 1 lần rồi gắn cảnh báo.

## Tài khoản

- Tên hiển thị mặc định: `thanhtrieu`.
- Tài khoản Chess.com mặc định: `thanhtrieu31760`.

Đổi được trong Cài đặt. App dùng username để biết bạn cầm quân nào: bàn cờ tự lật về phía bạn, còn thống kê, puzzle và repertoire chỉ tính nước của bạn. Khi mở app, ván mới được tự tải ở chế độ nền (tắt được).

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy app ở chế độ phát triển |
| `npm test` | Chạy unit test (test engine dùng Stockfish thật nếu có `STOCKFISH_PATH`) |
| `npm run typecheck` | Kiểm tra type |
| `npm run dist` | Build file cài đặt `.exe` vào `dist/` (chạy trên Windows) |

Chạy test với Stockfish thật trên Windows:
```powershell
$env:STOCKFISH_PATH="C:\đường\dẫn\stockfish.exe"; npm test
```

## Dữ liệu

Mọi dữ liệu nằm ở `%APPDATA%\chess-analyzer\`:
- `chess.db`: SQLite (ván, kết quả phân tích, cache, puzzle, repertoire).
- `logs\app.log`: log lỗi.
- `engine\`: Stockfish tự tải về.

## Giấy phép dữ liệu đi kèm

- Dữ liệu khai cuộc: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0).
- Bộ quân cờ: cburnett, merida (GPLv2+), alpha (miễn phí cho cá nhân, phi thương mại). Xem `src/renderer/src/assets/LICENSE-pieces.txt`.
- chessground, chessops và Stockfish dùng giấy phép GPL-3.0.

Kiến trúc chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
