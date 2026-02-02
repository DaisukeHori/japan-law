/**
 * analyze_worker.ts
 * 参照解析ワーカープロセス（ハイブリッド高速版）
 * 
 * 検出方式：
 * 1. 既知の法令名 → 高速な文字列検索
 * 2. 未知の法令名 → 最適化した正規表現
 * 
 * 検出パターン：
 * - 「○○法（年号○年法律第○号）」
 * - 「○○法第○条」
 * - 法令名そのもの（既知のもののみ）
 */

import * as fs from "fs";
import * as path from "path";

interface LawIndex {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

interface Reference {
  from_law_id: string;
  from_law_title: string;
  to_law_id: string | null;
  to_law_title: string;
  to_law_num: string | null;
  article: string | null;
}

process.on("message", (data: {
  xmlFiles: string[];
  lawIndex: LawIndex[];
  abbreviations: { [key: string]: LawIndex };
  workerId: number;
  totalWorkers: number;
}) => {
  const { xmlFiles, lawIndex, abbreviations, workerId } = data;

  // マップ構築
  const titleToLaw = new Map<string, LawIndex>();
  const lawIdMap = new Map<string, LawIndex>();

  for (const law of lawIndex) {
    titleToLaw.set(law.title, law);
    lawIdMap.set(law.id, law);
  }

  // 略称マップ
  const abbrevMap = new Map<string, LawIndex>();
  for (const [key, value] of Object.entries(abbreviations)) {
    abbrevMap.set(key, value as LawIndex);
  }

  // 既知の法令名リスト（長い順にソート）
  const knownLawNames: { name: string; law: LawIndex }[] = [];
  for (const law of lawIndex) {
    knownLawNames.push({ name: law.title, law });
  }
  for (const [abbrev, law] of abbrevMap) {
    knownLawNames.push({ name: abbrev, law });
  }
  knownLawNames.sort((a, b) => b.name.length - a.name.length);

  // 最適化した正規表現（未知の法令用）
  // 長さ制限でバックトラッキングを防止
  const unknownLawWithNumPattern = /([一-龠ぁ-んァ-ヶａ-ｚＡ-Ｚa-zA-Z・]{2,50}?(?:法|令|規則|条例))（((?:明治|大正|昭和|平成|令和)[^）]{3,50}?号)）/g;
  const unknownLawWithArticlePattern = /([一-龠ぁ-んァ-ヶａ-ｚＡ-Ｚa-zA-Z・]{2,50}?(?:法|令|規則))第([一二三四五六七八九十百千〇０-９0-9]+)条/g;

  // 参照抽出
  const allReferences: Reference[] = [];
  let processedCount = 0;

  for (const xmlPath of xmlFiles) {
    const lawId = path.basename(xmlPath, ".xml");
    const fromLaw = lawIdMap.get(lawId);

    if (!fromLaw) continue;

    try {
      const xmlContent = fs.readFileSync(xmlPath, "utf-8");
      const refs = extractReferences(
        xmlContent,
        fromLaw,
        knownLawNames,
        titleToLaw,
        abbrevMap,
        unknownLawWithNumPattern,
        unknownLawWithArticlePattern
      );
      allReferences.push(...refs);
    } catch (e) {
      // エラー無視
    }

    processedCount++;
    if (processedCount % 100 === 0) {
      process.send!({ type: "progress", workerId, processed: processedCount, total: xmlFiles.length });
    }
  }

  process.send!({ type: "result", references: allReferences });
  process.exit(0);
});

function extractReferences(
  xmlContent: string,
  fromLaw: LawIndex,
  knownLawNames: { name: string; law: LawIndex }[],
  titleToLaw: Map<string, LawIndex>,
  abbrevMap: Map<string, LawIndex>,
  unknownLawWithNumPattern: RegExp,
  unknownLawWithArticlePattern: RegExp
): Reference[] {
  const references: Reference[] = [];
  const seen = new Set<string>();

  // ========================================
  // フェーズ1: 既知の法令名を高速検索
  // ========================================
  for (const { name, law } of knownLawNames) {
    if (law.id === fromLaw.id) continue;
    if (seen.has(law.id)) continue;
    if (name.length < 3) continue;

    // 文字列検索（O(n)）
    const pos = xmlContent.indexOf(name);
    if (pos === -1) continue;

    // 参照として記録
    seen.add(law.id);
    
    // 条文番号があるか確認
    let article: string | null = null;
    const afterText = xmlContent.substring(pos + name.length, pos + name.length + 20);
    const articleMatch = afterText.match(/^第([一二三四五六七八九十百千〇０-９0-9]+)条/);
    if (articleMatch) {
      article = `第${articleMatch[1]}条`;
    }

    references.push({
      from_law_id: fromLaw.id,
      from_law_title: fromLaw.title,
      to_law_id: law.id,
      to_law_title: name,
      to_law_num: law.lawNum,
      article,
    });
  }

  // ========================================
  // フェーズ2: 未知の法令を正規表現で検索
  // （既知の法令で見つからなかったもの）
  // ========================================
  
  // パターン1: 「○○法（年号○年法律第○号）」
  unknownLawWithNumPattern.lastIndex = 0;
  let match;
  while ((match = unknownLawWithNumPattern.exec(xmlContent)) !== null) {
    const lawName = match[1];
    const lawNum = match[2];
    
    // 既知の法令か確認
    const knownLaw = titleToLaw.get(lawName) || abbrevMap.get(lawName);
    
    if (knownLaw) {
      // 既知だが見逃していた場合
      if (!seen.has(knownLaw.id) && knownLaw.id !== fromLaw.id) {
        seen.add(knownLaw.id);
        references.push({
          from_law_id: fromLaw.id,
          from_law_title: fromLaw.title,
          to_law_id: knownLaw.id,
          to_law_title: lawName,
          to_law_num: knownLaw.lawNum,
          article: null,
        });
      }
    } else {
      // 未知の法令
      const key = `unknown:${lawName}`;
      if (!seen.has(key)) {
        seen.add(key);
        references.push({
          from_law_id: fromLaw.id,
          from_law_title: fromLaw.title,
          to_law_id: null,
          to_law_title: lawName,
          to_law_num: lawNum,
          article: null,
        });
      }
    }
  }

  // パターン2: 「○○法第○条」（未知の法令）
  unknownLawWithArticlePattern.lastIndex = 0;
  while ((match = unknownLawWithArticlePattern.exec(xmlContent)) !== null) {
    const lawName = match[1];
    const articleNum = match[2];
    
    // 自分自身は除外
    if (lawName === fromLaw.title) continue;
    
    // 既知の法令か確認
    const knownLaw = titleToLaw.get(lawName) || abbrevMap.get(lawName);
    
    if (knownLaw) {
      if (!seen.has(knownLaw.id) && knownLaw.id !== fromLaw.id) {
        seen.add(knownLaw.id);
        references.push({
          from_law_id: fromLaw.id,
          from_law_title: fromLaw.title,
          to_law_id: knownLaw.id,
          to_law_title: lawName,
          to_law_num: knownLaw.lawNum,
          article: `第${articleNum}条`,
        });
      }
    } else {
      const key = `unknown:${lawName}`;
      if (!seen.has(key)) {
        seen.add(key);
        references.push({
          from_law_id: fromLaw.id,
          from_law_title: fromLaw.title,
          to_law_id: null,
          to_law_title: lawName,
          to_law_num: null,
          article: `第${articleNum}条`,
        });
      }
    }
  }

  return references;
}
