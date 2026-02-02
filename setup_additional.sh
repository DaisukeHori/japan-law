#!/bin/bash
# ============================================
# Japan Law Database - 追加処理スクリプト
# ============================================
#
# 処理内容：
# 1. 略称定義を抽出（動的）
# 2. 相互参照解析（マルチプロセス）
# 3. グラフ構築（無限ホップ）
# 4. Markdown再生成
# 5. 議員・法案データ取得
#
# 使い方:
#   cd japan-law
#   ./setup_additional.sh
#
# ============================================

set -e

echo "🏛️ Japan Law Database - 追加処理（完全版）"
echo "=========================================="
echo "🖥️  CPUコア数: $(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 'unknown')"
echo ""

cd scripts

# 1. 略称定義を抽出
echo "📚 略称定義を抽出中..."
npx ts-node extract_abbreviations.ts
echo ""

# 2. 相互参照解析（マルチプロセス）
echo "🔗 相互参照を解析中（マルチプロセス）..."
npx ts-node analyze_references_multi.ts
echo ""

# 3. グラフ構築（マルチプロセス・無限ホップ）
echo "📊 法令参照グラフを構築中（マルチプロセス・無限ホップ）..."
npx ts-node build_graph_multi.ts
echo ""

# 4. Markdown再生成
echo "📝 Markdownを再生成中..."
npx ts-node convert_to_markdown_v2.ts
echo ""

# 5. スマートニュースMRIデータ取得
echo "📊 スマートニュースMRIデータを取得中..."
npx ts-node import_smri_data.ts
echo ""

cd ..

echo "=========================================="
echo "✅ 追加処理完了！"
echo ""
echo "📁 生成されたファイル:"
echo "   data/index/abbreviations.json - 略称定義"
echo "   data/index/references.json - 参照一覧"
echo "   data/index/backlinks.json - 被参照一覧"
echo "   data/index/graph/nodes.json - グラフノード"
echo "   data/index/graph/edges.json - グラフエッジ"
echo "   data/index/graph/reachability.json - 到達可能性"
echo "   data/index/legislators/legislators.json - 議員マスタ"
echo "   data/index/legislators/smri_bills.json - 法案データ"
echo ""
echo "📤 次のステップ: GitHubにプッシュ"
echo "   git add ."
echo "   git commit -m '🔗 Add complete reference graph with dynamic abbreviations'"
echo "   git push"
echo ""
