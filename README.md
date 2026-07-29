# 🎀 女朋友專屬一番賞 V3

這是可長期使用的正式版本，採用 Node.js + PostgreSQL + Cloudinary。

## 已完成

- 玩家註冊、登入、修改玩家名稱
- 共用好寶寶印章
- 管理員發放或扣除印章
- 多套一番賞、主視覺、活動介紹、每抽印章數
- 手機相簿圖片上傳並永久保存到 Cloudinary
- 抽獎前確認與印章餘額預覽
- 抽獎箱、抽籤券、翻牌結果動畫
- A 賞彩虹、B 賞金色、C 賞紫色
- 未中獎哭哭動畫，不使用大獎光效
- 玩家中獎與抽獎紀錄
- 一番賞重置鍵：保留設定與歷史，開始下一輪
- PostgreSQL 交易鎖定，避免同時抽獎造成超抽

## Render 部署方式

### 1. 上傳到 GitHub

把此資料夾內全部檔案上傳到新的 GitHub Repository。

### 2. 建立 Render Blueprint

在 Render 選擇 **New → Blueprint**，連接 Repository。Render 會讀取 `render.yaml`，建立：

- Web Service
- PostgreSQL Database

### 3. 設定必要環境變數

Render 會要求輸入 `ADMIN_PASSWORD`。請設定你自己的管理員密碼，不要寫在程式或 GitHub 裡。

接著在 Web Service 的 Environment 補上 Cloudinary：

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Cloudinary 免費方案足夠兩人一般使用。未設定 Cloudinary 時網站仍能登入與抽獎，但無法永久上傳圖片。

### 4. 登入位置

- 玩家頁：網站首頁
- 管理員頁：`你的網址/admin`

管理員帳號由 `ADMIN_USERNAME` 與 `ADMIN_PASSWORD` 建立。登入頁不會顯示或提示密碼。

## 從 V2 升級的重要提醒

V3 改用 PostgreSQL，不能直接沿用 V2 的 SQLite 資料檔。建議先部署為全新服務並測試，再決定是否替換原網址。

## 長期使用注意事項

- 資料存在 PostgreSQL，不會因重新部署程式而消失。
- 圖片存在 Cloudinary，不會因 Render 重啟而消失。
- Render 免費 Web Service 可能休眠，第一次開啟需等待一段時間；資料不會因此消失。
- 免費 PostgreSQL 方案與保留政策可能調整，正式長期使用前請查看 Render 當下方案，或升級付費資料庫。
- 建議定期從後台保存重要紀錄；未來可再加入 CSV 匯出與自動備份。
