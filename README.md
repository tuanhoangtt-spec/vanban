# Quét Văn Bản → Word & PDF

Ứng dụng web quét ảnh văn bản tiếng Việt (chữ in, chữ viết tay, biểu mẫu, bảng biểu)
và tự động xuất ra file **Word (`.docx`)** hoặc **PDF (`.pdf`)** chuẩn format văn
phòng, dùng Google Gemini (`@google/genai`, model `gemini-2.5-flash`) để đọc ảnh,
thư viện `docx` để dựng file Word và `jsPDF` + `jspdf-autotable` để dựng file PDF —
cả hai đều chạy ngay trên trình duyệt, cùng đọc từ một dữ liệu JSON nên nội dung
giữa hai định dạng luôn khớp nhau. Hỗ trợ lưu **nhiều API Key** và tự động xoay vòng
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
  pdfGenerator.ts                  # Chuyển JSON → file .pdf (jsPDF + jspdf-autotable)
  pdfFonts.ts                       # Tải & nhúng font Liberation Serif (tương thích
                                    # Times New Roman, đủ dấu tiếng Việt) vào PDF
public/fonts/
  LiberationSerif-*.ttf                # Font nhúng cho PDF (Apache-2.0, xem mục 6)
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

## 6. Định dạng file đầu ra (cố định, không cần chỉnh)

### Word (`.docx`) — `utils/docxGenerator.ts`

- Khổ giấy A4 (11906 × 16838 dxa), lề trên/dưới/trái/phải đều 2cm (1134 dxa).
- Font mặc định: **Times New Roman**, cỡ chữ **14pt** (size: 28 trong thư viện `docx`).
- Tiêu đề: in đậm, căn giữa.
- Đoạn văn: căn đều hai bên (justify).
- Dòng điền thông tin (`Họ và tên: ...........`): dùng tab-stop với leader chấm,
  giữ mạch chấm liền lạc dù nội dung dài ngắn khác nhau (không dùng ký tự `.` thô).
- Bảng biểu: có viền (borders), cell padding chuẩn, tự động xuống dòng không vỡ bảng.
- Khối chữ ký hai bên (`NGƯỜI MUA` / `NGƯỜI BÁN`...): dựng bằng bảng không viền để
  giữ hai/ba cột thẳng hàng.

### PDF (`.pdf`) — `utils/pdfGenerator.ts`

Dùng cùng dữ liệu JSON và cùng thông số layout (A4, lề 2cm, 14pt) như bản Word, dựng
bằng `jsPDF` + `jspdf-autotable`:

- Font nhúng trực tiếp vào file PDF là **Liberation Serif** — font mã nguồn mở
  (Apache-2.0), có **cùng độ rộng ký tự với Times New Roman** (metric-compatible,
  do Red Hat tạo ra làm bản thay thế miễn phí) và phủ đầy đủ dấu tiếng Việt. Không
  dùng trực tiếp font "Times New Roman" thật vì đây là font thương mại của
  Microsoft, không được phép đóng gói/phân phối lại trong ứng dụng. Về mặt hiển
  thị, hai font gần như không khác biệt.
- Bảng biểu dùng `jspdf-autotable`, tự phân trang khi bảng dài hơn 1 trang.
- Dòng chấm điền thông tin được vẽ bằng nét đứt (dash pattern) canh từ cuối nhãn
  đến trước giá trị, giá trị canh sát lề phải — cùng hiệu ứng như bản Word.
- Đoạn văn dùng `align: "justify"` của jsPDF (căn đều hai bên cho các dòng trừ dòng
  cuối) — với các đoạn cực ngắn (1 dòng), jsPDF sẽ hiển thị như căn trái vì không
  có khoảng trống để giãn đều.

## 7. Vì sao đôi khi AI đọc ảnh phức tạp bị lỗi "không tìm thấy JSON"?

Model `gemini-2.5-flash` (và các model "thinking" nói chung) mặc định dành một phần
ngân sách token để "suy nghĩ" (internal reasoning) trước khi viết câu trả lời, và
số token suy nghĩ này **bị trừ chung vào cùng ngân sách `maxOutputTokens`** với nội
dung trả lời thực sự. Với ảnh có rất nhiều chữ/bảng biểu dày đặc (như ảnh "Bảng kê
thu mua hàng hóa"), model cần suy nghĩ nhiều hơn để giữ đúng cấu trúc bảng, có thể
dùng hết ngân sách và trả về **phản hồi rỗng** (không phải lỗi mạng) — đây là lỗi đã
biết của Gemini 2.5, không phải lỗi trong code gọi API.

Cách khắc phục trong `utils/geminiClient.ts`:

- Giới hạn ngân sách "suy nghĩ" (`thinkingConfig.thinkingBudget: 2048`) để nó không
  ăn hết chỗ của phần trả lời thật.
- Tăng `maxOutputTokens` lên 16384 để có đủ chỗ cho JSON dài (bảng nhiều hàng/cột).
- Kiểm tra `finishReason` trả về: nếu là `MAX_TOKENS` với nội dung rỗng, báo lỗi rõ
  ràng bằng tiếng Việt thay vì lỗi JSON chung chung, đồng thời gợi ý người dùng chụp
  ảnh rõ hơn hoặc tách ảnh thành nhiều phần nhỏ nếu vẫn gặp lỗi.

Nếu vẫn gặp lỗi này thường xuyên với ảnh rất dày đặc chữ, có thể tăng thêm
`maxOutputTokens` (ví dụ 32768) trong `utils/geminiClient.ts`.

## 8. Nhiều API Key & tự động xoay vòng khi hết quota

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

## 9. Lưu API Key giữa các lần truy cập — vì sao đôi khi phải nhập lại?

Key được lưu vào `localStorage` của trình duyệt, gắn với **từng domain (origin)
riêng biệt**. Nếu vẫn bị hỏi lại key mỗi lần, khả năng cao là do:

- **Đang test qua các URL preview khác nhau của Vercel** — mỗi lần push code,
  Vercel tạo một domain preview mới (`ten-project-abc123.vercel.app`), và trình
  duyệt coi đó là nơi lưu trữ hoàn toàn khác với domain production. → Luôn dùng
  domain production cố định (hoặc `localhost` khi dev local) để key được nhớ.
- Đang mở bằng **cửa sổ ẩn danh / chế độ riêng tư** — dữ liệu bị xóa khi đóng cửa sổ.
- Trình duyệt/tiện ích mở rộng có bật "Xóa dữ liệu duyệt web khi thoát" hoặc chặn
  lưu trữ của bên thứ nhất.

Vì kiến trúc app không có server lưu trữ (để giữ chi phí $0 và không ai ngoài bạn
nhìn thấy key), nên không thể "nhớ" key xuyên domain bằng cách khác. Để đỡ phải gõ
lại: dùng nút **Xuất danh sách key (.json)** trong khung API Key để tải một file
sao lưu, rồi **Nhập từ file** ở môi trường mới — nhanh hơn nhiều so với dán lại
từng key. File xuất ra chứa key ở dạng plain text nên cần giữ cẩn thận, không chia
sẻ cho người khác.

## 10. Xử lý lỗi

`utils/geminiClient.ts` phân loại lỗi từ `ApiError` của SDK theo mã HTTP và hiển
thị thông báo tiếng Việt tương ứng ngay trên từng thẻ ảnh:

- Chưa thêm API Key nào.
- 400/401/403 — API Key sai, không có quyền, hoặc project chưa bật billing.
- 404 — model không tồn tại/đã bị Google ngừng hỗ trợ.
- 429 — hết hạn mức (quota) → tự động thử key kế tiếp trong pool (xem mục 8).
- 5xx — lỗi tạm thời phía Google, gợi ý thử lại sau.
- Lỗi mạng thật sự (`Failed to fetch`) — gợi ý kiểm tra Internet/tường lửa/ad-blocker.
- AI trả về JSON không hợp lệ / thiếu cấu trúc, hoặc rỗng do MAX_TOKENS (xem mục 7)
  — tự retry bằng nút "Quét lại".

## 11. Giới hạn hiện tại / hướng mở rộng

- Gemini đôi khi vẫn đọc sai vài ký tự với chữ viết tay quá xấu — vì vậy có màn
  hình xem trước & sửa nhẹ trước khi tải file (áp dụng cho cả Word lẫn PDF, vì cả
  hai đều dựng từ cùng dữ liệu đã chỉnh sửa).
- Hiện xử lý từng ảnh ra một file riêng; có thể mở rộng thêm tính năng "gộp nhiều
  ảnh vào 1 file" bằng cách nối mảng `blocks` của nhiều ảnh lại trước khi gọi
  `buildDocx()` / `buildPdf()`.
- Bản PDF dùng font Liberation Serif (thay cho Times New Roman thật vì lý do bản
  quyền — xem mục 6) nên có thể lệch độ rộng dòng vài phần trăm so với Word ở các
  đoạn văn rất dài; với văn bản hành chính thông thường thì không đáng kể.
- Có thể thêm OCR fallback (Tesseract.js) cho trường hợp không có API Key, tuy
  chất lượng nhận diện chữ viết tay sẽ kém hơn nhiều so với Gemini.
