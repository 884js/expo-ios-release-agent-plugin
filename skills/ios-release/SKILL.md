---
name: ios-release
description: Expo / EAS製iOSアプリのリリース全体を進行する。「リリースしよう」「App Storeへ新しいバージョンを出したい」「TestFlightから審査提出まで進めて」など、複数段階にまたがるiOSリリースを依頼された時は使う。TestFlight、スクリーンショット、メタデータ、審査提出の一部だけの依頼では対応する個別スキルを使う。
compatibility: Node.js 18以上、EAS CLI、Expoプロジェクト、Apple Developer Programが必要。
---

# iOSリリース進行

TestFlightへのビルド提出、ストア情報更新、App Review提出を一連の作業として進める。各段階は独立して再実行できるため、完了済みの作業を繰り返さない。

## 0. Fixtureを識別する

プロジェクトルートに`.release-fixture.json`があり、`externalActionsAllowed`が`false`の場合は評価モードとして扱う。

設定確認、リリース計画、リリースノート下書きまでを行い、EASやApp Store Connectへの外部操作は実行しない。ユーザーが実行を求めても、実プロジェクトへ切り替えるよう案内する。

## セットアップ状態を確認する

プラグインルートの`./scripts/doctor.mjs`を解決し、プロジェクトルートで実行する。

```bash
node <plugin-root>/scripts/doctor.mjs \
  --capability all \
  --json
```

`NEEDS_SETUP`なら`setup`スキルへ切り替え、不足項目を提示する。`BLOCKED`ならリリースを開始しない。外部操作の直前には`--live`を付けて再確認する。

## 1. 現在地を確認する

プロジェクトルートで次を読み取る。

- `app.json`のバージョン、build番号、Bundle ID
- `eas.json`のbuild／submitプロファイル
- `store.config.json`のバージョンとリリースノート
- App Storeスクリーンショットの撮影設定と検証済み出力
- Gitの未コミット差分
- EASの直近iOSビルドと提出状態
- App Store Connectの対象バージョン、処理済みビルド、審査状態

App Store Connectの確認には`appstore-release`スキルのスクリプトを読み取り専用で使う。

スクリーンショットの撮影が必要な場合は、`appstore-screenshots`の`--check`も実行する。既存出力を検証済みとして扱う前に、対象ディレクトリへ`--validate`を実行する。

未コミット差分は勝手にコミットしない。リリース対象に含める必要がある場合は、変更内容を提示してユーザーへ判断を求める。

## 2. リリース計画を提示する

次を簡潔にまとめる。

- 対象バージョンとbuild番号
- 使用するEASプロファイル
- バージョン更新の有無
- リリースノート更新の有無
- 新規ビルドが必要か
- メタデータ反映が必要か
- スクリーンショットの撮影または差し替えが必要か
- App Review提出が可能か

外部状態を変える操作をまとめて提示し、開始前に同意を得る。ただし、App Review提出の直前にはバージョンとbuild番号を使って改めて確認する。

## 3. 必要な段階だけ実行する

次の順に進める。

1. `testflight`: 事前検証、バージョン調整、EAS Build、TestFlight提出
2. `appstore-screenshots`: 必要な場合だけ掲載画像を撮影・検証し、EAS Metadata用にローカル書き出し
3. `appstore-info`: リリースノートやスクリーンショットなどのApp Store掲載情報反映
4. `appstore-release`: 処理済みビルドの選択、App Review提出

新しいビルドを作成した場合は、EAS BuildとEAS Submitの完了を確認する。Apple側でビルドが処理中の場合は、適度な間隔で状態を確認する。ユーザーが一連の完了を求めている時は、App Reviewへ提出できる状態になるまで追跡する。

途中で失敗した場合は、成功済みの段階と失敗した段階を分けて報告する。自動的な巻き戻しや、同じ外部変更の無制限な再試行は行わない。

## 4. 完了を確認する

最終的に次を読み取り直す。

- EAS BuildとEAS Submitの状態
- App Storeバージョンへ紐付いたbuild番号
- App Reviewの提出状態
- 審査承認後の公開方式

App Store Connectのアプリページと、必要に応じてEASのビルド／提出URLを案内する。

## 境界

- TestFlightへの配信だけ: `testflight`
- スクリーンショットの撮影と検証だけ: `appstore-screenshots`
- App Store掲載情報の更新だけ: `appstore-info`
- 処理済みビルドの審査提出だけ: `appstore-release`
