// SillyToken · 调用日志（Call Log）数据层
// ---------------------------------------------------------------------------
// 这是什么：把「每一次真正打到模型端点的调用」记成一条 ≤320 字节的流水。
// 与现有两份数据的边界（别混）：
//   · 统计（settings 里的 stats/dailyStats/history）—— 按天+按模型的聚合桶，是金额的唯一权威
//   · 运行日志（index.js 里的 tfLog，内存 400 条）—— 开发者排障事件，刷新即失
//   · 调用日志（本文件）—— 用户对账用的逐条流水，落 IndexedDB，会被淘汰
//
// 三条硬约束：
//   1. 正文绝不入库：只存 prompt 的消息条数与字符数，不存 messages 本身
//   2. 不污染 settings.json：日志本体不进 extension_settings（会被云端同步/导出分享）
//   3. 写失败不能拖垮插件：IndexedDB 打不开就退回纯内存，功能降级但不崩
// ===========================================================================

export const TF_CALL_LOG_DB = 'sillytoken-calllog';
export const TF_CALL_LOG_DB_VERSION = 1;
export const TF_CALL_LOG_STORE = 'records';

/** 默认策略：热区条数 / 持久上限 / 保留天数 */
export const TF_CALL_LOG_DEFAULTS = {
    enabled: true,
    hotLimit: 2000,
    maxEntries: 20000,
    retentionDays: 90,
};

/* ---------------- 脱敏与格式化（纯函数，方便单测） ---------------- */

const TF_REDACT_RULES = [
    [/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1***'],
    [/\b(sk|pk|ak|rk)-[A-Za-z0-9_\-]{6,}/g, '$1-***'],
    [/([?&](?:key|api[_-]?key|token|access_token|password|secret|sig)=)[^&\s]+/gi, '$1***'],
    [/\b[A-Za-z0-9_\-]{32,}\b/g, '***'],
];

/** 错误摘要脱敏 + 截断：转口商的报错里经常带 key / 带 query 的完整地址 */
export function tfCallLogRedact(value, limit = 160) {
    let s = String(value == null ? '' : value);
    for (const [re, rep] of TF_REDACT_RULES) s = s.replace(re, rep);
    // 控制字符一律去掉（避免把终端转义序列写进 CSV）
    s = s.replace(/[\u0000-\u001f\u007f]/g, ' ');
    if (s.length > limit) s = s.slice(0, limit) + '…(' + s.length + ')';
    return s;
}

/** 模型原始名：保留 [CC] / 假流式- 这类诊断前缀，但截断 + 去控制字符 */
export function tfCallLogModelName(value, limit = 60) {
    const s = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '');
    return s.length > limit ? s.slice(0, limit) + '…' : s;
}

/** 12400 -> 12.4s；900 -> 900ms；90500 -> 1m30s */
export function tfCallLogDuration(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1000) return Math.round(n) + 'ms';
    if (n < 60000) return (n / 1000).toFixed(1) + 's';
    const m = Math.floor(n / 60000);
    const s = Math.floor((n % 60000) / 1000);
    return m + 'm' + s + 's';
}

/** 输出吞吐：token/秒（拿不到耗时返回 null，不编数） */
export function tfCallLogRate(outTokens, durationMs) {
    const t = Number(outTokens);
    const d = Number(durationMs);
    if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0 || t <= 0) return null;
    return t / (d / 1000);
}

/** CSV 单元格：引号/换行/逗号转义，防公式注入 */
export function tfCallLogCsvCell(value) {
    let s = String(value == null ? '' : value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
}

export const TF_CALL_LOG_CSV_HEADER = [
    '开始时间', '结束时间', '模型', '归一模型', '渠道', '来源', '流式',
    '输入', '输出', '缓存', '估算', '费用USD', '状态', 'HTTP', '错误码',
    '错误摘要', '耗时ms', '首字ms', 'tokens/s', '消息数', '字符数', '指纹',
];

const tfPad2 = (n) => String(n).padStart(2, '0');

export function tfCallLogTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n);
    return d.getFullYear() + '-' + tfPad2(d.getMonth() + 1) + '-' + tfPad2(d.getDate())
        + ' ' + tfPad2(d.getHours()) + ':' + tfPad2(d.getMinutes()) + ':' + tfPad2(d.getSeconds());
}

/** 导出 CSV：带 UTF-8 BOM（否则 Excel 打开中文渠道名是乱码） */
export function tfCallLogBuildCsv(records) {
    const rows = [TF_CALL_LOG_CSV_HEADER.join(',')];
    for (const r of (records || [])) {
        const rate = tfCallLogRate(r.out, r.durationMs);
        rows.push([
            tfCallLogTime(r.startedAt),
            tfCallLogTime(r.endedAt),
            r.modelRaw,
            r.modelKey,
            r.channel,
            r.sourceKey,
            r.stream ? '流' : '非流',
            r.in,
            r.out,
            r.cached,
            r.estimated ? '是' : '',
            Number(r.costUsd || 0).toFixed(6),
            r.status,
            r.httpStatus == null ? '' : r.httpStatus,
            r.errorCode || '',
            r.errorSummary || '',
            r.durationMs || 0,
            r.ttftMs == null ? '' : r.ttftMs,
            rate == null ? '' : rate.toFixed(1),
            r.promptMsgs || 0,
            r.promptChars || 0,
            r.digest || '',
        ].map(tfCallLogCsvCell).join(','));
    }
    return '\ufeff' + rows.join('\r\n') + '\r\n';
}

export function tfCallLogBuildNdjson(records) {
    return (records || []).map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/* ---------------- 存储：IndexedDB（打不开就退回内存） ---------------- */

let tfIdbState = 'unknown';     // 'unknown' | 'ok' | 'off'
let tfIdbPromise = null;

function tfIdbUnavailableReason() {
    try {
        if (typeof indexedDB === 'undefined' || !indexedDB) return '宿主没有 indexedDB';
    } catch { return '访问 indexedDB 抛错'; }
    return '';
}

/** 打开/复用连接；不可用时返回 null（调用方退回内存，不抛错） */
export function tfCallLogOpenDb() {
    if (tfIdbState === 'off') return Promise.resolve(null);
    if (tfIdbPromise) return tfIdbPromise;
    const reason = tfIdbUnavailableReason();
    if (reason) {
        tfIdbState = 'off';
        return Promise.resolve(null);
    }
    tfIdbPromise = new Promise((resolve) => {
        let req = null;
        try {
            req = indexedDB.open(TF_CALL_LOG_DB, TF_CALL_LOG_DB_VERSION);
        } catch {
            tfIdbState = 'off';
            resolve(null);
            return;
        }
        req.onupgradeneeded = () => {
            try {
                const db = req.result;
                if (!db.objectStoreNames.contains(TF_CALL_LOG_STORE)) {
                    const store = db.createObjectStore(TF_CALL_LOG_STORE, { keyPath: 'id' });
                    store.createIndex('startedAt', 'startedAt', { unique: false });
                }
            } catch { /* 建表失败由下面的 onerror 兜 */ }
        };
        req.onsuccess = () => {
            const db = req.result;
            tfIdbState = 'ok';
            // 别的标签页要升级 schema 时不能挡着
            try { db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } tfIdbPromise = null; tfIdbState = 'unknown'; }; } catch { /* ignore */ }
            resolve(db);
        };
        req.onerror = () => { tfIdbState = 'off'; resolve(null); };
        req.onblocked = () => { tfIdbState = 'off'; resolve(null); };
        req.onabort = () => { tfIdbState = 'off'; resolve(null); };
        // 某些 WebView 既不 success 也不 error：超时后按不可用处理
        setTimeout(() => { if (tfIdbState === 'unknown') { tfIdbState = 'off'; resolve(null); } }, 3000);
    });
    return tfIdbPromise;
}

function tfIdbTx(mode, fn) {
    return tfCallLogOpenDb().then((db) => new Promise((resolve, reject) => {
        if (!db) { resolve(null); return; }
        let tx = null;
        try { tx = db.transaction(TF_CALL_LOG_STORE, mode); } catch (e) { reject(e); return; }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('idb tx error'));
        tx.onabort = () => reject(tx.error || new Error('idb tx aborted'));
        try { fn(tx.objectStore(TF_CALL_LOG_STORE)); } catch (e) { reject(e); }
    })).catch(() => null);
}

/** 批量写入（上层已按 1s / 20 条节流） */
export function tfCallLogAppend(records) {
    const list = (records || []).filter(Boolean);
    if (!list.length) return Promise.resolve(false);
    return tfIdbTx('readwrite', (store) => {
        for (const rec of list) {
            try { store.put(rec); } catch { /* 单条失败不影响其它 */ }
        }
    }).then((ok) => ok === true);
}

/** 拉最近 limit 条（按 startedAt 倒序返回） */
export function tfCallLogLoadRecent(limit = TF_CALL_LOG_DEFAULTS.hotLimit) {
    return tfCallLogOpenDb().then((db) => new Promise((resolve) => {
        if (!db) { resolve([]); return; }
        const out = [];
        let tx = null;
        try { tx = db.transaction(TF_CALL_LOG_STORE, 'readonly'); } catch { resolve([]); return; }
        let cursorReq = null;
        try {
            const store = tx.objectStore(TF_CALL_LOG_STORE);
            if (store.indexNames && store.indexNames.contains('startedAt')) {
                cursorReq = store.index('startedAt').openCursor(null, 'prev');
            } else {
                cursorReq = store.openCursor(null, 'prev');
            }
        } catch { resolve([]); return; }
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor || out.length >= limit) { resolve(out); return; }
            out.push(cursor.value);
            cursor.continue();
        };
        cursorReq.onerror = () => resolve(out);
        setTimeout(() => resolve(out), 4000);
    })).catch(() => []);
}

/** 清空 */
export function tfCallLogClear() {
    return tfIdbTx('readwrite', (store) => store.clear()).then((ok) => ok === true);
}

/** 淘汰：按保留天数整桶删旧天，再按条数上限裁最旧 */
export function tfCallLogPrune(retentionDays, maxEntries, nowMs = Date.now()) {
    const days = Number(retentionDays);
    const cap = Number(maxEntries);
    return tfCallLogOpenDb().then((db) => new Promise((resolve) => {
        if (!db) { resolve(0); return; }
        const cutoff = (Number.isFinite(days) && days > 0 && Number.isFinite(nowMs))
            ? nowMs - days * 86400000
            : null;
        let removed = 0;
        let tx = null;
        try { tx = db.transaction(TF_CALL_LOG_STORE, 'readwrite'); } catch { resolve(0); return; }
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(removed); } };
        tx.oncomplete = finish;
        tx.onerror = finish;
        tx.onabort = finish;
        try {
            const store = tx.objectStore(TF_CALL_LOG_STORE);
            if (cutoff != null) {
                const idx = store.indexNames && store.indexNames.contains('startedAt')
                    ? store.index('startedAt') : null;
                if (idx) {
                    const range = IDBKeyRange.upperBound(cutoff, true);
                    const req = idx.openCursor(range);
                    req.onsuccess = () => {
                        const cur = req.result;
                        if (!cur) return;
                        cur.delete();
                        removed += 1;
                        cur.continue();
                    };
                }
            }
            if (Number.isFinite(cap) && cap > 0) {
                // 超上限：从最旧删到剩 cap 条（只在条数确实超了才扫）
                const countReq = store.count();
                countReq.onsuccess = () => {
                    let over = countReq.result - cap;
                    if (over <= 0) return;
                    const req = store.openCursor();
                    req.onsuccess = () => {
                        const cur = req.result;
                        if (!cur || over <= 0) return;
                        cur.delete();
                        over -= 1;
                        removed += 1;
                        cur.continue();
                    };
                };
            }
        } catch { finish(); }
        setTimeout(finish, 5000);
    })).catch(() => 0);
}
