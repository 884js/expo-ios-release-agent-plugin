# Sample Expo App Fixture

`expo-ios-release`のスキル評価と設定読み取りテストに使う、オフライン専用のダミープロジェクトです。

## 用途

- `app.json`、`eas.json`、`store.config.json`、`appstore-screenshots.json`の読み取り
- バージョンとbuild番号の判定
- build／submitプロファイルの選択
- リリースノート更新案の作成
- App Storeスクリーンショットの撮影計画とMaestro Flowの確認
- Codex、Claude Code、Cursorへ同じ入力を渡す評価

## 禁止事項

`.release-fixture.json`の`externalActionsAllowed`が`false`である間は、次を実行しません。

- EAS Build
- EAS Submit
- EAS Metadata push
- EAS Metadata用ファイルの書き出し
- App Store Connect APIへの接続
- App Review提出
- iOS SimulatorやMaestroによる撮影

App ID、Bundle ID、Expo ownerは実在のアプリへ接続しないサンプル値です。

## ローカル確認

```bash
npm run typecheck
npm run lint
npm test
```
