// One-off: retag nodes for the pivot (technical detection, not human judgment),
// attach publication dates, and drop the claims that are only about human reading
// from the load-bearing denominator.
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'evidence.jsonl';
const rows = readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);

const nodeMap = {};
for (const r of rows) {
  const n = Number(r.claim_id.slice(1));
  if (n >= 14 && n <= 31) nodeMap[r.claim_id] = 'N5';   // old failure-modes + human studies
  if (n >= 32 && n <= 42) nodeMap[r.claim_id] = 'N6';   // watermark / provenance
}

const published = {
  C001: '2026-01-01', C002: '2024-01-22', C003: '2024-08-11', C004: '2024-10-23',
  C005: '2026-10-21', C006: '2026-10-21', C007: '2024-08-11', C008: '2025-10-06',
  C009: '2026-07-15', C010: '2026-08-02', C011: '2026-05-15', C012: '2026-01-13',
  C013: '2026-10-31', C014: '2023-07-10', C015: '2023-07-10', C016: '2023-06-28',
  C017: '2023-12-15', C018: '2024-08-11', C019: '2026-09-26', C020: '2026-05-01',
  C021: '2025-10-15', C022: '2025-01-16', C023: '2025-02-17', C024: '2025-05-19',
  C025: '2026-09-16', C026: '2026-08-29', C027: '2026-08-21', C028: '2025-07-02',
  C029: '2025-12-09', C030: '2025-08-31', C031: '2023-12-10', C032: 'undated',
  C033: 'undated', C034: '2026-09-23', C035: '2026-10-20', C036: '2026-07-20',
  C037: 'undated', C038: '2026-10-05', C039: '2026-10-05', C040: '2026-08-12',
  C041: '2026-10-10', C042: '2026-10-09', C043: '2026-05-01', C044: '2026-01-01',
  C045: '2026-01-31', C046: '2026-06-01', C047: '2026-06-01', C048: '2026-05-28',
  C049: '2025-03-07', C050: '2025-02-28', C051: '2025-08-01', C052: '2026-01-01',
  C053: '2025-03-12', C054: '2026-10-18', C055: '2026-10-28',
};

// These answer "can a person spot it by eye" — kept as a caveat, not as the
// technical answer, so they must not inflate the citation-accuracy denominator.
const notLoadBearing = new Set(['C021', 'C022', 'C023', 'C024', 'C025', 'C026', 'C027', 'C029', 'C030', 'C031']);

const out = rows.map((r) => {
  if (nodeMap[r.claim_id]) r.node = nodeMap[r.claim_id];
  if (published[r.claim_id]) r.published = published[r.claim_id];
  if (notLoadBearing.has(r.claim_id)) r.load_bearing = false;
  // Out-of-window classics: the method itself has not been superseded.
  const old = ['C014', 'C015', 'C016', 'C017', 'C018'];
  if (old.includes(r.claim_id)) r.stale_reason = '方法学原理论文（改写攻击/不可能性/RAID 协议），结论未被 2026 年的工作推翻，仅作为失效机制的原始证据引用';
  return r;
});

writeFileSync(p, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('rows', out.length, 'load-bearing', out.filter((r) => r.load_bearing).length);
