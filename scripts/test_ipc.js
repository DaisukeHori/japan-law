const { fork } = require("child_process");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const INDEX_DIR = path.join(DATA_DIR, "index");
const XML_DIR = path.join(DATA_DIR, "xml");

// 少数のファイルでテスト
const xmlFiles = [];
const actsDir = path.join(XML_DIR, "acts");
const files = fs.readdirSync(actsDir).slice(0, 10);
for (const f of files) {
  xmlFiles.push(path.join(actsDir, f));
}

const lawIndex = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, "laws.json"), "utf-8")).laws;
const abbrData = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, "abbreviations.json"), "utf-8"));
const abbreviations = abbrData.abbreviation_map || {};

console.log("Testing IPC with", xmlFiles.length, "files");
console.log("Law index:", lawIndex.length, "entries");
console.log("Abbreviations:", Object.keys(abbreviations).length, "entries");

const workerScript = path.join(__dirname, "analyze_worker.js");

const child = fork(workerScript, [], {
  stdio: ["pipe", "pipe", "inherit", "ipc"],
});

let result = [];

child.on("message", (msg) => {
  console.log("Received message type:", msg.type);
  if (msg.type === "progress") {
    console.log("  Progress:", msg.processed, "/", msg.total);
  } else if (msg.type === "result") {
    result = msg.references;
    console.log("  Result received:", result.length, "references");
  }
});

child.on("exit", (code) => {
  console.log("Worker exited with code:", code);
  console.log("Final result count:", result.length);
  if (result.length > 0) {
    console.log("Sample reference:", JSON.stringify(result[0], null, 2));
  }
});

child.on("error", (err) => {
  console.error("Worker error:", err);
});

// データ送信
child.send({
  xmlFiles,
  lawIndex,
  abbreviations,
  workerId: 1,
  totalWorkers: 1,
});
