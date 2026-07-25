# プロジェクト要件

## 必須ファイル

### app.json

次の値を利用します。

- `expo.owner`
- `expo.slug`
- `expo.version`
- `expo.ios.bundleIdentifier`
- `expo.ios.buildNumber`

`app.config.js`や`app.config.ts`だけで設定しているプロジェクトは、App Review提出時に`--version`と`--build-number`を明示してください。EAS保存済みAPIキーの自動利用には、現時点では`app.json`のプロジェクト情報が必要です。

### eas.json

ビルドと提出に利用する同名プロファイルを用意します。既定のプロファイル名は`testflight`です。

```json
{
  "build": {
    "testflight": {
      "distribution": "store"
    }
  },
  "submit": {
    "testflight": {
      "ios": {
        "ascAppId": "1234567890"
      }
    }
  }
}
```

別名を使う場合は実行時に指定します。

```bash
export EAS_RELEASE_PROFILE=production
```

## 任意ファイル

### store.config.json

EAS Metadataを使う場合に必要です。`eas.json`の`metadataPath`で別のパスを指定できます。

対象ロケールは`IOS_RELEASE_LOCALE`で変更できます。既定値は`ja`です。

### appstore-screenshots.json

App Store掲載画像を撮影する場合に必要です。端末区分、Simulator機種、ロケール、向き、Maestro Flowを設定します。EAS Metadataへ書き出す場合は、必要に応じて`store.config.json`のロケールも指定します。

撮影にはmacOS、Xcode Command Line Tools、起動可能なiOS Simulator、Maestro CLI 2.3.0以上、Simulator用アプリビルドが必要です。TestFlight用ビルドはSimulatorへインストールできません。

## App Store Connect認証

次の優先順位で利用します。

1. `ASC_TOKEN`
2. `ASC_ISSUER_ID`、`ASC_KEY_ID`、`ASC_PRIVATE_KEY_PATH`
3. EAS Submit用として保存済みのApp Store Connect APIキー

App Store ConnectのApp IDは、次の順で取得します。

1. `ASC_APP_ID`
2. `eas.json`の`submit.{profile}.ios.ascAppId`

秘密鍵はプラグインやアプリのリポジトリへ追加しないでください。

## Fixtureの扱い

プロジェクトルートに`.release-fixture.json`があり、`externalActionsAllowed`が`false`の場合は、設定確認と下書き作成だけを行います。

EAS Build、EAS Submit、EAS Metadata、App Store Connect APIなどの外部操作は実行しません。
