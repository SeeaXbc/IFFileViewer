# IFファイルビューア

システム間連携のIFファイル（拡張子なし可）・CSV/TSV・固定長・バイナリを閲覧/検査/編集する**単一HTMLツール**。
利用者は **`IFファイルビューア.html` をブラウザ（Chrome/Edge）で開くだけ**です。インストール不要・オフライン動作・元ファイル非破壊。

- 機能仕様: [IFファイルビューア_要件定義書.md](./IFファイルビューア_要件定義書.md)
- サンプルデータ: [samples/](./samples/)（ヘッダー定義JSONのコピペ用サンプルは [samples/定義サンプル/](./samples/定義サンプル/)）

## 開発

配布物（ルートの単一HTML）は `src/` からの**ビルド成果物**です。ルートのHTMLを直接編集しないでください（ビルドで上書きされます）。

```bash
npm install          # 初回のみ（playwright-core / typescript）
# src/app.html・src/js/*.js を編集して…
npm run build        # → IFファイルビューア.html を生成（連結ビルド）
npm run typecheck    # src/js を tsc --checkJs（現在エラー0件を維持）
npm test             # E2Eテスト（自動で build してから実行）
```

- `src/app.html` … CSS＋HTMLテンプレート（`//@SCRIPT@` にJSが埋め込まれる）
- `src/js/*.js` … 番号順に連結される共有スコープのJS（バンドラ不使用）
- `tools/build.mjs` / `tools/typecheck.mjs` … ビルド・型検査
- `tests/` … Playwright＋node:test のE2E（バイト完全性・固定長・検査・マルチペイン等）
- CI（GitHub Actions）が push/PR ごとに「ビルド成果物のコミット漏れ検知＋型検査＋全テスト」を実行します
