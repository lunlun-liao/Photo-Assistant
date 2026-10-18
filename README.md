# FRAME — AI 攝影助手

以繁體中文介面實作的手機攝影網頁原型：相機取景 → 主體選擇 → 構圖與移動引導 → 拍照前的小範圍虛擬位置探索 → 拍攝、作品集與 JPG 下載。

介面預覽：[桌機](docs/previews/desktop.png) · [手機](docs/previews/mobile.png) · [視角探索](docs/previews/viewpoint.png)。這些是介面截圖，網站尚未部署至公開網址。

## 啟動

使用 Node.js 20.19+（此環境已驗證 Node.js 24.19.0）與 npm。

```bash
cd /workspace/Photo-Assistant
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --cache /tmp/photo-assistant-npm-cache
npm run dev
```

`ONNXRUNTIME_NODE_INSTALL_CUDA=skip` 是 ONNX Runtime 官方支援的安裝選項；本產品在瀏覽器執行推論，不需要下載 Node.js CUDA 執行庫。它不會停用套件簽章、完整性或 TLS 驗證。

```bash
npm run build     # 型別檢查與正式建置，輸出至 dist/
npm run preview   # 啟動正式建置的測試伺服器
npm test          # 建置後執行 5 組瀏覽器整合測試
```

測試會使用 `/usr/bin/chromium`；其他環境請先執行 `npx playwright install chromium`，或用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定已安裝的 Chromium。測試自行啟動 4174 port 的 preview server 並在結束後關閉。

`dist/` 可放到提供 HTTPS 的靜態網站主機。相機需要安全來源（HTTPS，或在同一裝置上的 localhost），直接以手機存取一般 HTTP 區網網址無法使用相機。網頁本身不需要後端、資料庫或 API 金鑰。

## 使用方式

1. 直接使用城市橋樑範例，或按取景框上方相機圖示／下方「開啟相機」，也可以匯入照片。
2. 選擇範例標註、點擊畫面手動選取主體，或按「AI 分析畫面」執行裝置端辨識。
3. 選擇三分、對稱或引導線構圖，參考畫面的輔助線與移動提示。
4. 有深度資料後，開啟「視角探索」，拖曳預覽或使用水平／高度滑桿；可對照原圖與重設位置。
5. 按快門。照片不會包含介面或輔助線；可下載 JPG，或從「我的作品」開啟。作品用 IndexedDB 儲存在此瀏覽器，清除網站資料會移除作品，請下載重要照片。

## 已完成與目前界線

| 功能 | 實作 |
| --- | --- |
| 相機 | `getUserMedia`、前後鏡頭選擇、權限失敗提示、關閉時釋放串流；不錄音 |
| 照片匯入 | 裝置端解碼、依影像方向繪製、最長邊限制 2048px、支援瀏覽器可解碼的格式 |
| 主體分析 | Transformers.js + YOLOS Tiny；顯示真實偵測分數，辨識失敗不捏造結果；未辨識到時支援手動選取 |
| 構圖引導 | 根據主體位置與構圖目標計算方向，疊加輔助線；是畫面引導，沒有 WebXR／SLAM 空間定位 |
| 深度估測 | Transformers.js + Depth Anything Small，在 Web Worker 中執行 |
| 新位置預覽 | 根據逆深度還原 RGB-D 網格，使用 Three.js 平移虛擬相機中心，保持相機旋轉固定；不同深度有不同視差，並非平移圖片或旋轉鏡頭 |
| 拍攝與作品集 | 所見比例裁切、乾淨 JPG 輸出、IndexedDB 保存、下載與刪除 |

**尚未完成完整的生成式新視角合成。** 現階段採深度重投影，遮擋處只會拉伸已知像素，邊緣可能有未觀測空隙；不能還原相機沒看見的真實細節。要達成原始構想中的更廣視野與生成補全，需要後續接入可控的新視角生成／遮擋補全模型，並評估 GPU、延遲及影像一致性。介面已標示此限制。

一般相機模式使用即時影片。探索模式使用最近完成分析的影格，分析完畢後約隔 3 秒開始下一次深度估測，滑動或調整滑桿時立即更新重投影，靜止時不持續重繪。這不等於逐幀即時生成，速度取決於使用者裝置。初次模型載入可能超過 100 MB，模型權重由瀏覽器快取；可取消分析。

## 模型連線與驗證狀態

影像不會送往模型服務。按下 AI 分析時，瀏覽器從 Hugging Face 下載公開模型，推論於裝置端執行：

- `Xenova/depth-anything-small-hf`
- `Xenova/yolos-tiny`

初次載入需要連線 `huggingface.co` 及其權重檔案 CDN（例如 `cas-bridge.xethub.hf.co`、`cdn-lfs.huggingface.co`、`cdn-lfs-us-1.huggingface.co`、`us.aws.cdn.hf.co`）。不需要提供 Hugging Face token。

本次雲端環境對 Hugging Face 的連線回覆 403，因此**尚未在此環境驗證真實模型成功下載與推論**。已驗證正式建置、範例深度預覽、照片匯入、手動主體、比例裁切、JPG 下載、作品集保存／刪除、鍵盤與 360／390／768／1024px 版面，以及模型連線失敗時的處理。相機測試使用 Chromium 模擬媒體裝置；仍需在實體 iOS／Android 手機上測試鏡頭切換、效能與記憶體使用。

## 技術與原始碼

- React 19、TypeScript、Vite 6、Lucide 圖示；DM Sans 字型隨網站提供，不依賴 Google Fonts。
- `src/App.tsx`：拍攝流程、相機生命週期、匯入與作品集 UI。
- `src/ai.worker.ts`：裝置端深度與物件辨識。
- `src/Viewpoint.tsx`：由 RGB-D 還原幾何並平移觀察位置，按需載入 Three.js。
- `src/geometry.ts`：構圖方向、深度距離與比例裁切。
- `src/storage.ts`：IndexedDB 照片儲存。
- `tests/app.test.mjs`：正式建置的功能測試。

範例照片與深度資料的來源、處理方式及授權說明見 [public/demo/SOURCES.md](public/demo/SOURCES.md)。範例主體為人工標註，在介面中標示「範例標註」，不代表已執行 AI。
