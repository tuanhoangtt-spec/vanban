# Quét Văn Bản → Word

Ứng dụng web quét ảnh văn bản tiếng Việt (chữ in, chữ viết tay, biểu mẫu, bảng biểu)
và tự động xuất ra file Word (`.docx`) chuẩn format văn phòng, dùng Google Gemini
để đọc ảnh và thư viện `docx` để dựng file Word ngay trên trình duyệt.

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
  ApiKeyBar.tsx          # Ô nhập + lưu Gemini API Key vào localStorage
  UploadZone.tsx          # Kéo thả / chọn ảnh (react-dropzone)
  DocumentCard.tsx         # Thẻ hiển thị 1 ảnh: trạng thái, nút quét, tải Word
  BlockEditor.tsx           # Xem trước & chỉnh sửa nội dung AI đọc được
utils/
  geminiPrompt.ts             # System instruction + schema JSON gửi cho Gemini
  geminiClient.ts               # Gọi Gemini API, validate & parse JSON, xử lý lỗi
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

## 7. Xử lý lỗi

`utils/geminiClient.ts` phân loại lỗi rõ ràng và hiển thị thông báo tiếng Việt
tương ứng ngay trên từng thẻ ảnh:

- Chưa nhập API Key.
- API Key sai / bị thu hồi.
- Vượt hạn mức (quota) Gemini API.
- Lỗi mạng khi gọi API.
- AI trả về JSON không hợp lệ / thiếu cấu trúc (tự retry bằng nút "Quét lại").

## 8. Giới hạn hiện tại / hướng mở rộng

- Gemini đôi khi vẫn đọc sai vài ký tự với chữ viết tay quá xấu — vì vậy có màn
  hình xem trước & sửa nhẹ trước khi tải file Word.
- Hiện xử lý từng ảnh ra một file Word riêng; có thể mở rộng thêm tính năng
  "gộp nhiều ảnh vào 1 file Word" bằng cách nối mảng `blocks` của nhiều ảnh lại
  trước khi gọi `buildDocx()`.
- Có thể thêm OCR fallback (Tesseract.js) cho trường hợp không có API Key, tuy
  chất lượng nhận diện chữ viết tay sẽ kém hơn nhiều so với Gemini.
