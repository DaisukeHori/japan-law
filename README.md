# 🏛️ Japan Law Database / 日本法令データベース

[![Update Laws](https://github.com/DaisukeHori/japan-law/actions/workflows/update-laws.yml/badge.svg)](https://github.com/DaisukeHori/japan-law/actions/workflows/update-laws.yml)
[![Track Diet](https://github.com/DaisukeHori/japan-law/actions/workflows/track-diet.yml/badge.svg)](https://github.com/DaisukeHori/japan-law/actions/workflows/track-diet.yml)
[![License: CC0-1.0](https://img.shields.io/badge/License-CC0_1.0-lightgrey.svg)](http://creativecommons.org/publicdomain/zero/1.0/)

e-Gov法令検索APIから取得した日本の全法令データを、**相互参照リンク付き**で管理するGitHubリポジトリです。
また、**国会法案を自動追跡**し、GitHubのIssue/PRワークフローで法律の立法過程を可視化します。

## 💻 Laws as Code

このプロジェクトは「**法律をソースコードとして管理する**」というコンセプトで運営されています。

| GitHub | 国会・法令 | 説明 |
|--------|----------|------|
| **Issue** | 法案（審議中） | 提出された法案を追跡 |
| **PR** | 法案成立 | 可決された法案をマージ |
| **Merge** | 法令化 | 法令ファイルがリポジトリに追加 |
| **Commit** | 法令改正 | 法令の条文変更を記録 |
| **Diff** | 新旧対照 | 改正前後の差分を表示 |
| **Labels** | メタデータ | 議員、政党、状態などを付与 |

```
法案提出 → Issue作成 → 審議（コメント/議論追加） → 可決 → PR作成 → マージ → 法令化
```

## ✨ 特徴

### 📚 法令データ
- **全法令収録**: 憲法・法律・政令・省令など約8,000件
- **3形式で提供**: XML（正式）、Lawtext（可読）、Markdown（リンク付き）
- **相互参照リンク**: 「民法第709条」→クリックで該当条文へジャンプ
- **被参照（逆引き）**: ある法令を参照している全法令を一覧表示
- **Git管理**: 法令改正の履歴をdiffで追跡可能

### 🏛️ 国会トラッキング
- **自動Issue作成**: 国会会議録API + SMRIデータから法案を自動取得
- **議論の自動追加**: 法案に関する国会発言をIssueに記録
- **成立PR自動作成**: 法案成立時に自動でPRを作成
- **議員追跡**: 提案者別・会派別にラベルで追跡可能
- **毎日自動更新**: GitHub Actionsで国会データを定期同期

### 👤 議員活動追跡
- **法案をIssueで管理**: 提出者・政党・状態をラベルで記録
- **自動統計**: 議員別・政党別の法案数、成功率を自動計算
- **ダッシュボード**: GitHub Pagesで議員活動を可視化
- **ランキング**: 法案提出数、成立率などのランキング

## 🔄 自動ワークフロー

### 1. 国会追跡 (Track Diet)
毎日自動で実行されます。

```
国会会議録API → 議員データ取得（衆議院446名、参議院246名）
      ↓
SMRI API → 法案データ取得（16,000件以上）
      ↓
GitHub Issues 作成/更新（審議状態を同期）
      ↓
成立法案 → PR自動作成（法令ファイル追加）
```

### 2. 法令更新 (Update Laws)
毎週自動で実行されます。

```
e-Gov API → 法令XML取得
      ↓
Lawtext変換 → 人間可読形式
      ↓
Markdown変換 → 相互参照リンク付与
      ↓
参照分析 → backlinks.json生成
```

## 📁 ディレクトリ構造

```
japan-law/
├── data/
│   ├── xml/           # 法令標準XML（e-Gov互換）
│   ├── lawtext/       # Lawtext形式（人間可読）
│   ├── markdown/      # Markdown形式（リンク付き）
│   └── index/
│       ├── laws.json              # 法令一覧（8,000件）
│       ├── references.json        # 参照グラフ（112,000件）
│       ├── backlinks.json         # 被参照グラフ
│       └── legislators/           # 議員・法案データ
│           ├── legislators.json       # 議員一覧
│           ├── smri_bills.json        # 法案一覧
│           ├── legislator_bills.json  # 議員別法案
│           ├── created_issues.json    # Issue追跡
│           └── created_prs.json       # PR追跡
│
├── scripts/           # データ取得・変換スクリプト
├── docs/              # GitHub Pages（ダッシュボード）
└── .github/
    ├── ISSUE_TEMPLATE/    # 法案登録テンプレート
    └── workflows/
        ├── update-laws.yml    # 週次法令更新
        └── track-diet.yml     # 毎日国会追跡
```

## 🏷️ ラベル体系

### 法案状態
| ラベル | 色 | 説明 |
|--------|-----|------|
| `法案` | 青 | 法律案 |
| `審議中` | 水色 | 審議中の法案 |
| `成立` | 緑 | 成立した法案 |
| `廃案` | 赤 | 廃案となった法案 |
| `継続審議` | 黄 | 継続審議中 |

### 法案種別
| ラベル | 説明 |
|--------|------|
| `閣法` | 内閣提出法案 |
| `衆法` | 衆議院議員提出 |
| `参法` | 参議院議員提出 |

### 会派
| ラベル | 説明 |
|--------|------|
| `会派/自民` | 自由民主党 |
| `会派/立憲` | 立憲民主党 |
| `会派/公明` | 公明党 |
| `会派/維新` | 日本維新の会 |
| `会派/国民` | 国民民主党 |
| `会派/共産` | 日本共産党 |
| `会派/れいわ` | れいわ新選組 |
| `会派/社民` | 社会民主党 |

### 議員追跡
| パターン | 例 |
|----------|-----|
| `提案者/{議員名}` | `提案者/山田太郎` |
| `第{N}回国会` | `第215回国会` |

## 🚀 使い方

### 法令を検索する

- **GitHub Pages**: [ダッシュボード](https://daisukehori.github.io/japan-law/) で検索・閲覧
- **法令ファイル**: `data/markdown/acts/` 以下のMarkdownを閲覧
- **グラフ可視化**: 法令間の参照関係をインタラクティブに表示

### 国会を追跡する

- **[Issues](../../issues?q=label%3A法案)**: 審議中の法案一覧
- **[成立法案](../../issues?q=label%3A成立)**: 成立済みの法案
- **[PR](../../pulls)**: マージ待ちの法令追加

### ローカルで開発する

```bash
# クローン
git clone https://github.com/DaisukeHori/japan-law.git
cd japan-law/scripts
npm install

# 国会データ更新
npm run update:legislators

# Issue作成（要GITHUB_TOKEN）
export GITHUB_TOKEN=your_token
npm run create:issues

# PR作成（成立法案）
npm run create:prs
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
      "category": "acts"
    }
  ]
}
```

### 議員別法案 (`legislator_bills.json`)

```json
{
  "by_legislator": {
    "山田太郎": {
      "name": "山田太郎",
      "party": "自由民主党",
      "total_bills": 15,
      "passed_bills": 8,
      "success_rate": 0.53,
      "bills": [
        {
          "id": "bill_123",
          "name": "〇〇法案",
          "session": 215,
          "status": "成立"
        }
      ]
    }
  }
}
```

## 📡 データソース

| ソース | 用途 | 更新頻度 |
|--------|------|---------|
| [e-Gov法令API](https://laws.e-gov.go.jp/api/1/) | 法令XML | 週次 |
| [国会会議録API](https://kokkai.ndl.go.jp/) | 議員・発言データ | 毎日 |
| [SmartNews MRI](https://github.com/smartnews-smri) | 法案データ | 毎日 |
| [Wikidata](https://www.wikidata.org/) | 議員メタデータ | フォールバック |

## 🔗 関連リンク

- [e-Gov法令検索](https://laws.e-gov.go.jp/)
- [国会会議録検索システム](https://kokkai.ndl.go.jp/)
- [Lawtext](https://github.com/yamachig/Lawtext) - 法令プレーンテキスト形式
- [SmartNews MRI](https://github.com/smartnews-smri) - 国会データ
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
