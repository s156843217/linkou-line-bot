# 林口工具箱 LINE bot

太平洋房屋・林口捷運加盟店官方 LINE 的自動回覆機器人。
使用者傳「地址 / 社區名 / 里別」，自動回覆對應的國小・國中學區與設籍提醒。

## 架構

- **Cloudflare Worker**（`src/index.js`）：接 LINE Messaging API webhook，驗簽章 → 查詢 → 回覆。
- **`school-logic.js`**：學區查詢純邏輯（與網站 `school/index.html` 同一套演算法）。
- **`linkou-data.js`**：學區資料（社區、門牌索引、里界規則等），與主專案同一份，**需手動同步**。

## 資料同步

`linkou-data.js`、`school-logic.js` 是與主專案 `my-project` 共用的邏輯/資料。
主專案更新後，把這兩個檔複製過來再 `git push`，Cloudflare 會自動重新部署。

## 密鑰（不入庫）

Worker 需要兩個加密環境變數（在 Cloudflare 後台 → Worker → Settings → Variables and Secrets 設定）：

- `CHANNEL_SECRET` — LINE 頻道 Channel secret
- `CHANNEL_ACCESS_TOKEN` — LINE 頻道 Channel access token（long-lived）

## 部署

連動本 GitHub repo 至 Cloudflare Workers Builds，push 到主分支即自動部署。
亦可本機 `npm install && npx wrangler deploy`。
