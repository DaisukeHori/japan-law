/**
 * analyze_worker.js
 * 参照解析ワーカープロセス（JavaScript版・完全版）
 */

const fs = require("fs");
const path = require("path");

process.on("message", (data) => {
  const { xmlFiles, lawIndex, abbreviations, workerId } = data;

  // マップ構築
  const titleToLaw = new Map();
  const lawIdMap = new Map();

  for (const law of lawIndex) {
    titleToLaw.set(law.title, law);
    lawIdMap.set(law.id, law);
  }

  // 略称マップ（law_idから法令オブジェクトを取得）
  const abbrevMap = new Map();
  for (const [key, value] of Object.entries(abbreviations || {})) {
    // value は { full_name, law_id, count } 形式
    if (value && value.law_id) {
      const law = lawIdMap.get(value.law_id);
      if (law) {
        abbrevMap.set(key, law);
      }
    }
  }

  // 既知の法令名リスト（長い順にソート）
  const knownLawNames = [];
  for (const law of lawIndex) {
    knownLawNames.push({ name: law.title, law });
  }
  for (const [abbrev, law] of abbrevMap) {
    knownLawNames.push({ name: abbrev, law });
  }
  knownLawNames.sort((a, b) => b.name.length - a.name.length);

  // 正規表現パターン
  const unknownLawWithNumPattern = /([一-龠ぁ-んァ-ヶａ-ｚＡ-Ｚa-zA-Z・]{2,50}?(?:法|令|規則|条例))（((?:明治|大正|昭和|平成|令和)[^）]{3,50}?号)）/g;
  const amendmentPattern = /([一-龠ぁ-んァ-ヶ]{2,50}?)の一部を改正する(法律|政令|省令|規則)/g;

  // 参照抽出
  const allReferences = [];
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
        amendmentPattern
      );
      allReferences.push(...refs);
    } catch (e) {
      // エラー無視
    }

    processedCount++;
    if (processedCount % 100 === 0) {
      process.send({ type: "progress", workerId, processed: processedCount, total: xmlFiles.length });
    }
  }

  // IPC送信完了を待ってから終了
  process.send({ type: "result", references: allReferences }, () => {
    process.exit(0);
  });
});

function extractReferences(
  xmlContent,
  fromLaw,
  knownLawNames,
  titleToLaw,
  abbrevMap,
  unknownLawWithNumPattern,
  amendmentPattern
) {
  const references = [];
  const seen = new Set();

  // フェーズ1: 既知の法令名を高速検索
  for (const { name, law } of knownLawNames) {
    if (law.id === fromLaw.id) continue;
    if (seen.has(law.id)) continue;
    if (name.length < 2) continue;

    const pos = xmlContent.indexOf(name);
    if (pos === -1) continue;

    // 部分一致を避ける（前の文字をチェック）
    const beforeChar = pos > 0 ? xmlContent[pos - 1] : "";
    if (beforeChar && /[一-龠ぁ-んァ-ヶ]/.test(beforeChar)) {
      continue;
    }

    seen.add(law.id);

    // 条文番号を抽出
    const afterText = xmlContent.substring(pos + name.length, pos + name.length + 50);
    let article = null;
    let paragraph = null;
    let item = null;
    let refType = "law_name";

    const artMatch = afterText.match(/^第([一二三四五六七八九十百千〇０-９0-9]+)条(?:の([一二三四五六七八九十〇０-９0-9]+))?(?:第([一二三四五六七八九十〇０-９0-9]+)項)?(?:第([一二三四五六七八九十〇０-９0-9]+)号)?/);
    if (artMatch) {
      article = "第" + artMatch[1] + "条" + (artMatch[2] ? "の" + artMatch[2] : "");
      if (artMatch[3]) paragraph = "第" + artMatch[3] + "項";
      if (artMatch[4]) item = "第" + artMatch[4] + "号";
      refType = "article_ref";
    }

    const numMatch = afterText.match(/^（((?:明治|大正|昭和|平成|令和)[^）]{3,50}?号)）/);
    if (numMatch) {
      refType = "law_num_ref";
    }

    references.push({
      from_law_id: fromLaw.id,
      from_law_title: fromLaw.title,
      to_law_id: law.id,
      to_law_title: name,
      to_law_num: law.lawNum,
      article,
      paragraph,
      item,
      ref_type: refType,
    });
  }

  // フェーズ2: 未知の法令を正規表現で検索
  unknownLawWithNumPattern.lastIndex = 0;
  let match;
  while ((match = unknownLawWithNumPattern.exec(xmlContent)) !== null) {
    const lawName = match[1];
    const lawNum = match[2];

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
          article: null,
          paragraph: null,
          item: null,
          ref_type: "law_num_ref",
        });
      }
    } else {
      const key = "unknown:" + lawName;
      if (!seen.has(key)) {
        seen.add(key);
        references.push({
          from_law_id: fromLaw.id,
          from_law_title: fromLaw.title,
          to_law_id: null,
          to_law_title: lawName,
          to_law_num: lawNum,
          article: null,
          paragraph: null,
          item: null,
          ref_type: "unknown_law",
        });
      }
    }
  }

  // フェーズ3: 改正法パターン
  amendmentPattern.lastIndex = 0;
  while ((match = amendmentPattern.exec(xmlContent)) !== null) {
    const originalLawName = match[1];

    const originalLaw = titleToLaw.get(originalLawName) || abbrevMap.get(originalLawName);

    if (originalLaw && !seen.has(originalLaw.id) && originalLaw.id !== fromLaw.id) {
      seen.add(originalLaw.id);
      references.push({
        from_law_id: fromLaw.id,
        from_law_title: fromLaw.title,
        to_law_id: originalLaw.id,
        to_law_title: originalLawName,
        to_law_num: originalLaw.lawNum,
        article: null,
        paragraph: null,
        item: null,
        ref_type: "amendment_ref",
      });
    }
  }

  return references;
}
