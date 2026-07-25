# 撮影設定

`appstore-screenshots.json`はプロジェクトルートへ置く。

## 項目

| 項目 | 必須 | 内容 |
| --- | --- | --- |
| `configVersion` | 必須 | `1` |
| `outputDir` | 任意 | プロジェクト内の出力先。既定は`app-store-screenshots` |
| `targets` | 必須 | 端末区分、ロケール、Flowの組み合わせ |
| `targets[].id` | 必須 | 確認と実行に使う一意のID |
| `targets[].displayType` | 必須 | `IPHONE_69`または`IPAD_13` |
| `targets[].device` | 必須 | 起動するSimulatorの機種名 |
| `targets[].locale` | 必須 | `ja_JP`のようなSimulatorロケール |
| `targets[].metadataLocale` | 任意 | `ja`や`en-US`のような`store.config.json`の`apple.info`キー |
| `targets[].orientation` | 必須 | `portrait`または`landscape` |
| `targets[].flow` | 必須 | プロジェクト内のMaestro Flow |

## 例

```json
{
  "configVersion": 1,
  "outputDir": "app-store-screenshots",
  "targets": [
    {
      "id": "iphone-69-ja",
      "displayType": "IPHONE_69",
      "device": "iPhone 17 Pro Max",
      "locale": "ja_JP",
      "metadataLocale": "ja",
      "orientation": "portrait",
      "flow": ".maestro/app-store/ja.yml"
    }
  ]
}
```

## EAS Metadataへの書き出し

`metadataLocale`を省略した場合は、`locale`をハイフン形式へ変換した完全一致、言語が一致する一意の候補の順に`apple.info`から解決する。候補がない場合や複数ある場合は書き出さない。

表示タイプはEAS Metadataのキーへ次のように変換する。

| 撮影設定 | EAS Metadata |
| --- | --- |
| `IPHONE_69` | `APP_IPHONE_67` |
| `IPAD_13` | `APP_IPAD_PRO_3GEN_129` |

設定ファイルは既定でプロジェクトルートの`store.config.json`を使う。別のJSONを使う場合は`--metadata-config`でプロジェクト内のパスを指定する。

## Maestro Flow

Flowの`appId`には`${APP_ID}`を使う。撮影スクリプトが`app.json`のBundle IDを渡す。

スクリーンショット名は掲載順に合わせる。

```yaml
appId: ${APP_ID}
---
- setOrientation: PORTRAIT
- launchApp:
    clearState: true
- assertVisible: "最近の記録"
- takeScreenshot: 01-home
- tapOn: "新規作成"
- assertVisible: "記録を追加"
- takeScreenshot: 02-create
```

撮影する表示は固定する。時刻依存、乱数、実ユーザー情報、外部APIの変動データをそのまま使わない。既存のdeep link、launch argument、fixtureで再現できない場合だけ、アプリ側の撮影用状態を提案する。
