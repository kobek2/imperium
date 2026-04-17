#!/usr/bin/env node
/**
 * Rebuild Imperium files from Cursor agent transcript JSONL by replaying
 * Write, StrReplace, and ApplyPatch tool calls in chronological order.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TRANSCRIPTS_ROOT = path.join(
  process.env.HOME,
  ".cursor/projects/Users-kobethou-Imperium/agent-transcripts",
);
const IMPERIUM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listJsonlByMtime() {
  const out = [];
  if (!fs.existsSync(TRANSCRIPTS_ROOT)) {
    console.error("Missing transcripts dir:", TRANSCRIPTS_ROOT);
    process.exit(1);
  }
  for (const id of fs.readdirSync(TRANSCRIPTS_ROOT)) {
    const p = path.join(TRANSCRIPTS_ROOT, id, `${id}.jsonl`);
    if (!fs.existsSync(p)) continue;
    out.push({ p, mtime: fs.statSync(p).mtimeMs });
  }
  out.sort((a, b) => a.mtime - b.mtime);
  return out.map((x) => x.p);
}

function applyHunk(file, hunkBodyLines) {
  const rows = [];
  for (const L of hunkBodyLines) {
    if (L === "") continue;
    const tag = L[0];
    const rest = L.slice(1);
    if (tag === " ") rows.push({ t: " ", rest });
    else if (tag === "-") rows.push({ t: "-", rest });
    else if (tag === "+") rows.push({ t: "+", rest });
    else throw new Error(`Bad hunk line prefix: ${JSON.stringify(L.slice(0, 20))}`);
  }
  const ctx = rows.filter((r) => r.t === " ").map((r) => r.rest);
  const rem = rows.filter((r) => r.t === "-").map((r) => r.rest);
  const add = rows.filter((r) => r.t === "+").map((r) => r.rest);
  const ctxText = ctx.join("\n");
  const remText = rem.join("\n");
  const addText = add.join("\n");

  if (rem.length === 0) {
    if (ctx.length === 0) {
      if (!addText) return file;
      return `${file}${file.endsWith("\n") ? "" : "\n"}${addText}\n`;
    }
    const idx = file.indexOf(ctxText);
    if (idx === -1) {
      throw new Error(`ApplyPatch: context not found:\n${ctxText.slice(0, 200)}…`);
    }
    const ins = idx + ctxText.length;
    return file.slice(0, ins) + "\n" + addText + file.slice(ins);
  }

  const oldFragment = ctx.length ? `${ctxText}\n${remText}` : remText;
  const newFragment = ctx.length ? `${ctxText}\n${addText}` : addText;
  if (!file.includes(oldFragment)) {
    throw new Error(`ApplyPatch: old fragment not found:\n${oldFragment.slice(0, 240)}…`);
  }
  return file.replace(oldFragment, newFragment);
}

function applyUpdatePatch(contents, prior) {
  const lines = contents.split("\n");
  let i = 0;
  if (lines[i] !== "*** Begin Patch") throw new Error("Expected Begin Patch");
  i++;
  const m = lines[i].match(/^\*\*\* Update File: (.+)$/);
  if (!m) throw new Error(`Expected Update File, got: ${lines[i]}`);
  const fpath = m[1];
  i++;
  let file = prior ?? "";
  const hunks = [];
  let cur = [];
  while (i < lines.length) {
    const L = lines[i];
    if (L === "*** End Patch") break;
    if (L === "@@") {
      if (cur.length) hunks.push(cur);
      cur = [];
      i++;
      continue;
    }
    cur.push(L);
    i++;
  }
  if (cur.length) hunks.push(cur);
  for (const h of hunks) {
    file = applyHunk(file, h);
  }
  return { fpath, file };
}

function applyAddPatch(contents) {
  const lines = contents.split("\n");
  let i = 0;
  if (lines[i] !== "*** Begin Patch") throw new Error("Expected Begin Patch");
  i++;
  const m = lines[i].match(/^\*\*\* Add File: (.+)$/);
  if (!m) throw new Error(`Expected Add File, got: ${lines[i]}`);
  const fpath = m[1];
  i++;
  const body = [];
  while (i < lines.length) {
    const L = lines[i];
    if (L === "*** End Patch") break;
    if (L.startsWith("+")) body.push(L.slice(1));
    else if (L === "") body.push("");
    else throw new Error(`Add File: unexpected line ${JSON.stringify(L)}`);
    i++;
  }
  return { fpath, file: body.join("\n") };
}

function applyPatchString(patchText, prior) {
  if (patchText.includes("*** Add File:")) {
    return applyAddPatch(patchText);
  }
  if (patchText.includes("*** Update File:")) {
    return applyUpdatePatch(patchText, prior);
  }
  throw new Error("Unknown patch type");
}

const memory = new Map();
let writes = 0;
let replaces = 0;
let patches = 0;
let patchErr = 0;

for (const fp of listJsonlByMtime()) {
  const raw = fs.readFileSync(fp, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.role !== "assistant" || !row.message?.content) continue;
    for (const part of row.message.content) {
      if (part.type !== "tool_use") continue;
      const name = part.name;
      const input = part.input;
      if (name === "Write") {
        if (typeof input?.path !== "string" || typeof input?.contents !== "string") continue;
        if (!input.path.startsWith(IMPERIUM_ROOT)) continue;
        memory.set(input.path, input.contents);
        writes++;
      } else if (name === "StrReplace") {
        const p = input?.path;
        const oldS = input?.old_string;
        const newS = input?.new_string;
        if (typeof p !== "string" || typeof oldS !== "string" || typeof newS !== "string") continue;
        if (!p.startsWith(IMPERIUM_ROOT)) continue;
        const cur = memory.get(p);
        if (cur === undefined) continue;
        if (!cur.includes(oldS)) continue;
        memory.set(p, cur.replace(oldS, newS));
        replaces++;
      } else if (name === "ApplyPatch") {
        if (typeof input !== "string") continue;
        if (!input.includes(IMPERIUM_ROOT)) continue;
        let fpathGuess = null;
        const addM = input.match(/\*\*\* Add File: (.+)/);
        const updM = input.match(/\*\*\* Update File: (.+)/);
        if (addM) fpathGuess = addM[1].trim();
        else if (updM) fpathGuess = updM[1].trim();
        const prior = fpathGuess != null ? (memory.get(fpathGuess) ?? "") : "";
        try {
          const { fpath, file } = applyPatchString(input, prior);
          if (!fpath.startsWith(IMPERIUM_ROOT)) continue;
          memory.set(fpath, file);
          patches++;
        } catch (e) {
          patchErr++;
          console.warn("[ApplyPatch skip]", e.message);
        }
      }
    }
  }
}

for (const [abs, contents] of memory) {
  const rel = path.relative(IMPERIUM_ROOT, abs);
  if (rel.startsWith("..")) continue;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, "utf8");
}

console.log(
  JSON.stringify(
    { imperiumRoot: IMPERIUM_ROOT, writes, replaces, patches, patchErr, filesWritten: memory.size },
    null,
    2,
  ),
);
