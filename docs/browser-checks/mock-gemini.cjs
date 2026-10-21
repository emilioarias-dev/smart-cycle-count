// SIMULATED Gemini for UI checks (not the real model). Step 1: asks for a
// tool chosen from the question; step 2: writes an answer only from the
// tool results the backend returned. MODE env: ok | 429 | 503 | slow.
const os = require('os');
const path = require('path');
// Runtime state (proxy and Gemini modes, request log), outside the repository.
const STATE = process.env.CHECKS_STATE ?? path.join(os.tmpdir(), 'scc-browser-checks');
require('fs').mkdirSync(STATE, { recursive: true });
const http = require('http');
const mode = () => (require('fs').existsSync(path.join(STATE, 'gemini-mode')) ? require('fs').readFileSync(path.join(STATE, 'gemini-mode'), 'utf8').trim() : 'ok');
const codes = (q) => [...q.toUpperCase().matchAll(/\b([A-Z]-\d{2}-\d{2})\b/g)].map((m) => m[1]);
function plan(q) {
  const c = codes(q), lq = q.toLowerCase();
  if (/create|crea|delete|borra|change|cambia/.test(lq)) return null;
  if (c.length >= 2) return ['compare_bins', { first: c[0], second: c[1] }];
  if (/mayor|highest|top|primero|first/.test(lq)) return ['get_top_bins', {}];
  if (c.length === 1 && /count|conteo|result|history|historial/.test(lq)) return ['get_bin_history', { code: c[0] }];
  if (c.length === 1) return ['get_bin', { code: c[0] }];
  return ['get_rules', { topic: /score|puntuaci/.test(lq) ? 'score' : 'all' }];
}
function write(r) {
  if (r.error) return r.message;
  if (r.found === false) return r.message ?? `No bin ${r.code ?? r.missing}.`;
  if (r.bins && r.bins[0]?.rank) return r.bins.map((b) => `${b.rank}. /bins/${b.code}: ${b.currentScore} (${b.band}), score time ${b.scoreTime}`).join('\n');
  if (r.rules) return `Rules ${r.rulesVersion}:\n- ` + Object.values(r.rules).flat().join('\n- ');
  if (r.higherPriority !== undefined) return `${r.higherPriority} comes first (${r.decidedBy}).\n` + r.bins.map((b) => `- ${b.code}: current score ${b.currentScore.value} (${b.currentScore.band}), score time ${b.currentScore.scoreTime}. ${b.forNewPlan} See /bins/${b.code}.`).join('\n');
  if (r.tasks) return r.tasks.length === 0 ? `${r.note} See /bins/${r.code}.` : `${r.code}: current score ${r.currentScore?.value} (score time ${r.currentScore?.scoreTime}).\n` + r.tasks.map((t) => `- Plan #${t.planId}: score at selection ${t.scoreAtSelection.value}; ${t.status}${t.count ? `; count ${t.count.result} at ${t.count.countedAt}: ` + t.count.lines.map((l) => `${l.pallet} ${l.counted}/${l.expected} ${l.unit} (variance ${l.variance})`).join(', ') : ''}`).join('\n') + '\nSee /tasks.';
  if (r.currentScore) return `${r.code} has a current score of ${r.currentScore.value} (${r.currentScore.band}), score time ${r.currentScore.scoreTime}:\n` + r.currentScore.factors.map((f) => `- ${f.factor}: ${f.points} points (input ${f.input}, weight ${f.weight})`).join('\n') + `\nSee /bins/${r.code}.`;
  return JSON.stringify(r).slice(0, 300);
}
http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
    const body = JSON.parse(raw || '{}'); const m = mode();
    require('fs').appendFileSync(path.join(STATE, 'gemini-requests.log'), JSON.stringify({ contents: body.contents.length, last: body.contents.at(-1).parts[0].text ?? 'functionResponse', mode: body.toolConfig?.functionCallingConfig?.mode, maxOutputTokens: body.generationConfig?.maxOutputTokens }) + '\n');
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (m === '429') return send(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded (simulated).' } });
    if (m === '503') return send(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand (simulated).' } });
    const last = body.contents.at(-1);
    const usage = { promptTokenCount: 150, candidatesTokenCount: 40, totalTokenCount: 190 };
    const reply = () => {
      if (last.parts[0].functionResponse) {
        const t = m === 'ungrounded' ? 'Los bins con mayor puntuación son:\n- /bins/A-01-01 (score 71, High priority)\n- /bins/A-01-02 (score 70, High priority)\nDatos al 2026-10-20T23:14:45.122Z.' : last.parts.map((p) => write(p.functionResponse.response)).join('\n\n');
        return send(200, { candidates: [{ content: { role: 'model', parts: [{ text: t }] }, finishReason: 'STOP' }], usageMetadata: usage });
      }
      const p = plan(last.parts[0].text);
      if (!p) return send(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'I am read-only: I cannot create, change or delete anything. Use the Warehouse, Tasks or Count page.' }] }, finishReason: 'STOP' }], usageMetadata: usage });
      send(200, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: p[0], args: p[1], id: 'sim-1' }, thoughtSignature: 'simulated' }] }, finishReason: 'STOP' }], usageMetadata: usage });
    };
    setTimeout(reply, m === 'slow' ? 40000 : m === 'slow3' ? 3000 : 300);
  });
}).listen(4010, '127.0.0.1', () => console.log('simulated Gemini on 4010'));
