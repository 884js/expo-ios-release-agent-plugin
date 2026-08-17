---
name: appstore-preflight
description: Expo / EAS製iOSアプリをApp Reviewへ提出する前に、設定不整合と手動確認事項を読み取り専用で診断する。「審査前チェック」「提出できる状態か確認」「申請チェックリスト」で使う。ビルド、メタデータ更新、審査提出は行わない。
---

# App Store提出前診断

判定はスクリプトへ任せ、未解決項目だけ報告する。ファイル、認証情報、外部状態を変更しない。

## 実行

このファイルと同じディレクトリの`scripts/appstore-preflight.mjs`を、プロジェクトルートで実行する。

```bash
node <skill-directory>/scripts/appstore-preflight.mjs
```

対象を変える場合だけ`--profile`、`--locale`、`--project-dir`を指定する。詳細は`--verbose`、機械可読出力は`--json`を使う。

`.release-fixture.json`で外部操作が禁止されている場合は、外部接続せず`BLOCKED`として終了する。

## 判断

- `BLOCKED`: 解消するまで提出しない
- `NEEDS_REVIEW`: 表示された`MANUAL`だけ確認する

実プロジェクトでは`appstore-release`の読み取り専用確認を使い、App Store上のversion、処理済みbuild、紐付け、審査状態を照合する。スクリーンショット設定がある場合だけ`appstore-screenshots`で既存出力を検証する。値を推測しない。

## 完了

version、build番号、全体状態、`BLOCKED`、`MANUAL`を簡潔に報告する。審査用認証情報の値は出力しない。

診断完了を提出同意として扱わない。提出依頼は`appstore-release`へ切り替え、versionとbuild番号への明示的な同意を改めて得る。
