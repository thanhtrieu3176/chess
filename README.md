# Chess Analyzer

Ứng dụng desktop cá nhân để phân tích ván cờ vua. Engine là **Stockfish 19**, phần giải thích bằng lời dùng **Google Gemini**.

> Trạng thái: **giai đoạn 1 (nền tảng)**. Đã có: cài đặt, engine pool, phân tích trực tiếp, cache, watchdog. Bàn cờ và phân tích ván sẽ có từ giai đoạn 2–3.

## Cài đặt (Windows)

1. Cài **Node.js 22 LTS trở lên**: https://nodejs.org (bản "LTS", Windows Installer).
2. Mở **PowerShell** trong thư mục dự án:
   ```powershell
   npm install
   npm run dev
   ```
   Không cần Visual Studio Build Tools: app dùng SQLite có sẵn trong Electron, không có module native.

## Cấu hình Stockfish

Vào **Cài đặt → Engine**:
- Bấm **"Tự tải Stockfish 19"**. App tải bản chính thức `stockfish-windows-x86-64-universal.zip` từ GitHub (~78MB), kiểm tra SHA-256 rồi giải nén vào thư mục dữ liệu của app. Từ bản 19, Stockfish tự nhận diện CPU (AVX2, AVX-512...), nên không cần chọn phiên bản theo máy.
- Hoặc bấm **"Chọn file..."** để dùng file `stockfish.exe` bạn đã tải.

Mặc định với máy có C nhân:
- Quét cả ván: min(4, C−1) engine, mỗi engine 1 thread.
- Engine trực tiếp (nước đang xem): C−1 thread.

Có thể chỉnh trong Cài đặt.

## Gemini API key

1. Vào https://aistudio.google.com/apikey → **Create API key** (miễn phí).
2. Dán key vào **Cài đặt → Gemini**, bấm **Lưu key**, rồi **Kiểm tra kết nối**.

Key được mã hóa bằng `safeStorage` của Windows và không bao giờ được gửi xuống giao diện. Khi chạy dev, bạn cũng có thể chép `.env.example` thành `.env` và điền `GEMINI_API_KEY`.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy app ở chế độ phát triển |
| `npm test` | Chạy unit test (test engine dùng `STOCKFISH_PATH` nếu có) |
| `npm run typecheck` | Kiểm tra type |
| `npm run dist` | Build file cài đặt `.exe` vào `dist/` (chạy trên Windows) |

Chạy test với Stockfish thật trên Windows:
```powershell
$env:STOCKFISH_PATH="C:\đường\dẫn\stockfish.exe"; npm test
```

## Dữ liệu

Mọi dữ liệu nằm ở `%APPDATA%\chess-analyzer\`:
- `chess.db`: SQLite.
- `logs\app.log`: log lỗi.
- `engine\`: Stockfish tự tải về.

Kiến trúc chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
