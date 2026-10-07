# Vimeo Transcript Copier

Chrome extension (MV3) để copy hoặc tải transcript của video Vimeo nhúng trên trang (ví dụ KodeKloud). Bấm icon extension để mở popup.

## Cài đặt
1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục này.
3. Mở một bài học có video, bấm icon extension.

Sau khi sửa code, bấm nút reload của extension trong `chrome://extensions`.

## Test
```
node --check popup.js vtt.js
node --test
```

Chi tiết thiết kế xem `SPEC.md`.
