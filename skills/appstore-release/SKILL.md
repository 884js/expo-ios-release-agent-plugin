---
name: appstore-release
description: App Store Connect APIを使い、Expo / EAS製iOSアプリの対象バージョンへ処理済みビルドを紐付けてApp Reviewへ提出する。「審査に出して」「最新ビルドを選択」「App Storeへ公開申請」など、TestFlight反映後の審査提出時に使う。ビルド作成はtestflight、App Store掲載情報の更新はappstore-infoを使う。
compatibility: Node.js 18以上、App Store Connect APIへの権限、app.jsonとeas.jsonが必要。
---

# App Store審査申請

App Store Connectの画面を開かず、APIで状態確認、ビルド選択、App Review提出を行う。新しいビルドやストアメタデータは作成しない。

## Fixture

プロジェクトルートに`.release-fixture.json`があり、`externalActionsAllowed`が`false`の場合、スクリプトはローカル設定だけを表示する。

App Store Connect APIへ接続せず、ビルド紐付けやApp Review提出も行わない。

## セットアップ状態を確認する

プラグインルートの`./scripts/doctor.mjs`を解決し、プロジェクトルートで実行する。

```bash
node <plugin-root>/scripts/doctor.mjs \
  --capability appstore-release \
  --json
```

`NEEDS_SETUP`なら`setup`スキルで不足項目を案内する。`BLOCKED`ならAPIへ接続しない。状態確認の直前に`--live`を付け、EASログインも確認する。

## 認証

次の優先順位で認証する。

1. `ASC_TOKEN`
2. `ASC_ISSUER_ID`、`ASC_KEY_ID`、`ASC_PRIVATE_KEY_PATH`
3. EAS Submit用として保存済みのApp Store Connect APIキー

App Store ConnectのApp IDは、`ASC_APP_ID`または`eas.json`の`submit.{profile}.ios.ascAppId`から取得する。

秘密鍵はプロジェクトとプラグインの外に置く。秘密鍵、APIトークン、JWTを出力しない。

## 1. スクリプトを特定する

この`SKILL.md`と同じディレクトリにある`./scripts/appstore-release.mjs`の絶対パスを解決する。エージェントやプラグインのインストール先を固定パスと決めつけない。

## 2. 読み取り専用で状態確認する

プロジェクトルートで実行する。

```bash
node <skill-directory>/scripts/appstore-release.mjs
```

必要に応じて対象を明示できる。

```bash
node <skill-directory>/scripts/appstore-release.mjs \
  --profile production \
  --version 2.4.0 \
  --build-number 42
```

build番号を省略した場合は、対象バージョンで処理済みの最新ビルドを確認対象にする。

リリースノートの差分基準を特定する場合は、現在公開中のversionとbuild番号だけをJSONで取得できる。

```bash
node <skill-directory>/scripts/appstore-release.mjs \
  --project-dir <project-root> \
  --latest-released \
  --json
```

この実行はApp Store Connectの状態を変更しない。公開済みversionが見つからない場合は推測した値を返さず失敗する。

次を確認する。

- App Storeバージョン
- 処理済みbuild番号
- 現在紐付いているビルド
- App Store上のバージョン状態
- 直近のReview Submission
- 審査承認後の公開方式

## 3. 実行内容を提示する

次を簡潔に表示する。

- App Storeバージョン
- build番号
- ビルドを付け替えるか
- 審査状態
- 公開方式

読み取り専用の確認結果が不完全な場合は提出しない。

## 4. 最終確認する

外部状態を変更するため、申請直前に次の形式で確認する。

```text
App Storeの2.4.0にbuild 42を紐付け、App Reviewへ提出してよいですか？
```

明示的な同意が得られるまで提出コマンドを実行しない。

## 5. ビルドを紐付けて提出する

状態確認で表示された値をそのまま確認文字列に使う。

```bash
node <skill-directory>/scripts/appstore-release.mjs \
  --profile <profile> \
  --version 2.4.0 \
  --build-number 42 \
  --submit \
  --confirm 2.4.0/42
```

スクリプトは次を順に行う。

1. 対象バージョンと処理済みビルドを再確認
2. 必要な場合だけビルドを対象バージョンへ紐付け
3. Review Submissionを作成または再利用
4. 対象バージョンをReview Submissionへ追加
5. App Reviewへ提出

途中で失敗した場合は自動的な再試行や巻き戻しを行わず、完了した操作までを報告する。

## 6. 結果を確認する

成功後に読み取り専用の状態確認を再実行し、次を報告する。

- バージョンとbuild番号
- App Reviewの状態
- App Store Connectのアプリページ

## 境界

- 新しいビルドやTestFlight提出: `testflight`
- リリースノートなどの反映: `appstore-info`
- ビルド選択とApp Review提出: このスキル
