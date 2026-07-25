---
name: appstore-info
description: Expo / EAS製iOSアプリのApp Store掲載情報を確認・更新する。「リリースノートを反映して」「App Storeの情報を更新」「説明文やキーワードを更新」「ストアページを変更」などの依頼時に使う。内部ではstore.config.jsonとEAS Metadataを利用するが、新規ビルドやApp Review提出は行わない。
compatibility: EAS CLIとstore.config.jsonを利用するExpoプロジェクトが必要。EAS Metadataはベータ機能。
---

# App Store情報更新

## 0. Fixtureを識別する

プロジェクトルートに`.release-fixture.json`があり、`externalActionsAllowed`が`false`の場合は、設定内容と変更案の確認だけを行う。

設定ファイルを評価目的で編集する場合も、EAS Metadataは実行しない。

## セットアップ状態を確認する

プラグインルートの`./scripts/doctor.mjs`を解決し、プロジェクトルートで実行する。

```bash
node <plugin-root>/scripts/doctor.mjs \
  --capability appstore-info \
  --json
```

`NEEDS_SETUP`なら`setup`スキルで不足項目を案内する。`BLOCKED`なら設定矛盾を解消するまで止める。EAS Metadataを実行する直前に`--live`を付けてEASログインも確認する。

## 1. 設定ファイルを特定する

`eas.json`の対象buildプロファイルに`metadataPath`があればそのファイルを使い、なければプロジェクトルートの`store.config.json`を使う。

使用プロファイルは、ユーザー指定、`EAS_RELEASE_PROFILE`、`testflight`の順で決定する。

ファイルが存在しなければ、勝手に新規作成せずユーザーへ必要な設定を案内する。

## 2. 影響範囲を確認する

設定ファイルを読み、次を提示する。

- Apple側の対象バージョン
- 更新対象のロケール
- リリースノート
- 説明文、プロモーションテキスト、キーワードなど変更される項目
- 審査連絡先やスクリーンショットなど、意図せず更新される可能性がある項目

`app.json`の`expo.version`とApple側のバージョンが異なる場合は停止し、どちらを正とするか確認する。

対象ロケールは、ユーザー指定、`IOS_RELEASE_LOCALE`、`ja`の順で決定する。

## 3. リリースノートを更新する

ユーザーが希望した場合だけ、前回のバージョン変更以降のコミットと差分から下書きを作る。

```text
新機能
・新しく利用できる機能

改善
・既存機能の使いやすさの改善

バグ修正
・利用時に発生していた問題の修正
```

- 該当しないカテゴリは省略する
- ユーザーに見えない内部変更は含めない
- 内容を提示し、合意後にだけ設定ファイルを編集する

## 4. 反映前に確認する

変更されるバージョン、ロケール、項目を提示し、App Store Connectへ反映してよいか明示的な同意を得る。

## 5. EAS Metadataを実行する

```bash
eas metadata:push --profile <profile> --non-interactive
```

完了まで待ち、成功した項目と失敗した項目を分けて確認する。部分的に成功した場合は、設定を直して失敗項目だけ再実行できるよう状態を報告する。無断で再試行しない。

## 6. 結果を報告する

App Store ConnectのApp IDは`ASC_APP_ID`、または`eas.json`の`submit.{profile}.ios.ascAppId`から取得する。

取得できる場合:

```text
https://appstoreconnect.apple.com/apps/{appId}/appstore
```

取得できない場合は固定URLを作らず、App Store ConnectのApps画面から確認するよう案内する。

## 制約

- EAS Metadataはベータ機能として扱い、失敗時に全項目が未反映だと決めつけない
- ビルド作成やApp Review提出を行わない
- 認証情報をログへ出さない
- ユーザーの同意なく設定ファイルを編集・pushしない
