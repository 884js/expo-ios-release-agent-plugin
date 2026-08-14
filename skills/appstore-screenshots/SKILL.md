---
name: appstore-screenshots
description: Expo / EAS製iOSアプリの魅力が伝わる掲載コンセプトと画面構成を設計し、ユーザーの承認後にiOS SimulatorをMaestroで操作してApp Store掲載用スクリーンショットを再現可能に撮影・検証する。「App Store用のスクショを撮って」「掲載画像を作り直して」「魅力が伝わる画像を用意して」「端末サイズ別にスクリーンショットを用意して」など、ストア掲載画像の企画、撮影、更新では必ず使う。App Store Connectへのアップロードは行わない。
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

## 2. 掲載コンセプトを設計し、承認を得る

スクリーンショットは機能の網羅表ではなく、アプリを選ぶ理由を順番に伝える掲載ストーリーとして設計する。ユーザーから撮影を依頼されても、まだ提示していない撮影内容への同意とは扱わない。

設定ファイルやFlowを変更する前に、次を読み取り専用で確認する。

- アプリの中心的な体験と特徴的な画面
- 現在のストア説明、プロモーション文、リリースノート
- 既存スクリーンショットの内容と掲載順
- 今回のリリースで新しく伝える価値

確認結果から、次の撮影コンセプトを簡潔に提示する。

- 想定する利用者
- 最も伝えたい価値を一文で表したコアメッセージ
- 今回の掲載目的
- 最初の3枚までで伝えるストーリー
- 各画像の掲載順、画面状態、伝える価値、採用理由
- 既存画像を残す・撮り直す・外すの判断
- 画面状態を作るデータと、実データまたは架空データの区別
- 最終的な枚数、ロケール、向き、対象端末区分

各画像は一つの価値に絞る。1枚目でアプリの中心的な価値が分かり、最初の3枚だけでも利用体験がつながる構成を優先する。空の初期状態や設定画面は、それ自体が伝えたい価値である場合だけ採用する。特徴的な利用体験や今回の新機能を、単なる機能確認より優先する。

撮影用データには、実在の個人情報やユーザーが会話で入力した文章を流用しない。アプリの雰囲気に合う架空データを用意し、可能な限りSimulator内だけで完結させる。

背景、見出し、端末フレームを後から合成する場合は、合成後の役割を踏まえて必要な素材を整理する。このスキルでは合成せず、加工しやすい実画面を撮影する。

コンセプトと撮影構成への明示的な同意を得るまで、次の操作を行わない。

- `appstore-screenshots.json`やMaestro Flowの追加・編集
- Simulatorの起動や状態変更
- アプリ操作と撮影
- 撮影専用データの作成

承認後に掲載順、画面状態、データ、枚数のいずれかを変更する場合は、変更後の構成を提示して再度同意を得る。

## 3. 撮影設定を確認する

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

承認済みのコンセプトに合わせて、設定ファイルやMaestro Flowの変更内容と影響を提示する。アプリ側に撮影専用データや導線が必要でも、先に既存のdeep link、launch argument、fixtureを利用できないか確認する。

## 4. 読み取り専用で診断する

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

## 5. 撮影前にSimulatorを整える

設定された機種とロケールに一致するiOS Simulatorを起動し、Simulator用アプリがインストールされていることを確認する。

利用できるSimulatorがなければ、作成または起動する機種、OS、ロケールを提示して同意を得る。TestFlight用ビルドはSimulatorへインストールできないため、必要ならSimulator用EAS Buildまたはローカルビルドを別に用意する。

複数のSimulatorが起動している場合は、対象UDIDを明示する。

## 6. 撮影内容を最終確認する

次を簡潔に提示する。

- 対象ID
- 機種と端末区分
- ロケール
- Maestro Flow
- Bundle ID
- 出力先
- 撮影するファイル名、掲載順、画面状態
- 承認済みコンセプトからの変更有無

アプリ操作とファイル作成を行うため、対象IDを使って明示的な同意を得る。

## 7. Maestroで撮影する

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

## 8. 既存画像だけを検証する

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

## 9. EAS Metadata用にローカル書き出しする

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

## 10. 結果を報告する

次をまとめる。

- 対象機種、端末区分、ロケール
- 出力ディレクトリ
- 撮影枚数と寸法
- 検証結果
- EAS Metadata用書き出しの有無と設定ファイル
- 撮影できなかった画面
- 承認済みコンセプトと実際の撮影内容の差異
- App Store Connectへ反映する前に確認する事項

アップロードを依頼された場合は`appstore-info`スキルへ切り替える。生成とアップロードを一度の確認でまとめない。

## 境界

- Simulator用ビルドの作成: 必要に応じてEAS BuildまたはExpo CLI
- ローカル撮影、画像検証、EAS Metadata用書き出し: このスキル
- 背景、見出し、端末フレームの合成: 対象外
- App Store Connectへのアップロード: `appstore-info`
