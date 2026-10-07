# Spec: Vimeo Transcript Copier (Chrome Extension cho KodeKloud)

## 1. Bối cảnh
- KodeKloud (`learn.kodekloud.com`) nhúng video bằng iframe `https://player.vimeo.com/video/<id>?...&texttrack=en-US`.
- Trang không cho xem hay copy transcript, nhưng video **có sẵn phụ đề** (file WebVTT).
- Mục tiêu: một extension cá nhân để **copy hoặc tải transcript** của bài đang học, dùng cho việc ghi chú và ôn tập.
- Cách dùng: người dùng **bấm icon extension** trên thanh công cụ, popup mở ra để xem, copy hoặc tải transcript. Extension **không vẽ gì lên trang KodeKloud**.

## 2. Kết quả đã kiểm chứng (2026-10-06)

| Kiểm tra | Kết quả |
|---|---|
| Trong frame `player.vimeo.com`, đọc `window.playerConfig.request.text_tracks` | ✅ Ra 11 track: en-US, hi, fr, pt, es, ar, zh-CN, de, ja, ko, ru |
| `fetch(track.url)` từ trong trang player | ❌ Bị **CSP** chặn (`connect-src` không có `captions.vimeo.com`) |
| Mở URL `.vtt` ở tab riêng | ✅ Tải được, không cần referrer hay cookie |

**Kết luận:**
- Việc tải file `.vtt` phải làm ở **popup** (extension page), vì nó không chịu CSP của trang. Khai báo `host_permissions` cho `captions.vimeo.com` để không vướng CORS.
- Việc đọc `playerConfig` phải chạy trong **MAIN world** của iframe, làm bằng `chrome.scripting.executeScript`.

Cấu trúc một track:
```json
{
  "id": 305506449,
  "lang": "en-US",
  "url": "https://captions.vimeo.com/captions/305506449.vtt?expires=...&sig=...",
  "kind": "captions",
  "label": "English (United States)",
  "default": true,
  "language": "en-US"
}
```
Lưu ý: `url` có `expires` và `sig`, nên mỗi lần mở popup phải **đọc lại** từ `playerConfig`, không cache.

## 3. Tính năng (MVP)

| # | Tính năng | Mô tả |
|---|---|---|
| F1 | Popup | Bấm icon extension mở popup, gồm: tiêu đề video, dropdown ngôn ngữ, checkbox timestamp, vùng xem trước, nút Copy / Tải .txt |
| F2 | Chọn video | Nếu trang có nhiều iframe Vimeo thì hiện dropdown chọn video. Chỉ có một video thì ẩn |
| F3 | Chọn ngôn ngữ | Liệt kê mọi track (theo `label`). Mặc định chọn track `default` hoặc `en-US` |
| F4 | Chế độ đoạn văn | Mặc định. Nối các cue thành văn bản liền mạch, bỏ trùng lặp và khoảng trắng thừa |
| F5 | Chế độ timestamp | Mỗi cue một dòng `[mm:ss] text` (video ≥ 1 giờ thì dùng `[hh:mm:ss]`) |
| F6 | Copy | Copy vào clipboard, nút đổi thành "Copied ✓" trong 2 giây |
| F7 | Tải .txt | Tên file `<video title>.<lang>.txt`, đã lọc ký tự cấm trong tên file |
| F8 | Chuyển bài | Mỗi lần mở popup đều đọc lại từ trang, nên luôn ra đúng bài hiện tại |
| F9 | Báo lỗi | "Không tìm thấy video Vimeo trên trang này", "Video này không có phụ đề", "Link hết hạn, hãy reload trang" (khi gặp 401/403), "Không tải được phụ đề" kèm nút Thử lại |

## 4. Kiến trúc

Không có content script, service worker hay `postMessage`. Popup làm hầu hết mọi việc.

```
Bấm icon extension
 └── popup.html / popup.js        UI, điều phối, fetch VTT, copy, tải
        │ chrome.scripting.executeScript({ allFrames: true, world: 'MAIN', func })
        ▼
     iframe player.vimeo.com      chỉ đọc window.playerConfig, trả dữ liệu thuần
        
     popup.js ──fetch──► captions.vimeo.com   (nhờ host_permissions)
```

### Luồng
1. Popup mở, hiện trạng thái "Đang tải…". Lấy tab đang active bằng `chrome.tabs.query({active: true, currentWindow: true})`.
2. Gọi `chrome.scripting.executeScript` với `allFrames: true` và `world: 'MAIN'`. Hàm `func` đọc `playerConfig.request.text_tracks` và `playerConfig.video.title`, trả về `{title, tracks}`. Frame không có `playerConfig` thì trả `null`.
3. Popup lọc các kết quả khác `null`. Có một video thì dùng luôn, nhiều video thì hiện dropdown chọn.
4. Popup dựng dropdown ngôn ngữ, chọn track mặc định, rồi `fetch(track.url)` và kiểm tra `response.ok`.
5. Popup gọi `parseVtt` rồi `formatTranscript`, hiện kết quả trong vùng xem trước. Copy và Tải dùng kết quả này.
   - Đổi ngôn ngữ thì quay lại bước 4.
   - Đổi chế độ timestamp thì chỉ render lại từ `cues[]`, không tải lại.

### Trạng thái popup
```
LOADING ──► READY ──(đổi ngôn ngữ)──► LOADING_TRACK ──► READY
   │                                        │
   └──► ERROR ◄─────────────────────────────┘
```
Trạng thái trong bộ nhớ chỉ gồm `tracks`, `selectedTrack`, `cues`, `showTimestamps`. Đóng popup là mất hết.

## 5. Cấu trúc file

```
vimeo-transcript-copier/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js        (điều phối flow, DOM, clipboard, tải file)
├── vtt.js          (parseVtt, formatTranscript: hàm thuần, không đụng DOM hay chrome.*)
├── vtt.test.js     (test bằng node:test)
├── icons/ (16, 48, 128)
├── README.md
└── SPEC.md
```

### manifest.json (phác thảo)
```json
{
  "manifest_version": 3,
  "name": "Vimeo Transcript Copier",
  "version": "0.1.0",
  "description": "Copy/download transcripts from Vimeo players (e.g. KodeKloud).",
  "action": {
    "default_popup": "popup.html",
    "default_icon": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
  },
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" },
  "permissions": ["scripting"],
  "host_permissions": [
    "https://player.vimeo.com/*",
    "https://captions.vimeo.com/*"
  ]
}
```
- `host_permissions` cho `player.vimeo.com` là cần thiết, vì `executeScript` vào iframe khác origin cần quyền trên chính origin đó.
- Không cần quyền `tabs` hay `downloads`.

### vtt.js
Để Node import được khi test, cuối file thêm:
```js
if (typeof module !== 'undefined') module.exports = { parseVtt, formatTranscript };
```
`popup.html` nạp `vtt.js` trước `popup.js` bằng thẻ `<script>`.

## 6. Parse WebVTT
Các bước:
1. Chuẩn hoá xuống dòng (`\r\n` → `\n`), tách file thành các block bằng dòng trống.
2. Bỏ block `WEBVTT`, `NOTE`, `STYLE`, `REGION`.
3. Trong mỗi block: dòng có `-->` là timing (lấy `start`). Các dòng sau là text. Dòng trước timing là cue id, bỏ.
4. Text: bỏ tag `<...>` (`<i>`, `<c.xxx>`, `<00:00:01.000>`), decode entity (`&amp;`, `&lt;`, `&gt;`, `&nbsp;`).
5. Kết quả là mảng `{start: seconds, text}`.
6. Chế độ đoạn văn: nối các text bằng dấu cách, gộp khoảng trắng, bỏ cue trùng liên tiếp.
   Ngắt đoạn khi có khoảng lặng > 2 giây hoặc câu kết thúc bằng `.?!` sau khoảng ~500 ký tự (tuỳ chọn).

## 7. UI (popup)

Rộng khoảng 400px, cao khoảng 500px, một cột.

```
┌──────────────────────────────────────────┐
│ Vimeo Transcript Copier                  │
├──────────────────────────────────────────┤
│ Working with Hardware                    │  tiêu đề video
│ Video:    [ Video 1 ▾ ]                  │  chỉ hiện khi có >1 video
│ Ngôn ngữ: [ English (United States) ▾ ]  │
│ [✓] Hiện timestamp                       │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ So in this lesson we are going to    │ │  vùng xem trước
│ │ look at the hardware components...   │ │  (textarea readonly, cuộn được)
│ └──────────────────────────────────────┘ │
│ 1.240 từ · 62 dòng                       │  thống kê (tuỳ chọn)
├──────────────────────────────────────────┤
│ [   📋 Copy   ]   [  ⬇ Tải .txt  ]       │
└──────────────────────────────────────────┘
```

Các trạng thái hiển thị:

| Trạng thái | Giao diện |
|---|---|
| Đang tải | Dropdown và nút bị vô hiệu hoá. Vùng xem trước hiện "Đang tải phụ đề…" |
| Sẵn sàng | Như bố cục ở trên |
| Lỗi | Thay vùng nội dung bằng thông báo. Lỗi tải được thì có nút **Thử lại** |
| Không có video | Chỉ hiện "Không tìm thấy video Vimeo trên trang này", ẩn dropdown và các nút |

Quy tắc:
- Font hệ thống (`system-ui`), màu sáng/tối theo `prefers-color-scheme`, CSS thuần.
- Nút Copy và Tải bị vô hiệu hoá khi chưa có nội dung.
- Clipboard: thử `navigator.clipboard.writeText` trước. Không được thì fallback `textarea` + `document.execCommand('copy')`.
- Tải file: `Blob` + `URL.createObjectURL` + `<a download>`.
- Ghi nhớ lựa chọn (ngôn ngữ, timestamp) để phase 2.

## 8. Edge cases
| Tình huống | Xử lý |
|---|---|
| Tab không có Vimeo / không frame nào có `playerConfig` | Báo "Không tìm thấy video Vimeo trên trang này" |
| Trang chưa load xong lúc bấm icon | Báo như trên, người dùng đợi trang load rồi bấm lại (không retry tự động ở MVP) |
| Không có track | Báo "Video này không có phụ đề" |
| URL hết hạn (401/403) | Báo "Link hết hạn, hãy reload trang" |
| Lỗi mạng / status khác | Báo "Không tải được phụ đề" + nút Thử lại |
| Nhiều iframe Vimeo trên một trang | `allFrames: true` trả kết quả từng frame, hiện dropdown chọn video |
| Vimeo đổi cấu trúc config | Chỉ cần sửa hàm `func` đọc `playerConfig`. Fallback (phase 2): gọi `https://player.vimeo.com/video/<id>/config` |
| Tab là trang `chrome://` hoặc trang không cho inject | `executeScript` lỗi, báo như trường hợp không có video |

## 9. Ngoài phạm vi MVP (phase 2+)
- Chuyển sang **Side Panel** (`chrome.sidePanel`) nếu muốn panel luôn mở cạnh video khi chuyển bài. Logic gần như giữ nguyên.
- Sidebar transcript chạy song song với video: tô sáng câu đang phát, bấm vào câu thì video nhảy tới đó (cần thêm content script hoặc `executeScript` tương tác với player).
- Xuất `.md` hoặc `.srt`.
- Tải hàng loạt transcript cả module (cần đọc danh sách bài trong sidebar KodeKloud).
- Ghi nhớ ngôn ngữ và chế độ mặc định (`chrome.storage`).
- Nút "Tóm tắt bằng AI".

## 10. Kiểm thử
1. `node --check popup.js vtt.js` và `node --test` (chạy `vtt.test.js`).
2. `chrome://extensions` → Developer mode → **Load unpacked** → chọn thư mục.
3. Mở bài KodeKloud "Working with Hardware" → bấm icon extension → popup hiện tiêu đề và danh sách ngôn ngữ.
4. English → Copy → dán ra editor, so với phụ đề khi bật CC.
5. Bật timestamp → kiểm tra định dạng `[mm:ss]`. Chọn `ja` → Tải .txt → mở file kiểm tra encoding UTF-8.
6. Chuyển bài khác qua sidebar → bấm icon lại → transcript đúng bài mới.
7. Để tab mở lâu (quá `expires`) → mở popup lại → vẫn chạy bình thường vì URL được đọc mới.
8. Mở một trang không có Vimeo → popup báo "Không tìm thấy video Vimeo trên trang này".

## 11. Lưu ý pháp lý
Extension chỉ để **dùng cá nhân** cho việc học. Transcript là nội dung có bản quyền của KodeKloud, không phát tán.
Nếu muốn đưa lên Chrome Web Store thì phải xem điều khoản của KodeKloud và Vimeo trước.
