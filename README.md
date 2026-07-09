# Quét Văn Bản → Word

Ứng dụng web quét ảnh văn bản tiếng Việt (chữ in, chữ viết tay, biểu mẫu, bảng biểu)
và tự động xuất ra file Word (`.docx`) chuẩn format văn phòng, dùng Google Gemini
(`@google/genai`, model `gemini-2.5-flash`) để đọc ảnh và thư viện `docx` để dựng
file Word ngay trên trình duyệt. Hỗ trợ lưu **nhiều API Key** và tự động xoay vòng
sang key kế tiếp khi một key hết hạn mức (quota) trong ngày.

> **Lưu ý về model:** `gemini-1.5-flash` đã bị Google ngừng hỗ trợ hoàn toàn trong
> năm 2026 (mọi request trả về lỗi 404). App này dùng `gemini-2.5-flash` qua SDK
> `@google/genai` (SDK cũ `@google/generative-ai` đã bị Google khai tử). Model ID
> được khai báo tại một chỗ duy nhất trong `utils/geminiClient.ts` (hằng số `MODEL`)
> để dễ cập nhật khi Google đổi model trong tương lai — xem
> https://ai.google.dev/gemini-api/docs/models để kiểm tra model mới nhất.

## 1. Kiến trúc & cách hoạt động

```
Ảnh (.jpg/.png/.webp)
   │  (kéo thả / chọn file — react-dropzone)
   ▼
Trình duyệt → gọi trực tiếp Gemini API (gemini-1.5-flash)
   │  (dùng API Key của người dùng, KHÔNG qua server trung gian)
   ▼
JSON có cấu trúc { blocks: [...] }   ← utils/geminiPrompt.ts quy định schema
   │
   ▼
Xem trước & chỉnh sửa nhẹ (components/BlockEditor.tsx)
   │
   ▼
utils/docxGenerator.ts (thư viện `docx`) → file .docx tải trực tiếp về máy
```

Toàn bộ xử lý (gọi Gemini + dựng file Word) chạy **hoàn toàn ở phía client**.
Không có API route, không có server lưu trữ ảnh hay dữ liệu — vì vậy app deploy
được ở chế độ tĩnh/serverless trên Vercel với chi phí $0 (chỉ tốn chi phí gọi
Gemini API theo tài khoản Google của người dùng).

## 2. Cấu trúc thư mục

```
app/
  layout.tsx          # Root layout, load font Be Vietnam Pro / Source Serif 4
  globals.css          # Tailwind + style phụ trợ
  page.tsx              # Trang chính: quản lý state ảnh, API key, điều phối UI
components/
  ApiKeyManager.tsx     # Quản lý NHIỀU Gemini API Key: thêm/xóa, hiển thị trạng thái
                        # sẵn sàng / hết quota hôm nay, lưu vào localStorage
  UploadZone.tsx          # Kéo thả / chọn ảnh (react-dropzone)
  DocumentCard.tsx         # Thẻ hiển thị 1 ảnh: trạng thái, nút quét, tải Word
  BlockEditor.tsx           # Xem trước & chỉnh sửa nội dung AI đọc được
utils/
  apiKeyPool.ts               # Lưu trữ + logic xoay vòng key (đánh dấu hết quota,
                              # tự reset lúc 0h hôm sau, ưu tiên key ít dùng nhất)
  geminiPrompt.ts             # System instruction + schema JSON gửi cho Gemini
  geminiClient.ts               # Gọi Gemini API (thử lần lượt các key trong pool
                                # khi gặp lỗi quota), validate & parse JSON, xử lý lỗi
  docxGenerator.ts                # Chuyển JSON → file .docx (docx npm package)
types/
  index.ts                          # Định nghĩa TypeScript cho các loại block
```

## 3. Cài đặt & chạy thử (local)

Yêu cầu: Node.js ≥ 18.

```bash
npm install
npm run dev
```

Mở `http://localhost:3000`, dán Gemini API Key vào ô ở đầu trang (lấy miễn phí tại
https://aistudio.google.com/app/apikey), rồi kéo thả ảnh vào để quét.

## 4. Build production

```bash
npm run build
npm run start
```

## 5. Deploy lên Vercel (miễn phí)

1. Đẩy project này lên một repo GitHub.
2. Vào https://vercel.com → **New Project** → chọn repo vừa tạo.
3. Vercel tự nhận diện Next.js, không cần cấu hình thêm (không cần biến môi
   trường vì API Key do người dùng tự nhập trên giao diện).
4. Bấm **Deploy**. Xong — app chạy trên hạ tầng serverless/edge miễn phí của
   Vercel, không phát sinh chi phí server vì mọi lệnh gọi AI đều đi thẳng từ
   trình duyệt người dùng đến Google.

## 6. Định dạng file Word đầu ra (cố định, không cần chỉnh)

Xem chi tiết trong `utils/docxGenerator.ts`:

- Khổ giấy A4 (11906 × 16838 dxa), lề trên/dưới/trái/phải đều 2cm (1134 dxa).
- Font mặc định: **Times New Roman**, cỡ chữ **14pt** (size: 28 trong thư viện `docx`).
- Tiêu đề: in đậm, căn giữa.
- Đoạn văn: căn đều hai bên (justify).
- Dòng điền thông tin (`Họ và tên: ...........`): dùng tab-stop với leader chấm,
  giữ mạch chấm liền lạc dù nội dung dài ngắn khác nhau (không dùng ký tự `.` thô).
- Bảng biểu: có viền (borders), cell padding chuẩn, tự động xuống dòng không vỡ bảng.
- Khối chữ ký hai bên (`NGƯỜI MUA` / `NGƯỜI BÁN`...): dựng bằng bảng không viền để
  giữ hai/ba cột thẳng hàng.

## 7. Nhiều API Key & tự động xoay vòng khi hết quota

Từ tháng 12/2025 Google đã giảm mạnh (50–80%) hạn mức miễn phí của Gemini API,
nên việc hết quota trong ngày xảy ra khá thường xuyên nếu dùng nhiều. Vì vậy app
hỗ trợ lưu **nhiều API Key** (mỗi key có thể là một tài khoản Google khác nhau):

1. Dán từng key vào ô ở đầu trang rồi bấm **Thêm** — có thể thêm bao nhiêu key tùy ý.
2. Khi quét, app luôn thử **key ít được dùng gần đây nhất trong số các key còn quota**.
3. Nếu Gemini trả lỗi 429 (hết quota) cho key đang dùng, app tự động đánh dấu key đó
   "hết quota hôm nay" và **thử ngay key tiếp theo** trong danh sách — người dùng
   không cần thao tác gì thêm.
4. Cờ "hết quota" tự động được xóa sau 0h00 giờ địa phương của ngày hôm sau (ước tính
   hợp lý cho hạn mức reset theo ngày của Gemini free tier).
5. Nếu **tất cả** key trong danh sách đều hết quota, app báo lỗi rõ ràng thay vì
   quét âm thầm thất bại.

Toàn bộ logic này nằm trong `utils/apiKeyPool.ts` (quản lý danh sách + trạng thái)
và `utils/geminiClient.ts` → hàm `scanImageWithKeyPool()` (vòng lặp thử từng key).

## 8. Xử lý lỗi

`utils/geminiClient.ts` phân loại lỗi từ `ApiError` của SDK theo mã HTTP và hiển
thị thông báo tiếng Việt tương ứng ngay trên từng thẻ ảnh:

- Chưa thêm API Key nào.
- 400/401/403 — API Key sai, không có quyền, hoặc project chưa bật billing.
- 404 — model không tồn tại/đã bị Google ngừng hỗ trợ.
- 429 — hết hạn mức (quota) → tự động thử key kế tiếp trong pool (xem mục 7).
- 5xx — lỗi tạm thời phía Google, gợi ý thử lại sau.
- Lỗi mạng thật sự (`Failed to fetch`) — gợi ý kiểm tra Internet/tường lửa/ad-blocker.
- AI trả về JSON không hợp lệ / thiếu cấu trúc (tự retry bằng nút "Quét lại").

## 9. Giới hạn hiện tại / hướng mở rộng

- Gemini đôi khi vẫn đọc sai vài ký tự với chữ viết tay quá xấu — vì vậy có màn
  hình xem trước & sửa nhẹ trước khi tải file Word.
- Hiện xử lý từng ảnh ra một file Word riêng; có thể mở rộng thêm tính năng
  "gộp nhiều ảnh vào 1 file Word" bằng cách nối mảng `blocks` của nhiều ảnh lại
  trước khi gọi `buildDocx()`.
- Có thể thêm OCR fallback (Tesseract.js) cho trường hợp không có API Key, tuy
  chất lượng nhận diện chữ viết tay sẽ kém hơn nhiều so với Gemini.
