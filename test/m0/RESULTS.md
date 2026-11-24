# M0 補驗證結果（2026-11-23）

環境：herdr 0.8.0-preview、Claude Code 2.1.330、隔離的 herdr session `schedp1`（啟動前清掉 `CLAUDE_CODE_*`、`HERDR_*`）。
Claude 用一般 `claude --plugin-dir <claude-plugin\herdr-scheduler>` 啟動，回報 hook 是正式版的 `report.mjs`。
腳本：`scenario.mjs`（`bg`、`agent`、`esc`、`trust`、`perm`），原始紀錄在 `out\`。

| # | 項目 | 結果 | 說明 |
|---|---|---|---|
| 1 | 背景 shell 工作 | 證實 | 第一次 Stop 的 `background_tasks` 有一筆 `{"type":"shell","status":"running",...}`；背景工作做完後 Claude 自動再跑一輪，**第二次 Stop 的 `background_tasks` 是 `[]`**（第 94 秒、第 146 秒） |
| 2 | 背景子代理 | 證實 | 派出子代理後的 Stop 有 `{"type":"subagent","status":"running"}`；中間還有一次 Stop（子代理自己的背景 shell 還在跑，`background_tasks` 非空）；全部做完後最後一次 Stop 是 `[]`、回覆「ALL-DONE」 |
| 3 | 按 Esc 中斷 | **不會觸發 Stop** | 送出長任務後送 Esc：畫面顯示「Interrupted · What should Claude do instead?」，herdr 狀態變成 `done`，但 Stop hook 沒有觸發 |
| 4 | 權限確認框 | 畫面文字確認 | `--permission-mode default` 下請 Claude 用 Write 建檔：畫面出現「Do you want to create m0-perm-test.txt?」、「❯ 1. Yes」、「Esc to cancel · Tab to amend」。**herdr 一直報 `working`**，不會變成 `blocked` |
| 5 | 信任資料夾畫面 | 沒出現 | 在 `D:\` 底下新建的資料夾啟動 Claude，沒有出現信任畫面（這台機器的設定下不會問）。SessionStart 正常觸發。信任畫面的偵測保留 cc-superagent 實測過的文字當防呆 |
| 6 | 就緒時間 | 比 P0 快 | 這次 SessionStart 在 `pane run` 之後約 7～11 秒就觸發（P0 是 66 秒）。送任務前的 55 秒安全等待不變 |
| 7 | 新 tab 的 shell 提示字元 | 注意 | 同時開 5 個 tab 時，PowerShell（含 conda 初始化）超過 15 秒才出現提示字元。正式版改成「每次 tick 看一下，最多等 90 秒」 |

## 對設計的影響

- 完成判定「Stop 晚於送出時間，而且 `background_tasks` 是空的」成立（#1、#2），不用改。
- Esc 中斷沒有 Stop（#3）：第 6.5 節的 `abandoned` 規則是必要的。另外加一條：送出超過 1 分鐘、沒有 Stop、agent 閒著、畫面最後幾行是「Interrupted · What should Claude do instead?」，就直接把這次記成 `abandoned`（不通知，因為人就在 pane 前面）。
- 確認框只能靠畫面文字認（#4）。規則放在 `lib/screen.mjs`。

## 沒清掉的東西

- `D:\hsched-m0-trust-1795427711096`、`D:\hsched-m0-trust-1795427770867`：信任畫面測試建的空資料夾（只有一個 README.txt）。Claude Code 的安全檢查擋下了從 `D:\` 根目錄刪資料夾的指令，請自己刪。
