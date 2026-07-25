# Expo iOS Release Agent Plugin

Expo / EAS製iOSアプリのリリース作業を、Codex・Claude Code・Cursorで再利用するためのAgent Skillsプラグインです。TestFlightへの提出、App Storeスクリーンショットの撮影、App Reviewの申請を、確認可能な段階に分けて進めます。

## 収録スキル

| スキル | 担当 |
| --- | --- |
| `setup` | 初期設定と共通のセットアップ診断 |
| `ios-release` | リリース全体の進行と段階管理 |
| `testflight` | バージョン確認、EAS Build、TestFlight提出 |
| `appstore-screenshots` | MaestroによるApp Store掲載画像の撮影、検証、EAS Metadata用書き出し |
| `appstore-info` | リリースノートやApp Store掲載情報の更新 |
| `appstore-release` | App Store Connectのビルド選択とApp Review提出 |

各スキルは独立して呼び出せます。「iOSアプリをリリースしたい」のような依頼では、`ios-release` が必要な段階を判定して順番に進めます。

## 初回セットアップ

プラグインを導入したら、対象のExpoプロジェクトで次のように依頼します。

```text
このアプリでiOSリリース環境をセットアップして
```

`setup`スキルが共通の`doctor`を実行し、Node.js、EAS CLI、Expo設定、EASプロファイル、App Store Connect App ID、App Store情報ファイル、認証状態を確認します。

読み取り専用で確認する場合:

```bash
node /path/to/plugin/scripts/doctor.mjs \
  --capability all
```

EASログインも含める場合:

```bash
node /path/to/plugin/scripts/doctor.mjs \
  --capability all \
  --live
```

各実行スキルも必要な範囲だけ`doctor`を呼び、`NEEDS_SETUP`の場合は外部操作を始めず`setup`へ案内します。

## テスト用プロジェクト

`fixtures/sample-expo-app`に、3クライアントへ共通入力として渡せるオフライン専用のExpo設定一式があります。

- 架空のApp ID、Bundle ID、Expo ownerだけを使用
- `.release-fixture.json`で外部操作を禁止
- バージョン、プロファイル、ロケール、リリースノートの判定に使用
- EAS BuildやApp Store Connectへの接続は行わない

## 前提

- Node.js 18以上
- EAS CLI
- EASへログイン済み、または`EXPO_TOKEN`を設定済み
- Apple Developer ProgramとApp Store Connectへの必要な権限
- プロジェクトルートに`app.json`と`eas.json`
- メタデータを反映する場合は`store.config.json`
- スクリーンショットを撮影する場合はmacOS、Xcode、iOS Simulator、Maestro CLI 2.3.0以上

詳しい設定は[プロジェクト要件](references/project-requirements.md)を参照してください。

Maestroはプラグインへ同梱せず、`appstore-screenshots`の診断時に利用可能か確認します。他のリリーススキルでは必要ありません。

## 利用方法

### Codex

GitHubリポジトリをマーケットプレイスとして登録し、プラグインを追加します。

```bash
codex plugin marketplace add 884js/expo-ios-release-agent-plugin
codex plugin add expo-ios-release@expo-ios-release
```

### Claude Code

GitHubリポジトリをマーケットプレイスとして登録し、プラグインをインストールします。

```bash
claude plugin marketplace add 884js/expo-ios-release-agent-plugin
claude plugin install expo-ios-release@expo-ios-release
```

開発中のローカルチェックでは、プラグインディレクトリを直接指定できます。

```bash
claude --plugin-dir /path/to/plugin
```

### Cursor

Cursorのローカルプラグイン領域へリポジトリを配置します。

```bash
git clone \
  https://github.com/884js/expo-ios-release-agent-plugin.git \
  ~/.cursor/plugins/local/expo-ios-release
```

### Agent Skillsとして導入

プラグイン管理を使わず、スキルだけをユーザー領域へリンクすることもできます。リポジトリのルートで対象を指定します。

```bash
node scripts/install.mjs --target codex
node scripts/install.mjs --target claude
node scripts/install.mjs --target cursor
```

3クライアントすべてへ入れる場合は`--target all`を使います。既存の同名スキルは上書きしません。

プロジェクト単位で利用する場合は、対象プロジェクトで次を実行します。

```bash
node /path/to/plugin/scripts/install.mjs \
  --target all \
  --scope project
```

プロジェクト内のインストール先にシンボリックリンクが含まれる場合は、プロジェクト外への書き込みを防ぐため停止します。

## プラグイン構成

| クライアント | manifest |
| --- | --- |
| Codex | `.codex-plugin/plugin.json` |
| Claude Code | `.claude-plugin/plugin.json` |
| Cursor | `.cursor-plugin/plugin.json` |

各クライアントが同じ`skills/`を読み取るため、リリース手順の実体は一か所で管理します。

## 安全設計

- 状態確認は読み取り専用で実行する
- スクリーンショットは既存画像を上書きせず、撮影後にApple要件を検証する
- EAS Metadata用書き出しとApp Store Connectへの反映は別々に確認する
- ビルド、メタデータ反映、審査提出の前に対象と影響を提示する
- App Review提出には`VERSION/BUILD`形式の確認文字列を要求する
- 秘密鍵、APIトークン、JWTをログへ出さない
- 途中失敗時に自動的な再試行や巻き戻しを行わない

## 開発

```bash
npm run check
npm test
```

プラグインは外部パッケージへ依存しません。設定判定には固定fixture、App Store Connect操作にはローカルのモックAPIを使います。

## ライセンス

[MIT License](LICENSE)
