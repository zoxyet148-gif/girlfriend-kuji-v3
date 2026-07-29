# 女朋友專屬一番賞 V4 正式版

Node.js + Express + PostgreSQL 的自選號碼一番賞網站。

## 正式版功能

- 玩家註冊、登入及共享好寶寶印章
- 管理員建立、發布、下架一番賞
- A賞固定保留，其他獎項可自由新增或刪除
- 儲存活動時預先隨機洗牌，玩家自行選擇尚未抽出的號碼
- 已抽號碼永久標記，抽獎紀錄保存籤號、獎項、玩家、時間與彈數
- 開始下一彈時保留舊抽獎紀錄，重設獎品數量並重新洗牌
- 管理員查看本彈籤位、調整玩家印章、查看歷史紀錄
- 匯出完整 JSON 備份
- Cloudinary 圖片上傳
- 手機版介面與 A/B/C/未中獎效果

## Render 必要環境變數

- `DATABASE_URL`：PostgreSQL 連線字串
- `JWT_SECRET`：JWT 密鑰
- `ADMIN_USERNAME`：管理員帳號，預設建議 `admin`
- `ADMIN_PASSWORD`：管理員密碼
- `ALLOW_REGISTRATION`：是否開放註冊，填 `true` 或 `false`

上傳圖片時還需：

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

## 部署

1. 將本專案全部檔案上傳或覆蓋到 GitHub repository 根目錄。
2. Commit changes。
3. Render 會自動偵測 GitHub 更新並重新部署。
4. Render 日誌出現 `Girlfriend Kuji V4 Formal running` 後即可使用。
5. 玩家網址為 Render 服務網址；管理員後台為服務網址加 `/admin`。

## 資料安全

升級啟動時只會建立缺少的資料表與欄位，不會主動清除原本玩家、印章或抽獎紀錄。正式使用前仍建議先在管理後台下載一次 JSON 備份。

已有歷史抽獎紀錄的一番賞，系統會禁止直接替換獎項，以避免舊紀錄因獎項被刪除而損壞；仍可修改標題、介紹、主圖、每抽印章與上下架狀態。

## V4.0 Dev2.1
- 管理後台新增「清除測試」按鈕。
- 可清除目前彈數的抽獎紀錄，並將票券恢復為未抽狀態。
- 不會修改玩家帳號、目前印章或 Cloudinary 圖片。
