---
name: appstore-screenshots
description: Expo / EAS製iOSアプリをiOS Simulatorで操作し、App Store掲載用スクリーンショットをMaestroで再現可能に撮影・検証する。「App Store用のスクショを撮って」「掲載画像を作り直して」「端末サイズ別にスクリーンショットを用意して」など、ストア掲載画像の作成や更新では必ず使う。App Store Connectへのアップロードは行わない。
compatibility: macOS、Xcode Command Line Tools、Maestro CLI 2.3.0以上、iOS Simulator用のアプリビルドが必要。
---

# App Storeスクリーンショット

Maestro Flowで同じ画面状態を再現し、App Storeの端末区分ごとにスクリーンショットを撮影する。撮影後は枚数、寸法、向き、透過、ファイル順を検証する。

App Store Connectへのアップロードは行わない。検証済み画像のEAS Metadata用書き出しと`store.config.json`の更新は、ユーザーが明示的に希望した場合だけ行う。

## Fixtureを識別する

プロジェクトルートに`.release-fixture.json`があり、`externalActionsAllowed`が`false`の場合は、設定と撮影計画の確認だけを行う。

Simulatorの起動、アプリ操作、スクリーンショット撮影は行わない。

## 1. スクリプトを特定する

この`SKILL.md`と同じディレクトリにある`./scripts/appstore-screenshots.mjs`の絶対パスを解決する。インストール先を固定パスと決めつけない。

## 2. 撮影設定を確認する

プロジェクトルートの`appstore-screenshots.json`を読み取る。設定の追加や変更が必要な場合は、先に[設定リファレンス](references/config.md)を読む。

設定がない場合は、次を確認して撮影計画を提示する。

- 対象ロケール
- 撮影する画面と掲載順
- iPhoneの向き
- iPad対応の有無
- 画面状態を固定する方法
- 使用するMaestro Flow

iPhoneでは6.9インチ区分を基本にする。`expo.ios.supportsTablet`が`true`の場合は13インチiPad区分も対象にする。

各Flowには設定した向きと一致する`setOrientation`を含める。撮影時のSimulator状態に依存させない。

設定ファイルやMaestro Flowは、内容と影響を提示し、ユーザーの同意後にだけ追加・編集する。アプリ側に撮影専用データや導線が必要でも、先に既存のdeep link、launch argument、fixtureを利用できないか確認する。

## 3. 読み取り専用で診断する

プロジェクトルートで実行する。

```bash
node <skill-directory>/scripts/appstore-screenshots.mjs --check
```

次を確認する。

- macOS
- Xcode Command Line Toolsと`simctl`
- Maestro CLI 2.3.0以上
- `app.json`のBundle ID
- `appstore-screenshots.json`
- 対象ごとのMaestro Flow

Maestro CLI 2.3.0以上がなければセットアップ方法を案内して停止する。無断でインストールしない。

## 4. 撮影前にSimulatorを整える

設定された機種とロケールに一致するiOS Simulatorを起動し、Simulator用アプリがインストールされていることを確認する。

利用できるSimulatorがなければ、作成または起動する機種、OS、ロケールを提示して同意を得る。TestFlight用ビルドはSimulatorへインストールできないため、必要ならSimulator用EAS Buildまたはローカルビルドを別に用意する。

複数のSimulatorが起動している場合は、対象UDIDを明示する。

## 5. 撮影内容を最終確認する

次を簡潔に提示する。

- 対象ID
- 機種と端末区分
- ロケール
- Maestro Flow
- Bundle ID
- 出力先

アプリ操作とファイル作成を行うため、対象IDを使って明示的な同意を得る。

## 6. Maestroで撮影する

同意後に実行する。

```bash
node <skill-directory>/scripts/appstore-screenshots.mjs \
  --capture \
  --target <target-id> \
  --device <simulator-udid> \
  --confirm <target-id>
```

スクリプトはステータスバーを一時的に整え、対象SimulatorをMaestroへ明示してFlowを実行する。撮影結果は既存画像を上書きせず、実行時刻ごとの新しいディレクトリへ保存する。

撮影成功時は、出力ディレクトリ直下へ掲載用PNGだけを整理する。Maestroのレポートは検証後に削除し、Flow失敗時だけ原因調査用に残す。

Flowが失敗した場合は撮影を成功扱いにしない。画面文言の変更、待機不足、データ不足を切り分け、同じ操作を無制限に再試行しない。

## 7. 既存画像だけを検証する

撮影済みディレクトリは単独でも検証できる。

```bash
node <skill-directory>/scripts/appstore-screenshots.mjs \
  --validate \
  --target <target-id> \
  --output-dir <project-relative-path>
```

検証では次を満たす必要がある。

- 1〜10枚
- PNG
- 対象端末区分で許可された寸法
- 設定と同じ向き
- alpha channelや透過情報がない
- `01-`から始まる欠番のないファイル順

Appleの仕様がスクリプト内の寸法より新しい場合は撮影を続けず、公式のScreenshot specificationsに合わせてプラグインを更新する。

## 8. EAS Metadata用にローカル書き出しする

ユーザーが希望した場合は、検証済みの撮影ディレクトリ、対象ロケール、更新する`store.config.json`、表示タイプを提示し、対象IDを使って同意を得る。

同意後に実行する。

```bash
node <skill-directory>/scripts/appstore-screenshots.mjs \
  --export-eas-metadata \
  --target <target-id> \
  --output-dir <validated-project-relative-path> \
  --confirm <target-id>
```

画像は`store/apple/screenshot/<locale>/<eas-display-type>/<timestamp>/`へ世代保存し、`store.config.json`の該当ロケールと表示タイプだけを更新する。既存画像の上書きや削除は行わない。

`apple.info`に対応するロケールがない場合や候補が曖昧な場合は停止し、撮影設定の`metadataLocale`を明示する。設定ファイルを自動作成しない。

この操作は`eas metadata:push`を実行しない。App Store Connectへの反映は`appstore-info`スキルで影響範囲を再確認し、別途同意を得て行う。

## 9. 結果を報告する

次をまとめる。

- 対象機種、端末区分、ロケール
- 出力ディレクトリ
- 撮影枚数と寸法
- 検証結果
- EAS Metadata用書き出しの有無と設定ファイル
- 撮影できなかった画面
- App Store Connectへ反映する前に確認する事項

アップロードを依頼された場合は`appstore-info`スキルへ切り替える。生成とアップロードを一度の確認でまとめない。

## 境界

- Simulator用ビルドの作成: 必要に応じてEAS BuildまたはExpo CLI
- ローカル撮影、画像検証、EAS Metadata用書き出し: このスキル
- 背景、見出し、端末フレームの合成: 対象外
- App Store Connectへのアップロード: `appstore-info`
