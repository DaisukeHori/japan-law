# 🚀 セットアップ手順

このドキュメントでは、japan-lawリポジトリのセットアップ方法を説明します。

## 1. ファイルのアップロード

### 方法A: GitHubのWebUIを使う場合

1. [リポジトリ](https://github.com/DaisukeHori/japan-law) を開く
2. 「Add file」→「Upload files」をクリック
3. ZIPを解凍したファイルをすべてドラッグ＆ドロップ
4. 「Commit changes」をクリック

### 方法B: Git CLIを使う場合

```bash
# リポジトリをクローン
git clone https://github.com/DaisukeHori/japan-law.git
cd japan-law

# ZIPを解凍したファイルをコピー
# （既存のREADME.md、LICENSE、.gitignoreは上書き）

# 変更をコミット
git add .
git commit -m "🎉 Initial project setup"
git push origin main
```

## 2. ラベルの作成

GitHub WebUIでラベルを作成します。

### 必須ラベル

#### 状態ラベル
| ラベル名 | 色 | 説明 |
|---------|-----|------|
| `状態/審議中` | `#0e8a16` (緑) | 審議中の法案 |
| `状態/成立` | `#1d76db` (青) | 成立した法案 |
| `状態/廃案` | `#d93f0b` (赤) | 廃案になった法案 |
| `状態/継続審議` | `#fbca04` (黄) | 継続審議 |
| `状態/撤回` | `#e4e669` (薄黄) | 撤回された法案 |

#### 種別ラベル
| ラベル名 | 色 | 説明 |
|---------|-----|------|
| `種別/閣法` | `#5319e7` (紫) | 内閣提出法案 |
| `種別/衆法` | `#fbca04` (黄) | 衆議院議員提出法案 |
| `種別/参法` | `#f9d0c4` (ピンク) | 参議院議員提出法案 |

#### 議院ラベル
| ラベル名 | 色 | 説明 |
|---------|-----|------|
| `議院/衆議院` | `#c5def5` (水色) | 衆議院 |
| `議院/参議院` | `#d4c5f9` (薄紫) | 参議院 |

#### 政党ラベル
| ラベル名 | 色 |
|---------|-----|
| `政党/自由民主党` | `#e74c3c` |
| `政党/立憲民主党` | `#3498db` |
| `政党/公明党` | `#f39c12` |
| `政党/日本維新の会` | `#27ae60` |
| `政党/国民民主党` | `#9b59b6` |
| `政党/日本共産党` | `#c0392b` |
| `政党/れいわ新選組` | `#e91e63` |
| `政党/無所属` | `#95a5a6` |

#### 分野ラベル
| ラベル名 | 色 |
|---------|-----|
| `分野/経済` | `#0052cc` |
| `分野/福祉` | `#e99695` |
| `分野/IT・デジタル` | `#006b75` |
| `分野/環境` | `#0e8a16` |
| `分野/外交・安全保障` | `#b60205` |
| `分野/教育` | `#1d76db` |
| `分野/医療` | `#d93f0b` |
| `分野/司法` | `#5319e7` |
| `分野/農林水産` | `#0e8a16` |
| `分野/国土交通` | `#fbca04` |
| `分野/その他` | `#ededed` |

### ラベル作成方法

1. リポジトリの「Issues」タブを開く
2. 「Labels」をクリック
3. 「New label」をクリック
4. ラベル名、説明、色を入力して作成

## 3. GitHub Pagesの有効化

1. リポジトリの「Settings」を開く
2. 左メニューの「Pages」をクリック
3. Source: 「Deploy from a branch」を選択
4. Branch: 「main」、フォルダ: 「/docs」を選択
5. 「Save」をクリック

数分後、`https://daisukehori.github.io/japan-law/` でアクセス可能になります。

## 4. 依存関係のインストール（ローカル開発時）

```bash
cd scripts
npm install
```

## 5. 動作確認

### GitHub Actionsの確認

1. リポジトリの「Actions」タブを開く
2. 「Update Laws」と「Update Legislator Statistics」のワークフローが表示されることを確認
3. 「Run workflow」で手動実行してテスト

### ローカルでスクリプトを実行

```bash
cd scripts

# 法令データ取得（時間がかかります）
npx ts-node fetch_all_laws.ts

# Lawtext変換
npx ts-node convert_to_lawtext.ts

# Markdown変換
npx ts-node convert_to_markdown.ts

# 統計計算（GITHUB_TOKENが必要）
GITHUB_TOKEN=your_token npx ts-node calculate_stats.ts
```

## 6. 法案の登録方法

1. リポジトリの「Issues」→「New Issue」をクリック
2. 「法案提案」テンプレートを選択
3. フォームに必要事項を入力
4. 作成後、適切なラベルを付与：
   - `提案者/○○` - 提出者名
   - `政党/○○` - 所属政党
   - `議院/衆議院` または `議院/参議院`
   - `分野/○○` - 法案の分野
   - `状態/審議中` - 初期状態

## 7. 議員マスタの更新

`data/index/legislators/legislators.json` を編集して議員を追加します：

```json
{
  "legislators": [
    {
      "id": "yamada_taro",
      "name": "山田太郎",
      "name_kana": "やまだたろう",
      "party": "自由民主党",
      "party_id": "ldp",
      "house": "参議院",
      "prefecture": "埼玉県",
      "is_active": true,
      "github_label": "提案者/山田太郎"
    }
  ]
}
```

**注意**: `id` はユニークで、英数字とアンダースコアのみ使用してください。

## 8. トラブルシューティング

### GitHub Actionsが失敗する

- `scripts/package-lock.json` が存在するか確認
- 初回は `cd scripts && npm install` を実行してから push

### GitHub Pagesが表示されない

- Settings → Pages で正しく設定されているか確認
- `docs/index.html` が存在するか確認
- 数分待ってから再度アクセス

### ラベルが表示されない

- ラベル名が完全に一致しているか確認（全角/半角、スペースに注意）

## 📞 サポート

問題があれば [Issues](https://github.com/DaisukeHori/japan-law/issues) で報告してください。
