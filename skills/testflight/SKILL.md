---
name: testflight
description: Expo / EAS製iOSアプリをEAS Buildでビルドし、TestFlightへ提出する。「TestFlightに出して」「TF配信」「iOSのベータビルドを作って」「EASでiOSビルド」などの依頼時に使う。App Review提出までは行わず、App Store掲載情報だけの更新にはappstore-infoを使う。
compatibility: EAS CLIと、build／submitプロファイルを持つExpoプロジェクトが必要。
---

# TestFlight配信

## 0. Fixtureを識別する

プロジェクトルートに`.release-fixture.json`があり、`externalActionsAllowed`が`false`の場合は、設定確認、検証コマンド、バージョン変更案、リリースノート下書きまでを行う。

EAS BuildとEAS Submitは実行しない。実行を求められた場合は実プロジェクトへ切り替えるよう案内する。

## セットアップ状態を確認する

プラグインルートの`./scripts/doctor.mjs`を解決し、プロジェクトルートで実行する。

```bash
node <plugin-root>/scripts/doctor.mjs \
  --capability testflight \
  --json
```

`NEEDS_SETUP`なら`setup`スキルで不足項目を案内する。`BLOCKED`なら解消するまでビルドを始めない。EAS Buildの直前に`--live`を付けてEASログインも確認する。

## 1. プロジェクトを確認する

リポジトリルートで次を確認する。

- `app.json`の`expo.version`と`expo.ios.buildNumber`
- `eas.json`のbuild／submitプロファイル
- `store.config.json`がある場合はApple側のバージョン
- `package.json`に定義された検証コマンド
- Gitの未コミット差分

使用プロファイルは、ユーザー指定、`EAS_RELEASE_PROFILE`、`testflight`の順で決定する。対象プロファイルが存在しなければ停止する。

## 2. 事前検証を行う

`package.json`に存在する検証コマンドを使う。通常は`typecheck`、`lint`、テストの順に実行するが、プロジェクトに存在しないコマンドを作らない。

失敗した場合はビルドを始めず、エラーと影響を報告する。

## 3. バージョンを決める

現在のバージョンを提示し、次のどれにするか確認する。

- 現在のまま
- パッチ
- マイナー
- メジャー
- バージョンを直接指定

バージョンを変更する場合は`app.json`を更新する。`store.config.json`にバージョンがある場合は同じ値へ揃える。build番号がEASのリモートバージョン管理や`autoIncrement`で決まる場合は、ローカル値を推測で変更しない。

## 4. リリースノートを準備する

バージョンを変更した場合、またはユーザーが希望した場合にリリースノートの下書きを作る。

前回のバージョン変更以降のコミットと差分を読み、ユーザーに見える変更だけを次のカテゴリへ整理する。

```text
新機能
・新しく利用できる機能

改善
・既存機能の使いやすさの改善

バグ修正
・利用時に発生していた問題の修正
```

- 該当しないカテゴリは省略する
- 内部リファクタ、CI、依存関係更新、スキル追加は含めない
- 1項目は短く、体言止めまたは動詞止めで揃える
- ロケールはユーザー指定、`IOS_RELEASE_LOCALE`、`ja`の順で決める

下書きを提示し、採用、編集、変更しない、のいずれかを確認する。採用された場合だけ`store.config.json`へ反映する。

## 5. 実行内容を確認する

次を提示する。

- バージョン
- buildプロファイル
- submitプロファイル
- TestFlightへ自動提出するか
- 実行する検証結果

EAS上に新しいビルドと提出を作るため、実行前に明示的な同意を得る。

## 6. ビルドする

自動提出する場合:

```bash
eas build --profile <profile> --platform ios --auto-submit --non-interactive
```

ビルドだけの場合:

```bash
eas build --profile <profile> --platform ios --non-interactive
```

長時間実行になるため、利用中のエージェント環境に合ったバックグラウンド実行や継続監視を使う。ビルドURLとbuild IDを控える。

自動提出しない場合は、ビルド完了後に次を使える。

```bash
eas submit --profile <profile> --platform ios --latest --non-interactive
```

## 7. 結果を確認する

次を報告する。

- バージョンと確定したbuild番号
- EAS Buildの状態とURL
- EAS Submitの状態とURL
- TestFlightで処理中か利用可能か

TestFlightへのアップロードはApp Review提出ではない。続けて公開申請する場合は`appstore-release`を使う。

## 制約

- すべてのEASコマンドを非対話モードで実行する
- プロファイル名を固定値と決めつけず、`eas.json`の存在を確認する
- 認証情報や署名情報をログへ出さない
- ユーザーの同意なくバージョン変更やビルドを開始しない
