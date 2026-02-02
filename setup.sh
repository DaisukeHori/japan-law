#!/bin/bash
# ============================================
# Japan Law Database - 初回データ取得スクリプト
# ============================================
#
# 使い方:
#   git clone https://github.com/DaisukeHori/japan-law.git
#   cd japan-law
#   ./setup.sh
#
# 所要時間: 約2〜3時間（8,000件の法令取得）
# ============================================

set -e

echo "🏛️ Japan Law Database - 初回セットアップ"
echo "=========================================="
echo ""

# Node.jsバージョン確認
if ! command -v node &> /dev/null; then
    echo "❌ Node.js がインストールされていません"
    echo "   https://nodejs.org/ からインストールしてください"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js v18以上が必要です（現在: $(node -v)）"
    exit 1
fi

echo "✅ Node.js $(node -v)"
echo ""

# scriptsディレクトリへ移動
cd scripts

# 依存関係インストール
echo "📦 依存関係をインストール中..."
npm install
echo ""

# 法令データ取得
echo "📥 法令データを取得中..."
echo "   ⚠️ 約8,000件の法令を取得します（2〜3時間かかります）"
echo "   ⚠️ 途中で中断しても、次回は続きから再開されます"
echo ""
npx ts-node fetch_all_laws.ts
echo ""

# Lawtext変換
echo "🔄 Lawtext形式に変換中..."
npx ts-node convert_to_lawtext.ts
echo ""

# Markdown変換
echo "📝 Markdown形式に変換中..."
npx ts-node convert_to_markdown.ts
echo ""

# 完了
cd ..
echo "=========================================="
echo "✅ セットアップ完了！"
echo ""
echo "📊 取得した法令数:"
find data/xml -name "*.xml" 2>/dev/null | wc -l | xargs echo "   XML:"
find data/lawtext -name "*.law.txt" 2>/dev/null | wc -l | xargs echo "   Lawtext:"
find data/markdown -name "*.md" 2>/dev/null | wc -l | xargs echo "   Markdown:"
echo ""
echo "📤 次のステップ: GitHubにプッシュ"
echo "   git add data/"
echo "   git commit -m '📚 Initial law data import'"
echo "   git push"
echo ""
