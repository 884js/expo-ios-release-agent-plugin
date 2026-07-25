---
name: setup
description: Expo / EAS製iOSアプリでexpo-ios-releaseプラグインを使うための初期設定と診断を行う。「リリース環境をセットアップ」「初めて導入する」「doctorで不足を直して」「TestFlightやApp Store Connectの設定を始めたい」など、未設定または設定不明のプロジェクトでは必ず使う。実行スキルの診断がNEEDS_SETUPを返した時も使う。
compatibility: Node.js 18以上とExpoプロジェクトが必要。EASとAppleのアカウント操作にはユーザー本人の認証が必要。
---

# iOSリリース環境セットアップ

共通の`doctor`で現在地を確認し、不足している設定だけを段階的に整える。既存設定を推測で上書きしない。

## 1. doctorを特定する

このスキルを含むプラグインルートの`./scripts/doctor.mjs`を絶対パスへ解決する。インストール先を固定パスと決めつけない。

## 2. 読み取り専用で診断する

プロジェクトルートで実行する。

```bash
node <plugin-root>/scripts/doctor.mjs \
  --capability all \
  --json
```

結果を次の3種類で扱う。

- `READY`: ローカル設定が揃っている
- `NEEDS_SETUP`: 不足項目を追加すれば利用できる
- `BLOCKED`: 設定矛盾、壊れたJSON、fixtureなどにより続行できない

fixtureでは設定確認だけを行い、実環境への切り替えを案内する。

## 3. 対応案を提示する

診断結果から必要なものだけを提示する。

- Node.js 18以上
- EAS CLI
- `app.json`のowner、slug、version、Bundle ID
- `eas.json`のbuild／submitプロファイル
- App Store Connect App ID
- App Store情報ファイル
- 対象ロケール
- EASログイン
- App Store Connect API認証
- スクリーンショット機能を使う場合はXcode、iOS Simulator、Maestro CLI

ファイル変更、パッケージ導入、EASやAppleへの接続を分け、対象と影響を説明する。

## 4. ユーザーの同意後に設定する

同意された項目だけを変更する。

### ExpoとEAS

- EAS CLIがなければインストール方法を案内する
- EAS未設定なら`eas build:configure`を案内または実行する
- 使用するプロファイル名を確認して`eas.json`を整える
- buildとsubmitのプロファイルを同じ名前で用意する
- App Store Connect App IDを`submit.{profile}.ios.ascAppId`へ設定する

`eas build:configure`や`eas login`は対話操作になる場合がある。ユーザーが操作できる状態で進め、認証情報を表示しない。

### App Store情報

リリースノートや説明文を管理する場合は、既存アプリなら次を利用できる。

```bash
eas metadata:pull
```

新規アプリでは`store.config.json`を作成し、`configVersion`、Appleバージョン、対象ロケールを設定する。

### App Store Connect API認証

通常はEAS Submit用として保存済みのAPIキーを利用する。必要な場合は次で設定を案内する。

```bash
eas credentials --platform ios
```

環境変数を使う場合は、`ASC_ISSUER_ID`、`ASC_KEY_ID`、`ASC_PRIVATE_KEY_PATH`をすべて設定する。秘密鍵をプロジェクトやプラグインへコピーしない。

## 5. ライブ診断する

ローカル設定を整えたら、EASログインも含めて再確認する。

```bash
node <plugin-root>/scripts/doctor.mjs \
  --capability all \
  --live \
  --json
```

`READY`になるまで、不足項目を一つずつ解消する。同じ失敗を無制限に再試行しない。

App Storeスクリーンショット機能を使う場合は、`appstore-screenshots`スキルのスクリプトも読み取り専用で実行し、Xcode、iOS Simulator、Maestro CLI、撮影設定を確認する。

## 6. 結果を報告する

次を簡潔にまとめる。

- 使用するEASプロファイル
- App StoreバージョンとBundle ID
- TestFlightの準備状態
- App Store情報更新の準備状態
- App Storeスクリーンショット撮影の準備状態
- App Review提出の準備状態
- ユーザー側で残っている操作

セットアップ完了だけではビルド、メタデータ反映、App Review提出を開始しない。
