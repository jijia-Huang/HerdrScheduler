# 補驗證：commander、快捷鍵、信任畫面、其他 herdr session（2026-11-23）

在隔離的 herdr session `schedk` 跑。正式插件已安裝（插件登記是全域的，所以 `schedk` 也會載入它）。

| # | 項目 | 結果 | 說明 |
|---|---|---|---|
| 1 | **其他 herdr server 也會載入插件** | 發現問題並修正 | 插件登記是全域的，所以任何 named session 啟動時都會跑排程器的 `[[startup]]`，而且用的是同一份資料。修正：`install.json` 記下安裝時的 herdr socket（`server_socket`），只有那個 server 可以開排程器、跑 tick；其他 server 的 startup、看門狗、action、tick 都直接不做事。實測：`schedk` 的 startup 回 `skipped: not the owner herdr server`，沒有建 workspace，正式資料沒被動到（`test/unit/owner.test.mjs`） |
| 2 | commander 模式 | 過（實測） | 在 pane 裡開 `claude`，送 `/commander`，畫面顯示 lease 在自己身上、Write/Edit/NotebookEdit 被擋。請它新增、列出、刪除排程：呼叫了 3 次 `plugin:herdr-scheduler:herdr-scheduler`，全部成功（`commander.mjs`） |
| 3 | 快捷鍵 `prefix+alt+s` | 過（實測） | 在 pane 裡開一個 herdr client（清掉 `HERDR_ENV` 等變數讓它可以巢狀）接到 `schedk`，用 `pane send-keys` 送真的 `ctrl+b`、`alt+s`：plugin log 立刻出現一筆 `open` action（因為 `schedk` 不是擁有者，結果是 `skipped`，符合 #1）。注意：client 接到自己所在的 server 會讓這個 server 之後無法建立新 terminal（`ghostty error -2`），關掉那個 client pane 就恢復，這是測試手法的副作用（`keypress.mjs`） |
| 4 | 信任資料夾畫面 | 過（實測） | 這台機器信任了 `D:/`，所以 D 槽底下都不會問。改用不在任何信任根目錄下的 `C:\...\scratchpad\trusttest`：畫面出現「Quick safety check: Is this a project you created or one you trust? … ❯ No, exit / Yes, I trust this folder / Enter to confirm · Esc to cancel」，狀態機在下一次 tick 就標成 `blocked`、發通知，沒有送任何按鍵 |
| 5 | **長路徑的 PowerShell 提示字元** | 發現問題並修正 | pane 很窄時，長路徑的提示字元會被折成好幾行，原本用「最後一行是 `PS …>`」判斷會失敗，排程就啟動不了（90 秒後標 `failed`）。修正：所有讀畫面改用 `recent-unwrapped`（邏輯行），`wait-output` 也一樣。實測修正後立即認得 |
| 6 | 啟動失敗後的 session | 修正 | 開新對話但沒成功（信任畫面、逾時）時，綁定裡留著一個從沒建立過的 session id，下次會先白試一次 `--resume`。改成這種情況清掉 session id |
| 7 | 通知 | 補強 | herdr 的 `[ui.toast] delivery` 預設 `"off"`，`notification show` 回 `shown:false, reason:"disabled"`。改成這時自動改用 Windows 通知（PowerShell 的 NotifyIcon，標題與內容經環境變數傳，不經命令列），不用改使用者的 herdr 設定。實測 PowerShell 正常結束 |
| 8 | SkillPool `h5-slot` | 過（實測） | `skillpool h5-slot -p` 問排程狀態：用到 `schedule_list`、`scheduler_status`，沒有權限確認。兩個 profile 的 `plugins.off` 都沒有 herdr-scheduler |

測完已停止並刪除 `schedk`、刪除測試用的 APPDATA 資料夾與 Claude 對話紀錄。`home2\` 留著信任畫面那次的執行紀錄。
