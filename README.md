# 🏛️ Japan Law Database / 日本法令データベース

[![Update Laws](https://github.com/DaisukeHori/japan-law/actions/workflows/update-laws.yml/badge.svg)](https://github.com/DaisukeHori/japan-law/actions/workflows/update-laws.yml)
[![License: CC0-1.0](https://img.shields.io/badge/License-CC0_1.0-lightgrey.svg)](http://creativecommons.org/publicdomain/zero/1.0/)

e-Gov法令検索APIから取得した日本の全法令データを、**相互参照リンク付き**で管理するGitHubリポジトリです。  
また、**法案提出議員の活動追跡・統計機能**も備えています。

## ✨ 特徴

### 📚 法令データ
- **全法令収録**: 憲法・法律・政令・省令など約8,000件
- **3形式で提供**: XML（正式）、Lawtext（可読）、Markdown（リンク付き）
- **相互参照リンク**: 「民法第709条」→クリックで該当条文へジャンプ
- **被参照（逆引き）**: ある法令を参照している全法令を一覧表示
- **Git管理**: 法令改正の履歴をdiffで追跡可能

### 👤 議員活動追跡
- **法案をIssueで管理**: 提出者・政党・状態をラベルで記録
- **自動統計**: 議員別・政党別の法案数、成功率を自動計算
- **ダッシュボード**: GitHub Pagesで議員活動を可視化
- **ランキング**: 法案提出数、成立率などのランキング

## 📁 ディレクトリ構造

```
japan-law/
├── data/
│   ├── xml/           # 法令標準XML（e-Gov互換）
│   ├── lawtext/       # Lawtext形式（人間可読）
│   ├── markdown/      # Markdown形式（リンク付き）
│   └── index/
│       ├── laws.json              # 法令一覧
│       ├── references.json        # 参照グラフ
│       ├── backlinks.json         # 被参照グラフ
│       └── legislators/           # 議員データ
│
├── scripts/           # データ取得・変換スクリプト
├── docs/              # GitHub Pages（ダッシュボード）
└── .github/
    ├── ISSUE_TEMPLATE/    # 法案登録テンプレート
    └── workflows/         # GitHub Actions
```

## 🚀 使い方

### 法令を検索する

1. `data/index/laws.json` で法令一覧を確認
2. `data/markdown/` 以下のMarkdownファイルを閲覧
3. GitHub Pages（準備中）で検索・閲覧

### 法案を登録する（管理者向け）

1. [Issues](../../issues) → [New Issue](../../issues/new/choose)
2. 「法案提案」テンプレートを選択
3. 必要事項を入力して作成
4. ラベルで提出者・政党・状態を付与

### ローカルで開発する

```bash
# クローン
git clone https://github.com/DaisukeHori/japan-law.git
cd japan-law

# 依存関係インストール
cd scripts
npm install

# 法令データ取得（初回は時間がかかります）
npx ts-node fetch_all_laws.ts

# Lawtext変換
npx ts-node convert_to_lawtext.ts

# Markdown変換（リンク付き）
npx ts-node convert_to_markdown.ts
```

## 📊 データ形式

### 法令一覧 (`laws.json`)

```json
{
  "laws": [
    {
      "id": "405AC0000000088",
      "lawNum": "平成五年法律第八十八号",
      "title": "行政手続法",
      "category": "acts",
      "files": {
        "xml": "data/xml/acts/405AC0000000088.xml",
        "lawtext": "data/lawtext/acts/405AC0000000088.law.txt",
        "markdown": "data/markdown/acts/405AC0000000088.md"
      }
    }
  ]
}
```

### 議員統計 (`activity_stats.json`)

```json
{
  "by_legislator": {
    "yamada_taro": {
      "name": "山田太郎",
      "party": "自由民主党",
      "total_bills": 15,
      "passed_bills": 8,
      "success_rate": 0.533
    }
  }
}
```

## 🏷️ ラベル体系

| カテゴリ | 例 | 用途 |
|---------|-----|------|
| 提案者 | `提案者/山田太郎` | 法案提出者 |
| 政党 | `政党/自由民主党` | 所属政党 |
| 議院 | `議院/参議院` | 衆議院/参議院 |
| 種別 | `種別/衆法` | 閣法/衆法/参法 |
| 状態 | `状態/成立` | 審議中/成立/廃案など |
| 分野 | `分野/IT・デジタル` | 法案の分野 |

## 🔗 関連リンク

- [e-Gov法令検索](https://laws.e-gov.go.jp/)
- [e-Gov法令API](https://laws.e-gov.go.jp/api/1/)
- [Lawtext](https://github.com/yamachig/Lawtext) - 法令プレーンテキスト形式
- [衆議院 議案情報](https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm)
- [参議院 議案情報](https://www.sangiin.go.jp/japanese/joho1/kousei/gian/gian.htm)

## 📜 ライセンス

- **法令データ**: パブリックドメイン（著作権法第13条により著作権対象外）
- **スクリプト・ドキュメント**: [CC0 1.0 Universal](LICENSE)

## 🤝 コントリビューション

Issue・Pull Requestを歓迎します！

- バグ報告
- 機能提案
- ドキュメント改善
- 法令データの誤り報告

## 📞 お問い合わせ

質問・要望は [Issues](../../issues) からお願いします。
