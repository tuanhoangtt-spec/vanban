# Quét Văn Bản → Word & PDF

Ứng dụng web quét ảnh **hoặc file PDF** văn bản tiếng Việt (chữ in, chữ viết tay,
biểu mẫu, bảng biểu, kể cả PDF nhiều trang) và tự động xuất ra file **Word (`.docx`)**
hoặc **PDF (`.pdf`)** chuẩn format văn phòng, dùng Google Gemini (`@google/genai`,
Gemini Flash (hỗ trợ đọc PDF gốc — không cần chuyển PDF thành ảnh trước)
để đọc nội dung, thư viện `docx` để dựng file Word và `jsPDF` + `jspdf-autotable`
để dựng file PDF — cả hai đều chạy ngay trên trình duyệt, cùng đọc từ một dữ liệu
JSON nên nội dung giữa hai định dạng luôn khớp nhau. Hỗ trợ lưu **nhiều API Key**
và tự động xoay vòng sang key kế tiếp khi một key hết hạn mức (quota) trong ngày.

> **Lưu ý về model:** `gemini-1.5-flash` đã bị Google ngừng hỗ trợ hoàn toàn trong
> năm 2026 (mọi request trả về lỗi 404), và `gemini-2.5-flash` cũng đã bắt đầu trả
> về 404 cho một số API Key kể từ tháng 7/2026 — SỚM HƠN ngày ngừng hỗ trợ chính
> thức Google công bố (16/10/2026). Google không rollout việc khai tử model đồng
> đều cho mọi tài khoản/khu vực, nên app không còn hardcode 1 tên model duy nhất
> nữa (xem Mục 22 trong phần "Nhật ký sửa lỗi" bên dưới). App dùng SDK
> `@google/genai` (SDK cũ `@google/generative-ai` đã bị Google khai tử). Danh sách
> model dự phòng được khai báo tại một chỗ duy nhất trong `utils/geminiClient.ts`
> (hằng số `MODEL_CANDIDATES`) — thử lần lượt, tự chuyển sang model kế tiếp nếu
> model hiện tại 404. Xem https://ai.google.dev/gemini-api/docs/models để kiểm
> tra model mới nhất nếu cần cập nhật danh sách này trong tương lai.

## 1. Kiến trúc & cách hoạt động

```
Ảnh (.jpg/.png/.webp) hoặc file PDF (nhiều trang)
   │  (kéo thả / chọn file — react-dropzone)
   ▼
Trình duyệt → gọi trực tiếp Gemini API (gemini-2.5-flash, đọc PDF gốc tự nhiên)
   │  (dùng API Key của người dùng, KHÔNG qua server trung gian)
   ▼
JSON có cấu trúc { blocks: [...] }   ← utils/geminiPrompt.ts quy định schema
   │
   ▼
Xem trước & chỉnh sửa nhẹ (components/BlockEditor.tsx)
   │
   ├──▶ utils/docxGenerator.ts (thư viện `docx`)  → file .docx
   └──▶ utils/pdfGenerator.ts (jsPDF + autotable)  → file .pdf
```

Toàn bộ xử lý (gọi Gemini + dựng file Word/PDF) chạy **hoàn toàn ở phía client**.
Không có API route, không có server lưu trữ ảnh/PDF hay dữ liệu — vì vậy app deploy
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
  UploadZone.tsx          # Kéo thả / chọn ảnh hoặc file PDF (react-dropzone)
  DocumentCard.tsx         # Thẻ hiển thị 1 file: trạng thái, nút quét, tải Word/PDF
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

## 7. Quét file PDF đầu vào (nhiều trang)

Ngoài ảnh, có thể kéo thả thẳng file `.pdf` vào ứng dụng (ví dụ đề thi, hợp đồng
nhiều trang, hồ sơ scan). Gemini 2.5 Flash đọc PDF **trực tiếp** (native document
understanding) — không cần code tự tách PDF thành từng ảnh trang trước khi gửi:

- `utils/geminiClient.ts` gửi thẳng file PDF dạng base64 (`mimeType: "application/pdf"`)
  trong cùng request như ảnh, model tự đọc hết các trang theo đúng thứ tự, kể cả
  bảng biểu/chữ viết tay/hình vẽ trong PDF scan.
- Giữa nội dung của 2 trang liền nhau, prompt yêu cầu AI tự chèn một block
  `{"type": "page_break"}` — khi xuất ra Word/PDF, hệ thống sẽ ngắt trang đúng vị
  trí đó (`utils/docxGenerator.ts` dùng `PageBreak` của thư viện `docx`,
  `utils/pdfGenerator.ts` gọi `doc.addPage()`).
- Các hình vẽ minh họa không phải văn bản/bảng (hình học, sơ đồ...) hiện **không**
  được chèn lại dưới dạng ảnh trong file xuất ra (ứng dụng không có bước trích xuất
  ảnh từ PDF) — thay vào đó AI được yêu cầu ghi chú lại bằng một đoạn in nghiêng
  dạng `[Hình minh họa: mô tả ngắn gọn]` tại đúng vị trí, để không bị mất hoàn toàn
  thông tin và người dùng biết chỗ cần tự vẽ/chèn lại nếu cần.
- Giới hạn kích thước file: request gửi lên Gemini phải dưới khoảng 20MB (base64),
  app tự chặn và báo lỗi rõ ràng nếu file vượt ~18MB trên đĩa — với file lớn hơn,
  hãy nén PDF hoặc tách bớt trang trước khi tải lên.
- PDF càng nhiều trang, JSON trả về càng dài — ngân sách token cho ảnh PDF được
  tăng riêng (`maxOutputTokens: 32768`, `thinkingBudget: 4096`) so với ảnh đơn
  (xem thêm mục 8 về giới hạn token).

## 8. Vì sao đôi khi AI đọc ảnh phức tạp bị lỗi "không tìm thấy JSON"?

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

## 9. Nhiều API Key & tự động xoay vòng khi hết quota

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

## 10. Lưu API Key giữa các lần truy cập — vì sao đôi khi phải nhập lại?

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

## 11. Xử lý lỗi

`utils/geminiClient.ts` phân loại lỗi từ `ApiError` của SDK theo mã HTTP và hiển
thị thông báo tiếng Việt tương ứng ngay trên từng thẻ ảnh:

- Chưa thêm API Key nào.
- 400/401/403 — API Key sai, không có quyền, hoặc project chưa bật billing.
- 404 — model không tồn tại/đã bị Google ngừng hỗ trợ.
- 429 — hết hạn mức (quota) → tự động thử key kế tiếp trong pool (xem mục 9).
- 5xx — lỗi tạm thời phía Google, gợi ý thử lại sau.
- Lỗi mạng thật sự (`Failed to fetch`) — gợi ý kiểm tra Internet/tường lửa/ad-blocker.
- AI trả về JSON không hợp lệ / thiếu cấu trúc, hoặc rỗng do MAX_TOKENS (xem mục 8)
  — tự retry bằng nút "Quét lại".

## 12. Giới hạn hiện tại / hướng mở rộng

- Gemini đôi khi vẫn đọc sai vài ký tự với chữ viết tay quá xấu — vì vậy có màn
  hình xem trước & sửa nhẹ trước khi tải file (áp dụng cho cả Word lẫn PDF, vì cả
  hai đều dựng từ cùng dữ liệu đã chỉnh sửa).
- Hiện xử lý từng ảnh ra một file riêng; có thể mở rộng thêm tính năng "gộp nhiều
  ảnh vào 1 file" bằng cách nối mảng `blocks` của nhiều ảnh lại trước khi gọi
  `buildDocx()` / `buildPdf()`.
- Bản PDF dùng font Liberation Serif (thay cho Times New Roman thật vì lý do bản
  quyền — xem mục 6) nên có thể lệch độ rộng dòng vài phần trăm so với Word ở các
  đoạn văn rất dài; với văn bản hành chính thông thường thì không đáng kể.
## 13. Công thức toán học (mới)

Bản cập nhật này thêm hỗ trợ đọc và xuất **công thức toán học thật** (lũy thừa,
phân số, căn thức, đạo hàm, giới hạn, tổng, tích phân...) thay vì làm phẳng
thành chữ thường như trước:

- `utils/geminiPrompt.ts` yêu cầu Gemini viết công thức bằng một tập lệnh
  LaTeX rút gọn, đặt trong cặp `$...$` ngay trong `content`/`text`/`value`
  hiện có (không đổi schema JSON) — ví dụ `"$y' = 5x^{4}$"`.
- `utils/mathParser.ts` phân tích cú pháp `$...$` này thành cây `MathNode`
  (xem `types/index.ts`).
- **Xuất Word**: `utils/docxMath.ts` dựng cây đó thành công thức OMML gốc của
  Word (`docx` package, class `Math`/`MathRun`/`MathFraction`/...) — mở file
  ra công thức có thể **bấm vào sửa trực tiếp trong Word**, không phải ảnh.
- **Xuất PDF**: `utils/pdfMath.ts` tự vẽ công thức thủ công bằng jsPDF (dịch
  baseline cho số mũ/chỉ số, vẽ vạch phân số, vẽ dấu căn...) vì jsPDF không hỗ
  trợ OMML — chất lượng tốt cho các công thức phổ biến (lũy thừa, phân số, căn,
  hàm lượng giác, giới hạn, tổng, tích phân) nhưng không đẹp bằng Word với các
  biểu thức lồng nhau quá phức tạp.
- Khung sửa (`BlockEditor.tsx`) hiển thị thêm một dòng xem trước công thức đã
  render (dùng KaTeX, `components/MathText.tsx`) ngay dưới ô nhập, để kiểm tra
  Gemini đọc đúng công thức trước khi tải file — còn ô nhập vẫn là text thường
  nên vẫn gõ/sửa trực tiếp cú pháp `$...$` được, không cần UI riêng.
- Ô bảng, dòng chấm chấm và khối chữ ký nếu có công thức sẽ hiển thị dạng chữ
  gần đúng (`utils/mathPlainText.ts`, ví dụ `x^2`, `√(x)`) thay vì công thức
  vẽ đầy đủ, để không phải xử lý layout phức tạp ở những chỗ đó.

Giới hạn: bộ cú pháp chỉ hỗ trợ những gì đề thi Toán phổ thông thường dùng
(không phải toàn bộ LaTeX) — xem danh sách lệnh trong `SYSTEM_INSTRUCTION` ở
`utils/geminiPrompt.ts`.

### 13.1. Sửa lỗi: hàm lượng giác bình phương (cos²x, sin²x, tan²x, cot²x)

Phát hiện khi test với đề thi thật: viết `\cos{x}^{2}` (cú pháp được dạy cho
Gemini) trước đây bị dựng thành **"cos x²"** thay vì **"cos²x"** — số mũ trôi
ra sau đối số `x` thay vì nằm ngay sau tên hàm, ở cả Word lẫn PDF. Đã sửa:

- `utils/pdfMath.ts` và `utils/docxMath.ts`: nhận diện pattern
  `sup{base: func}` (tức "hàm số được nâng lũy thừa") và đặt số mũ ngay sau
  tên hàm, tách đối số ra ngoài.
- Riêng bản Word: phải tự dựng thêm một "run chữ đứng" (`m:sty="p"`) bằng các
  lớp XML cấp thấp của `docx` package, vì cách làm cũ dựa vào `MathFunction`
  để Word tự hiển thị tên hàm chữ đứng (không nghiêng) — bỏ `MathFunction` đi
  thì mất luôn kiểu chữ đó nếu không bù lại thủ công.

## 14. Chèn lại hình vẽ/đồ thị gốc (mới)

Phát hiện khi test với đề thi có đồ thị hàm số: trước đây gặp hình vẽ minh
họa (đồ thị, sơ đồ...), hệ thống chỉ ghi lại dòng chữ `[Hình minh họa: ...]`
thay vì hình thật — người dùng mất hẳn hình khi tải file. Đã sửa bằng cách
thêm block type mới `"image"`:

- Gemini (`utils/geminiPrompt.ts`, rule 14) chỉ cần trả về **toạ độ khung
  (bbox)** quanh hình đó — tỉ lệ 0..1 so với chiều rộng/cao trang, không phải
  trả ảnh (tốn token, dễ lỗi với model vision).
- `utils/imageCrop.ts` (chạy phía trình duyệt) cắt đúng vùng bbox đó ra từ
  file gốc người dùng tải lên: ảnh → cắt trực tiếp bằng `<canvas>`; PDF →
  dựng trang bằng `pdfjs-dist` thành ảnh trước rồi mới cắt. Kết quả là một
  PNG data URL gắn vào block, gọi ngay sau khi Gemini trả JSON (`app/page.tsx`).
- `docxGenerator.ts` dùng `ImageRun` của package `docx`, `pdfGenerator.ts`
  dùng `doc.addImage()` của jsPDF để nhúng ảnh thật, tự co theo khổ trang.
- Nếu vì lý do gì đó bbox lỗi hoặc chưa cắt kịp, block vẫn có fallback về
  dòng chữ `[Hình minh họa: ...]` như cũ — không bao giờ crash hay mất trắng.

Giới hạn: bbox do Gemini ước lượng nên có thể lệch/thừa biên đôi chút (đã dặn
Gemini thà ước lượng rộng hơn còn hơn cắt hụt); độ nét ảnh cắt từ PDF phụ
thuộc độ phân giải dựng trang (`PDF_RENDER_SCALE` trong `imageCrop.ts`, mặc
định scale=2, có thể tăng nếu cần ảnh nét hơn nhưng file sẽ nặng hơn).

## 15. Sửa lỗi: mất "ô vuông" nhập từng ký tự (số CCCD...) (mới)

Phát hiện khi test với mẫu tờ khai CT01 thật: dãy ô vuông rời để nhập từng
số một (như 12 ô số định danh cá nhân) bị mất khi convert. Nguyên nhân: rule
6 cũ mô tả "bảng biểu" là thứ "có nhiều hàng nhiều cột", nên một dãy CHỈ 1
HÀNG nhiều ô vuông rỗng nhiều khả năng không được Gemini xếp vào loại
"table" và bị bỏ qua. Đã bổ sung rule 6 nêu rõ: dãy ô vuông 1 hàng để điền
từng ký tự vẫn PHẢI là `"table"` (1 hàng, mỗi ô vuông là 1 cột, content để
trống). Không cần sửa code dựng bảng — `docxGenerator.ts`/`pdfGenerator.ts`
vốn đã vẽ viền ô đầy đủ cho mọi bảng, chỉ cần Gemini phân loại đúng.

## 16. Sửa lỗi: `npm run build` thất bại vì worker của pdfjs-dist (mới)

**Phát hiện bằng cách chạy thật `npm run build`** (không phải đoán) — build
production của Next.js báo lỗi:

```
static/media/pdf.worker.min.xxxxx.mjs from Terser
x 'import', and 'export' cannot be used outside of module code
```

**Nguyên nhân:** cách nạp worker cũ dùng
`new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` — Next.js
nhận diện được cú pháp này, tự copy file worker thành asset tĩnh, NHƯNG sau
đó vẫn chạy Terser để minify asset đó như một file JS thường. File worker của
pdfjs-dist lại là ES module thật (có `import`/`export` ở top-level), Terser
mặc định không parse được cú pháp module nên build gãy ở bước production
(`next dev` không bị vì dev không minify). Đây là lỗi đã biết, chưa được
Next.js team xử lý dứt điểm (xem thảo luận
[vercel/next.js#61549](https://github.com/vercel/next.js/discussions/61549));
các cách né phổ biến trên đó đều dựa vào CDN ngoài (unpkg, cdnjs), không hợp
với thiết kế "$0, tự chủ hoàn toàn, không phụ thuộc dịch vụ ngoài" của app
này.

**Đã sửa (không cần CDN):**
- `scripts/copy-pdf-worker.js` (MỚI) — copy thẳng
  `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` vào `public/pdf.worker.min.mjs`.
- `package.json` — thêm script `"postinstall": "node scripts/copy-pdf-worker.js"`
  để file này tự động được copy lại mỗi khi `npm install` (kể cả trên máy
  build của Vercel), luôn khớp đúng phiên bản `pdfjs-dist` đang cài.
- `utils/imageCrop.ts` — đổi `GlobalWorkerOptions.workerSrc` từ
  `new URL(...)` sang chuỗi tĩnh `"/pdf.worker.min.mjs"` (trỏ vào file vừa
  copy ở `public/`). Vì đây chỉ là một chuỗi string bình thường, webpack
  không còn nhận diện/đóng gói/minify file worker nữa — Terser không bao giờ
  chạm vào nó, nên lỗi biến mất.
- `public/pdf.worker.min.mjs` — file thực tế được thêm vào repo (được
  copy tự động, nhưng commit sẵn 1 bản để môi trường build không có mạng
  npm vẫn chạy được `next build` ngay cả khi bỏ qua bước `postinstall`).

**Đã xác nhận:** chạy `npm run build` thật (Next.js 14.2.35) từ sạch —
trước khi sửa: build gãy đúng lỗi trên; sau khi sửa: `✓ Compiled successfully`,
build ra static page hoàn chỉnh. (Lưu ý: trong sandbox không có mạng ra
Google Fonts nên phải tạm bỏ `next/font/google` để test bước webpack riêng —
đã khôi phục lại `app/layout.tsx` nguyên trạng sau khi xác nhận xong; lỗi
font đó là do sandbox không có mạng, không liên quan đến bug này, sẽ không
xảy ra khi build trên Vercel có mạng thật.)

## 17. Sửa lỗi: "Có block với định dạng không hợp lệ" khi ảnh có đồ thị (mới)

**Phát hiện bằng test thật của người dùng** — chạy `npm run dev` thật, quét
file PDF thật (`4 (1).pdf`, đề có đồ thị hàm số) bằng Gemini thật → báo lỗi
"Có block với định dạng không hợp lệ trong dữ liệu AI trả về."

**Nguyên nhân:** `validateBlocks()` trong `utils/geminiClient.ts` có danh
sách `allowedTypes` (whitelist) để kiểm tra từng block Gemini trả về có hợp
lệ không, trước khi cho vào state. Danh sách này được viết TRƯỚC khi tính
năng chèn hình vẽ (`"image"` block, xem mục 2/14) được thêm vào, và không
được cập nhật theo — thiếu đúng `"image"` trong whitelist. Mọi nơi khác
trong code (`BlockEditor.tsx`, `docxGenerator.ts`, `pdfGenerator.ts`) đều đã
xử lý `case "image"` đầy đủ, chỉ riêng whitelist này bị bỏ sót. Kết quả:
Gemini trả JSON đúng và có ích (đúng như thiết kế — trả `bbox` cho đồ thị),
nhưng bị chính app tự chặn ở bước validate trước khi kịp cắt ảnh.

**Đã sửa:** thêm `"image"` vào `allowedTypes` trong `validateBlocks()`
(`utils/geminiClient.ts`). Một dòng, không cần đổi gì khác.

**Ý nghĩa:** đây là bằng chứng đầu tiên rằng Gemini thật (không phải JSON tự
viết tay mô phỏng) trả bbox cho đồ thị đúng theo rule 14 — vấn đề duy nhất
là app tự chặn, không phải Gemini trả sai. Vẫn cần test lại từ đầu (`npm run
dev`, quét lại đúng file `4 (1).pdf` này) để xác nhận: (a) lỗi hết hẳn, (b)
đồ thị được cắt và chèn đúng vị trí, (c) format công thức/toán trong đề vẫn
đúng.

## 18. Sửa lỗi: JSON bị cắt cụt khi ảnh có bảng lớn (form CT01) (mới)

**Phát hiện bằng test thật của người dùng** — quét ảnh `mau-ct01-moi-nhat-1.jpg`
(mẫu tờ khai CT01 thật) → báo lỗi "AI trả về dữ liệu không đúng định dạng
JSON. Vui lòng thử quét lại."

**Nguyên nhân:** form CT01 rất dày đặc (bảng thành viên hộ gia đình 10 hàng
× 6 cột = 60 ô, cộng 2 dãy 12 ô vuông CCCD = 24 ô, cộng các trường khác) —
tổng cộng JSON trả về cần khá nhiều token. Cấu hình cũ chỉ cấp
`maxOutputTokens: 16384` cho ảnh (JPG/PNG), thấp hơn hẳn PDF (`32768`), dựa
trên giả định sai rằng ảnh luôn đơn giản hơn PDF. Với form dày đặc này,
Gemini bị cắt ngang giữa chừng khi đang viết JSON (`finishReason:
"MAX_TOKENS"`) nhưng phần đã viết ra KHÔNG rỗng (chỉ là JSON không đầy đủ) —
trong khi code cũ chỉ kiểm tra `finishReason === "MAX_TOKENS"` ở nhánh
`resultText` HOÀN TOÀN RỖNG. Vì vậy phản hồi cụt vẫn lọt qua nhánh đó, rơi
thẳng xuống `JSON.parse()`, thất bại, và hiện thông báo chung chung "không
đúng định dạng JSON" — đúng hiện tượng nhưng sai nguyên nhân hiển thị cho
người dùng.

**Đã sửa** (`utils/geminiClient.ts`):
- Kiểm tra `finishReason === "MAX_TOKENS"` (và `SAFETY`/`PROHIBITED_CONTENT`)
  NGAY sau khi có `resultText`, không phụ thuộc `resultText` rỗng hay không
  — để hiện đúng thông báo "quá nhiều nội dung" thay vì lỗi JSON chung
  chung, dù response có rỗng hay chỉ là JSON cụt.
- Bỏ phân biệt `isPdf` khi cấp ngân sách token — ảnh giờ cũng được
  `maxOutputTokens: 32768` / `thinkingBudget: 4096` giống PDF, vì thực tế đã
  chứng minh ảnh (form dày) có thể tốn token ngang PDF.

**Lưu ý trung thực:** việc tăng ngân sách token là cách sửa hợp lý nhất có
thể làm mà KHÔNG gọi được Gemini thật trong sandbox này để đo chính xác form
CT01 cần bao nhiêu token — 32768 là ước lượng rộng rãi dựa theo số ô đã đếm
được, chưa phải con số đã đo. Cần người dùng quét lại đúng file này để xác
nhận đã đủ hay chưa; nếu vẫn cắt cụt ở form phức tạp hơn, cần tăng thêm hoặc
cân nhắc chia nhỏ ảnh.

## 19. Sửa lỗi: 1 trong 2 hình đồ thị bị cắt ra trắng tinh (mới)

**Phát hiện bằng cách đọc trực tiếp file `.docx` người dùng gửi về sau khi
quét `4 (1).pdf` thật** (không phải đoán) — dùng Python/PIL đo độ lệch chuẩn
màu của 2 ảnh nhúng trong file: ảnh thứ nhất có nội dung thật (std ≈ 27),
ảnh thứ hai **hoàn toàn trắng đồng nhất (std = 0)** — bbox của Gemini cho đồ
thị thứ hai (câu "Câu hỏi dễ sai") lệch khỏi vị trí đồ thị thật, cắt trúng
vùng trắng bên cạnh/bên dưới. Bản thân việc cắt không hề báo lỗi (canvas vẽ
"thành công" một vùng trắng), nên ảnh trắng vô nghĩa này lọt thẳng vào file
Word xuất ra mà không có cảnh báo gì.

**Đã sửa** (`utils/imageCrop.ts`) — thêm bước kiểm tra sau khi cắt: lấy mẫu
lưới điểm ảnh (tối đa ~64×64 điểm) trong vùng vừa cắt, tính độ lệch chuẩn độ
sáng; nếu gần như đồng màu tuyệt đối (ngưỡng `BLANK_CROP_STD_THRESHOLD =
2.5`) thì coi là cắt thất bại (bbox lệch), ném lỗi để rơi vào nhánh fallback
sẵn có (không có `dataUrl` → `docxGenerator.ts`/`pdfGenerator.ts` tự động
hiện `[Hình minh họa: ...]` bằng chữ thay vì ảnh trắng). Một hình vẽ thật
(dù đơn giản, chỉ có trục toạ độ + 1 đường cong) luôn có độ lệch chuẩn cao
hơn hẳn ngưỡng này vì có mực đen/xám phủ một phần đáng kể diện tích; chỉ
vùng THỰC SỰ trắng/đồng màu mới rơi dưới ngưỡng.
- `components/BlockEditor.tsx` — sửa luôn dòng chữ hiển thị khi ảnh không có
  `dataUrl`, từ "Đang cắt hình..." (sai ngữ cảnh — lúc màn hình này hiện ra
  thì việc cắt đã xong hẳn, không còn "đang" cắt nữa) thành "Không cắt được
  hình", đúng với thực tế.

**Lưu ý trung thực:** đây là fix PHÒNG THỦ (không hiện ảnh trắng vô nghĩa),
KHÔNG PHẢI fix tận gốc (bbox của Gemini vẫn có thể lệch). Không có JSON gốc
Gemini trả về cho lần quét này để biết bbox sai cụ thể ra sao, nên chưa thể
sửa rule 14 trong `geminiPrompt.ts` một cách có căn cứ — cần thêm dữ liệu
thật (vài lần quét nữa, đặc biệt các trang có NHIỀU hình xếp chồng theo
chiều dọc như trang này) mới đủ để tinh chỉnh prompt cho đúng hướng.

## 20. Nâng cấp mục 19: tự phục hồi thay vì chỉ bỏ cuộc (mới)

**Bối cảnh:** người dùng quét lại đúng file `4 (1).pdf` sau bản vá mục 19 —
không còn ảnh trắng lọt vào file nữa (đúng như kỳ vọng), nhưng đồ thị thứ 2
vẫn bị THIẾU HẲN, chỉ còn `[Hình minh họa]` — tức mục 19 chỉ "chữa cháy"
(ẩn cái sai) chứ chưa thật sự lấy được hình đúng. Lỗi lặp lại y hệt ở lần
quét thứ 2 trên cùng 1 file → bbox của Gemini cho hình thứ 2 (khi có 2 hình
xếp chồng dọc trên cùng trang) lệch có tính hệ thống, không phải nhiễu ngẫu
nhiên.

**Hướng sửa:** vì không gọi được Gemini thật trong sandbox để sửa tận gốc
bằng cách chỉnh prompt (mục 19 đã nêu), chuyển sang làm cho bước CẮT ẢNH tự
phục hồi: khi vùng cắt đúng bbox bị trắng, thay vì bỏ cuộc ngay, MỞ RỘNG
vùng cắt quanh đúng tâm bbox cũ (giữ nguyên phỏng đoán "khoảng nào" của
Gemini, chỉ nới rộng biên) và thử lại, tăng dần hệ số `[1, 1.6, 2.2, 3]`,
dừng ở lần đầu tiên không còn trắng. Chỉ khi mở rộng hết cỡ vẫn trắng mới
thật sự rơi về fallback chữ như mục 19.

**Đã kiểm chứng bằng dữ liệu thật** (không đoán): dựng lại CHÍNH XÁC logic
`isCropBlank`/`expandBbox`/vòng lặp mở rộng bằng Node + package `canvas`
(thay cho `<canvas>` trình duyệt), chạy trực tiếp trên ảnh trang PDF gốc đã
render (`4 (1).pdf` → JPG 150dpi). Giả lập đúng kiểu lỗi đã quan sát được
(bbox cùng kích thước, đúng cột ngang chứa đồ thị, nhưng lệch xuống vùng
trắng dưới đáy khung nội dung — khớp với việc ảnh xuất ra trắng tuyệt đối
std=0 mà người dùng gặp phải):
```
factor=1   bbox={x:0.20, y:0.49, w:0.55, h:0.09}  → blank=true   (khớp lỗi thật)
factor=1.6 bbox={x:0.035,y:0.463,w:0.88, h:0.144} → blank=false  (phục hồi được)
```
→ Ngay ở lần mở rộng đầu tiên (1.6×) đã lấy lại được vùng có nội dung thật
(đường cong đồ thị), xác nhận bằng cách lưu file PNG kết quả và xem trực
tiếp — đúng là đồ thị, không phải vùng chữ hay hình còn lại.

**Code:** `utils/imageCrop.ts` — `cropCanvasRegion()` giờ trả về cả
`blank: boolean` thay vì tự ném lỗi; `expandBbox()` (mới) nới bbox quanh
tâm, giới hạn trong [0,1]; `cropWithBlankRecovery()` (mới) là vòng lặp thử
theo `BLANK_RECOVERY_FACTORS`, chỉ ném lỗi (→ fallback chữ) khi mọi mức mở
rộng đều trắng.

**Lưu ý trung thực (vẫn còn):**
- Đây VẪN là fix ở lớp phòng thủ/phục hồi, không sửa được nguyên nhân gốc
  (vì sao Gemini ước lượng lệch cho hình thứ 2 khi có nhiều hình xếp chồng).
  Nếu bbox lệch quá xa (ngoài phạm vi mở rộng tối đa ×3) thì vẫn thất bại
  như cũ.
- Mở rộng bbox có đánh đổi: ở hệ số cao (×2.2, ×3), vùng cắt có thể lớn hơn
  cần thiết, lỡ "ăn" luôn chữ/hình bên cạnh nếu 2 hình rất sát nhau. Chấp
  nhận đánh đổi này vì tốt hơn hẳn so với mất trắng hoàn toàn.
- Vẫn cần quét lại đúng file này lần nữa để xác nhận trên đường dẫn thật
  (Gemini → cropImageBlocks → docx), không chỉ qua mô phỏng Node như trên.

## 21. Sửa lỗi: hình đồ thị bị cắt hụt/méo tỉ lệ (không trắng, nhưng sai) (mới)

**Bối cảnh:** file test khác (`Untitled.jpg` — 2 câu trắc nghiệm, mỗi câu 1
đồ thị bậc 3, xuất ra `Untitled.pdf`) — người dùng báo "vẫn thấy sai". Đồ
thị của Câu 2 (hình thứ 2 trong 2 hình xếp chồng dọc — **giống hệt mẫu lỗi ở
mục 19/20**, nhưng đây là file hoàn toàn khác) bị cắt hụt/méo, không hiển
thị đủ đường cong.

**Vì sao mục 19/20 không bắt được lỗi này:** ảnh xuất ra KHÔNG trắng (có
điểm ảnh thật, `std` bình thường) nên `isCropBlank`/`cropWithBlankRecovery`
không kích hoạt. Đây là dạng lỗi khác: bbox không sai vị trí, mà sai KÍCH
THƯỚC (quá chật), cắt xuyên qua hình thay vì trọn vẹn hình.

**Điều tra bằng dữ liệu thật** (đọc trực tiếp ảnh nhúng trong `Untitled.pdf`
bằng `pdfimages`/PyMuPDF, đối chiếu với `Untitled.jpg` gốc):
- Đo tỉ lệ khung hình vùng nội dung thật (bám sát pixel có mực) của từng đồ
  thị trên ảnh gốc: đồ thị 1 ≈ 1.83, đồ thị 2 ≈ 1.40.
- Đo tỉ lệ khung hình ảnh THỰC TẾ đã nhúng vào PDF: đồ thị 1 = 452×149
  (≈3.03), đồ thị 2 = 361×149 (≈2.42) — cả hai đều lệch xa tỉ lệ thật, đồ
  thị 2 lệch nặng hơn hẳn.
- Suy ngược ra tỉ lệ bbox (0..1) Gemini đã dùng: `height ≈ 0.180` cho CẢ
  HAI đồ thị — dù kích thước thật của 2 đồ thị trên trang khác nhau rõ rệt.
  Đây là bằng chứng khá rõ: Gemini có xu hướng dùng lại một chiều cao "mẫu"
  áng chừng thay vì đo riêng từng hình, đặc biệt với hình thứ 2 trở đi khi
  có nhiều hình tương tự xếp chồng trên cùng trang.

**Đã sửa** (`utils/imageCrop.ts`) — thêm phát hiện dạng lỗi thứ hai bên
cạnh "trắng tinh": **"chạm mép"** — nếu vùng có mực (ink) trong ảnh đã cắt
áp sát CẢ HAI biên của một trục (trái+phải, hoặc trên+dưới) gần như không
còn lề, coi là dấu hiệu bbox quá chật (vì rule 14 vốn đã dặn Gemini ước
lượng RỘNG RÃI — một bbox đúng theo tinh thần đó không bao giờ để nội dung
chạm sát mép cả hai phía). Gộp chung với cơ chế mở rộng bbox có sẵn ở mục
20 (`cropWithRecovery()`, đổi tên từ `cropWithBlankRecovery()`): thử lần
lượt các hệ số mở rộng `[1, 1.6, 2.2, 3]`, dừng ở lần đầu tiên vừa không
trắng vừa không chạm mép; nếu không có lần nào "sạch" hoàn toàn, dùng bản
mở rộng nhất còn có nội dung thật (thà ảnh hơi thừa lề còn hơn ảnh cắt cụt);
chỉ thật sự bỏ cuộc (fallback chữ) khi MỌI lần thử đều trắng.

**Đã kiểm chứng bằng dữ liệu thật** (dựng lại đúng logic TypeScript bằng
Node + package `canvas`, chạy trực tiếp trên `Untitled.jpg` gốc):
```
Đồ thị 2 (hỏng): factor=1   → clipped=true  (minY=0, maxY=0.99 — chạm cả 2 mép trên/dưới, khớp lỗi thật)
                 factor=1.6 → clipped=false (phục hồi, kích thước 578×238)
Đồ thị 1 (đã ổn): factor=1   → clipped=false (giữ nguyên 452×149, KHÔNG bị mở rộng thừa)
```
→ Xác nhận hai điều quan trọng: (1) cơ chế mới bắt đúng và phục hồi được
đúng trường hợp lỗi thật; (2) không "sửa nhầm" trường hợp vốn đã ổn — đồ
thị 1 giữ nguyên kích thước gốc vì không bị coi là chạm mép, tránh mở rộng
lãng phí/không cần thiết.

**Lưu ý trung thực:**
- Đây vẫn là fix ở lớp phục hồi (client-side), không sửa được nguyên nhân
  gốc trong cách Gemini ước lượng bbox. Insight về "dùng chung height ≈0.18
  cho nhiều hình khác nhau" rất đáng để đưa vào rule 14 của
  `geminiPrompt.ts` (dặn rõ: đo riêng từng hình, không dùng lại kích thước
  của hình trước) — CHƯA làm việc này vì cần thêm vài mẫu thật nữa để chắc
  chắn đây là xu hướng chung chứ không phải trùng hợp của riêng 2 file đã
  test.
- Ngưỡng "chạm mép" (`EDGE_TOUCH_MARGIN_FRACTION = 0.03`) và bậc thang mở
  rộng dùng chung với mục 20, chưa được tinh chỉnh riêng cho dạng lỗi này —
  hợp lý theo dữ liệu đã có, nhưng vẫn cần thêm test thật để xác nhận không
  quá nhạy (dương tính giả) hoặc chưa đủ nhạy trên các trang khác.
- **Đính chính:** phần chat hiển thị nội dung `Untitled.pdf` cho tôi xem có
  kèm một dòng chữ to bất thường, lặp lại một phần câu hỏi
  ("y = f(x) có đồ thị như hình vẽ bên. Giá t / bằng:") trước ảnh Câu 2.
  Đã kiểm tra bằng cách đọc trực tiếp font-size từng đoạn chữ trong chính
  file `Untitled.pdf` (qua PyMuPDF) — KHÔNG tìm thấy đoạn chữ to/lặp nào,
  mọi cỡ chữ đều bình thường (12-16pt, đúng như thiết kế). Nhiều khả năng
  đó là lỗi hiển thị của công cụ chuyển đổi PDF sang văn bản khi đưa file
  vào cuộc trò chuyện này để tôi đọc, KHÔNG PHẢI lỗi thật trong file PDF
  bạn có. Bạn có thể tự mở file PDF gốc để xác nhận lại xem có thấy dòng
  chữ to đó không — nếu không thấy thì đúng như suy đoán ở trên.


---

## Phiên tiếp theo: khổ giấy ngang + siết lại rule 14 (chưa test qua Gemini/browser thật)

Người dùng báo 2 điều sau khi thử nghiệm thêm: (1) tool vẫn luôn xuất ra khổ
dọc dù văn bản gốc là ngang; (2) gửi kèm 2 file PDF ví dụ để minh hoạ đồ thị
"vẫn chưa hoàn hảo". Đã điều tra và sửa mục (1); mục (2) cần làm rõ thêm
trước khi sửa tiếp — xem phần "Chưa giải quyết" bên dưới.

### Mục 22 — Không có khái niệm khổ giấy ngang/dọc ở bất kỳ đâu trong pipeline

**Xác nhận bằng cách đọc trực tiếp code:** `pdfGenerator.ts` hardcode
`orientation: "portrait"` khi khởi tạo `jsPDF`; `docxGenerator.ts` hardcode
`PAGE_WIDTH_DXA`/`PAGE_HEIGHT_DXA` theo A4 dọc cố định trong `section.page.size`.
Không có field "orientation" nào trong `ParsedDocument`, trong schema JSON
Gemini phải trả về (`geminiPrompt.ts`), hay bất kỳ đâu khác — đây không phải
lỗi mới phát sinh mà là tính năng chưa từng được làm ở các phiên trước.

**Đã sửa (mức tài liệu — một hướng giấy cho toàn bộ file xuất ra, CHƯA hỗ
trợ trộn dọc/ngang trong cùng một file):**
1. Thêm `detectDocumentOrientation(file)` trong `imageCrop.ts` — xác định
   hướng giấy từ chính KÍCH THƯỚC TRANG THẬT của file người dùng tải lên,
   KHÔNG hỏi Gemini (đáng tin hơn, không tốn thêm lượt gọi model):
   - PDF: dùng `pdfjs` lấy `viewport` (width/height) của từng trang — chỉ đo
     kích thước, không render — rồi lấy theo đa số phiếu (width>height ⇒
     landscape) trên toàn bộ số trang, phòng trường hợp một vài trang bị
     lệch/scan sai mà đa số trang vẫn đúng hướng.
   - Ảnh: dùng `naturalWidth`/`naturalHeight` của chính ảnh.
2. Gắn kết quả vào field mới `ParsedDocument.orientation` (`types/index.ts`),
   set ngay sau khi Gemini quét xong, trước bước cắt hình (`app/page.tsx`).
3. `docxGenerator.ts`: hoán đổi width/height A4 và set
   `PageOrientation.LANDSCAPE`/`PORTRAIT` tương ứng trong `section.page.size`.
4. `pdfGenerator.ts`: đổi các hằng khổ trang (`PAGE_WIDTH_MM`,
   `PAGE_HEIGHT_MM`, `CONTENT_WIDTH_MM`, `CONTENT_BOTTOM_MM`) từ `const`
   sang `let`, gán lại đúng 1 lần ở đầu `buildPdf()` dựa trên
   `document.orientation`, TRƯỚC khi vẽ bất kỳ block nào. Vì mọi hàm vẽ
   (`drawParagraph`, `drawTable`, `drawImage`...) đọc các hằng này qua
   closure ở thời điểm gọi (không phải thời điểm định nghĩa), chỉ cần gán
   lại 1 chỗ duy nhất là toàn bộ các hàm vẽ tự động ăn theo — không cần sửa
   từng hàm hay truyền thêm tham số layout xuyên suốt. `doc.addPage()` cũng
   được sửa để truyền tường minh `("a4", "landscape"|"portrait")` thay vì
   gọi không tham số, tránh việc trang tiếp theo (sau `page_break` hoặc
   tràn nội dung) âm thầm quay lại portrait mặc định của jsPDF.

**Giới hạn còn lại (nói rõ để không hiểu nhầm là đã xong hoàn toàn):**
- Đây là hướng giấy MỨC TÀI LIỆU (1 giá trị cho cả file), không phải mức
  từng trang. Nếu một PDF có, ví dụ, trang 1-5 dọc và trang 6 duy nhất
  ngang (một bảng lớn xoay ngang xen giữa văn bản dọc), hiện tại cả file
  vẫn ra 1 hướng theo đa số phiếu — trang thiểu số sẽ bị ép sai hướng.
  Hỗ trợ trộn hướng thật sự cần: `docx` phải tách nhiều `sections` (mỗi
  đoạn giữa hai `page_break` một section với `page.size` riêng) và jsPDF
  phải gọi `addPage(format, orientation)` khác nhau tại từng lần ngắt
  trang thay vì 1 giá trị cố định — chưa làm vì (a) chưa có bằng chứng thực
  tế văn bản hành chính/đề thi tiếng Việt hay bị trộn hướng giữa chừng,
  (b) độ phức tạp thêm vào không nhỏ. Nếu người dùng gặp trường hợp trộn
  hướng thật, đây là hướng để mở rộng tiếp.
- **CHƯA test qua Gemini thật + browser thật** — chỉ mới qua `tsc --noEmit`
  (0 lỗi) và `npm run build` (build sạch, đã tạm thay `next/font/google`
  bằng font hệ thống để cô lập lỗi mạng của sandbox rồi khôi phục nguyên
  trạng ngay sau, không phải thay đổi chính thức). Cần người dùng tự quét
  thử một file khổ ngang thật để xác nhận trang xuất ra đúng là landscape.

### Mục 23 — Siết lại rule 14 trong `geminiPrompt.ts` (bbox hình vẽ)

Đây là việc còn mở ghi ở cuối phiên trước: bằng chứng từ 2 file test độc
lập (mục 19-21) cho thấy Gemini có xu hướng dùng lại một "kích thước mẫu"
áng chừng cho hình thứ 2 trở đi khi nhiều hình xếp chồng dọc trên cùng
trang, thay vì đo riêng từng hình. Các fix mục 19-21 trước đó đều là lớp
PHỤC HỒI ở client (phát hiện + mở rộng bbox khi cắt hỏng), chưa sửa ở gốc.

**Đã sửa:** thêm đoạn hướng dẫn tường minh vào rule 14, ngay sau câu "Ước
lượng bbox rộng rãi hơn một chút..." — dặn rõ: khi một trang có từ 2 hình
trở lên, phải đo riêng bbox cho TỪNG hình dựa trên ranh giới thật của chính
nó, và CẤM dùng lại width/height đã ước lượng cho hình trước nếu hình sau
khác biệt rõ rệt về kích thước trong ảnh gốc.

**Giới hạn:** đây là thay đổi PROMPT, tác động của nó lên hành vi thật của
Gemini hoàn toàn chưa đo được (sandbox không gọi được Gemini API). Không
thay thế 2 lớp phục hồi mục 19-21 — vẫn giữ nguyên cả hai, vì kể cả khi
prompt cải thiện, phục hồi ở client vẫn là lưới an toàn cần thiết cho các
lần lỡ tay còn sót. Cần người dùng test thật trên vài file có nhiều hình
xếp chồng để xem tần suất bbox sai có giảm rõ rệt hay không.

### Chưa giải quyết — cần làm rõ thêm: "hình học/đồ thị chưa hoàn hảo"

Người dùng gửi kèm 2 file PDF làm ví dụ. Phân tích trực tiếp bằng PyMuPDF:
- File 12 trang (bản đề gốc, có 4 ảnh logo lặp lại y hệt trên mọi trang) —
  đây là FILE GỐC chưa qua app, dùng để đối chiếu, không phải output.
- File 1 trang còn lại: **0 ảnh raster nhúng**, chỉ có 55 nét vẽ vector,
  đồ thị được vẽ bằng vector rất sạch (trục, nhãn, nét cong đều là path).

Vấn đề: `pdfGenerator.ts` hiện tại CHỈ vẽ block "image" bằng
`doc.addImage(...)` — tức luôn là PNG raster cắt từ canvas, KHÔNG BAO GIỜ tự
vẽ vector. Một file có đồ thị thuần vector, không một ảnh raster nào, không
khớp với cách app hiện tại tạo ra file — nhiều khả năng đây là bản gốc/tham
chiếu "chuẩn" trước khi bị scan/chụp lại thành bản lộn xộn (file 12 trang),
chứ không phải output thật sự của app qua Gemini.

**Đã hỏi lại người dùng** để xin đúng file .docx/.pdf do chính app xuất ra
(sau khi quét file gốc 12 trang bằng Gemini thật) hoặc mô tả cụ thể hơn chỗ
"chưa hoàn hảo" (lệch vị trí? méo tỉ lệ? thiếu nhãn trục? mất nét?) — CHƯA
nhận được phản hồi/file mới tại thời điểm này nên chưa thể chẩn đoán tiếp.
Mục 23 ở trên (siết rule 14) là bước chủ động làm trước dựa trên bằng chứng
đã có sẵn từ phiên trước, nhưng có thể không phải đúng nguyên nhân của vấn
đề người dùng đang thấy ở 2 file mới này — cần xác nhận lại khi có dữ liệu.

---

## Phiên tiếp theo: quét bị lỗi 404 model ngay từ bước đầu (chưa test qua Gemini/browser thật)

Người dùng gửi ảnh chụp lỗi hiện ra trên UI ngay khi bấm quét:

```
Model "gemini-2.5-flash" không khả dụng với API Key này (404). Model có thể
đã bị Google ngừng hỗ trợ — vui lòng báo cho người phát triển để cập nhật
tên model.
```

### Mục 24 — `gemini-2.5-flash` trả 404 sớm hơn ngày Google công bố ngừng hỗ trợ

**Xác nhận nguyên nhân bằng web search** (không đoán mò): Google công bố
ngày ngừng hỗ trợ chính thức cho `gemini-2.5-flash` là "không sớm hơn
16/10/2026", nhưng nhiều lập trình viên đã báo trên chính forum của Google
(discuss.ai.google.dev, từ đầu tháng 7/2026) rằng model này bắt đầu trả về
404 "no longer available" cho một số API Key/khu vực SỚM HƠN NHIỀU so với
ngày công bố — Google không rollout việc khai tử đồng đều cho mọi tài
khoản. Đây đúng là tình huống người dùng gặp phải: app không có lỗi logic
gì, chỉ đơn giản là hardcode 1 tên model duy nhất (`gemini-2.5-flash`) và
Google đã ngừng phục vụ tên đó cho API Key này trước thời hạn.

**Đã sửa (2 lớp):**
1. Đổi từ hardcode 1 model sang danh sách dự phòng `MODEL_CANDIDATES` trong
   `utils/geminiClient.ts`: `["gemini-flash-latest", "gemini-2.5-flash",
   "gemini-3.5-flash"]`. `gemini-flash-latest` là alias CHÍNH THỨC do
   Google công bố dành riêng cho vấn đề này — luôn tự trỏ tới model Flash
   GA mới nhất phía server, nên sẽ tiếp tục hoạt động qua các lần Google
   đổi tên model trong tương lai mà không cần sửa code. Hai model còn lại
   là lưới an toàn tường minh (bản thân alias cũng từng có tiền lệ bị lỗi
   khi Google chuyển giao giữa hai thế hệ model).
2. `callGemini()` giờ thử lần lượt từng model trong danh sách: nếu 1 model
   trả về lỗi 404 (thêm mã lỗi mới `MODEL_NOT_FOUND` để phân biệt với các
   lỗi 4xx khác như sai key/chưa bật billing), tự động chuyển sang model
   kế tiếp trong CÙNG một lượt quét — người dùng không thấy lỗi nếu còn ít
   nhất 1 model trong danh sách còn hoạt động. Các lỗi KHÁC (quota, sai
   key, bị chặn nội dung, mạng...) vẫn báo ngay lập tức như cũ, không bị
   danh sách dự phòng này che giấu hay làm chậm.

**Giới hạn còn lại:**
- **CHƯA test qua Gemini thật** — sandbox không gọi được Gemini API. Chỉ
  mới xác nhận bằng `npx tsc --noEmit` (0 lỗi, sau khi `npm install` thật
  để có type declarations) và `npm run build` (build sạch, đã tạm thay
  `next/font/google` bằng object rỗng để cô lập lỗi mạng Google Fonts của
  sandbox — không liên quan đến bug, đã khôi phục `layout.tsx` nguyên trạng
  ngay sau khi xác nhận build sạch). Người dùng cần tự quét thử lại 1 ảnh
  bất kỳ để xác nhận app không còn báo lỗi 404 nữa.
- Nếu cả 3 model trong danh sách đều 404 (rất khó xảy ra cùng lúc, nhưng
  không phải bằng 0), app báo lỗi rõ ràng liệt kê tên cả 3 model đã thử,
  thay vì lỗi mơ hồ như trước — nhưng lúc đó vẫn cần người dùng/người phát
  triển tự cập nhật danh sách `MODEL_CANDIDATES` bằng tay theo model mới
  nhất tại https://ai.google.dev/gemini-api/docs/models.
- Việc thử nhiều model tuần tự khi 1 model 404 làm tăng nhẹ độ trễ lần quét
  đầu tiên sau mỗi đợt Google đổi model (thêm ~1 round-trip request lỗi
  trước khi model đúng phản hồi), nhưng không đáng kể so với thời gian
  Gemini xử lý ảnh/PDF, và chỉ xảy ra cho tới khi Google hoàn toàn ổn định
  lại tên model.
