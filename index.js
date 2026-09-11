import {
    eventSource,
    event_types,
    saveSettingsDebounced,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { t } from '../../../i18n.js';

// 安全获取 SillyTavern 上下文（world-backstage 验证过的模式）
function getContext() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

// 安全的 i18n 包装：避免 t() 在上下文未就绪时抛异常导致渲染中断
function safeT(key) {
    try {
        const result = t(key);
        return (typeof result === 'string' && result.length > 0) ? result : key;
    } catch {
        return key;
    }
}

const MODULE = 'token_flow';
const GENERATE_ENDPOINT = '/api/backends/chat-completions/generate';
const STREAM_DONE = '[DONE]';

// 2026 最新旗舰定价（$/1M token，cached 为缓存输入价）
// Kimi 官方为 CNY，已按 ~7.1 汇率折算为 USD 基准
const PRESET_MODELS = [
    // OpenAI · ChatGPT 5.6 系列（3 档）
    { name: 'gpt-5.6-sol',        input: 5.00, output: 30.00, cached: 0.50,   perRequest: 0, multiplier: 1 },
    { name: 'gpt-5.6-terra',      input: 2.50, output: 15.00, cached: 0.25,   perRequest: 0, multiplier: 1 },
    { name: 'gpt-5.6-luna',       input: 1.00, output: 6.00,  cached: 0.10,   perRequest: 0, multiplier: 1 },
    // Google · Gemini
    { name: 'gemini-3.1-pro',     input: 2.00, output: 12.00, cached: 0.40,   perRequest: 0, multiplier: 1 },
    { name: 'gemini-3.5-flash',   input: 1.50, output: 7.50,  cached: 0.30,   perRequest: 0, multiplier: 1 },
    { name: 'gemini-3.6-flash',   input: 1.50, output: 7.50,  cached: 0.30,   perRequest: 0, multiplier: 1 },
    { name: 'gemini-3.7-flash',   input: 0.75, output: 3.75,  cached: 0.15,   perRequest: 0, multiplier: 1 },
    // Anthropic
    { name: 'claude-opus-4.6',    input: 15.00, output: 75.00, cached: 1.50,  perRequest: 0, multiplier: 1 },
    { name: 'claude-sonnet-4.6',  input: 3.00, output: 15.00, cached: 0.30,   perRequest: 0, multiplier: 1 },
    // DeepSeek · V4 全系列（快Flash/Pro，均含正式版与预览版；高峰价基准，CNY→USD@7.1）
    // 官方：自2026-08-17起峰谷定价，高峰(9-12,14-18时)为淡季2倍。此处取高峰"缓存未命中输入+输出"为基准
    { name: 'deepseek-v4-flash',  input: 0.42, output: 1.27,  cached: 0.014, perRequest: 0, multiplier: 1 },
    { name: 'deepseek-v4-pro',    input: 1.27, output: 3.80,  cached: 0.042, perRequest: 0, multiplier: 1 },
    // Kimi (月之暗面，CNY→USD @7.1)
    { name: 'kimi-k3',            input: 3.00, output: 15.00, cached: 0.30,   perRequest: 0, multiplier: 1 },
    { name: 'kimi-k2.6',          input: 0.95, output: 4.00,  cached: 0.10,   perRequest: 0, multiplier: 1 },
];

const defaultSettings = {
    enabled: true,
    trackExact: true,
    useFallback: true,
    displayCurrency: '$',
    exchangeRate: 1,
    showOrb: true,
    orbPosition: null,
    models: structuredClone(PRESET_MODELS),
    modelVersion: 20260819,
    stats: { models: {}, totalCost: 0, totalTokens: 0, totalRequests: 0 },
    session: { models: {}, totalCost: 0, totalTokens: 0, totalRequests: 0 },
    sessionStartedAt: Date.now(),
    // ===== v1.1.0 增强：历史归档 + 预算 + 上下文监控 =====
    history: [],                       // 按日归档 [{date, cost, tokens, req}]
    dailyStats: {},                    // 今日累计 {cost, tokens, req}
    budget: { enabled: false, dailyLimit: 0, monthlyLimit: 0 },
    contextSize: 128000,               // 默认上下文窗口（可编辑）
    lastDailyReport: '',               // 记录最近一次简报日期，避免重复
    autoArchive: true,                 // 是否自动归档
    archiveDays: 365,                  // 历史归档保留天数（「全部」视图要靠它）
    statsRange: { mode: 'preset', id: '7d', from: '', to: '' },   // 面板当前选的时间范围
    // ===== v1.2.0：五套大师级主题 =====
    theme: 'aurora-midnight',          // 默认主题
    // ===== v1.3.0：Gemini 风格用量限额 =====
    geminiQuota: {
        enabled: true,                  // 是否显示用量限额面板
        metric: 'tokens',               // 度量方式：tokens | cost | requests
        dailyLimit: 0,                  // 每日限额（metric 单位），0=不限
        weeklyLimit: 0,                 // 每周限额，0=不限
        dailyResetTime: '17:19',        // 每日重置时刻 (HH:MM)
        weeklyResetDay: 4,              // 每周重置日 (0=周日..6=周六)
        weeklyResetTime: '12:19',       // 每周重置时刻 (HH:MM)
        upgradeLabel: 'AI Plus',        // 升级卡片标题
        upgradePrice: 'SGD 6.98/月',    // 升级卡片价格
        upgradeMultiplier: 2,           // 升级后倍数
    },
    // ===== v1.4.0：悬浮球增强 =====
    autoRefresh: false,                // 自动刷新
    autoRefreshInterval: 15,           // 自动刷新间隔（秒）
    rpm: { window: [], peak: 0 },      // 每分钟请求数(RPM)滑动窗口
};

function getSettings() {
    if (extension_settings[MODULE] === undefined) {
        extension_settings[MODULE] = structuredClone(defaultSettings);
    }
    const s = extension_settings[MODULE];
    for (const key of Object.keys(defaultSettings)) {
        if (s[key] === undefined) s[key] = structuredClone(defaultSettings[key]);
    }
    if (!Array.isArray(s.models)) s.models = structuredClone(PRESET_MODELS);
    // 预设价格表升级（双保险）：
    // 1) 内置版本比用户保存的新时，整体刷新为最新旗舰报价
    // 2) 即便版本号未变，也主动剔除已淘汰的旧模型，并确保当前旗舰系列存在
    const OBSOLETE = ['gpt-4o', 'gpt-4o-mini', 'gpt-5', 'deepseek-chat', 'deepseek-reasoner', 'qwen3.5-plus', 'mimo-v2.5-pro'];
    const NEEDS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'deepseek-v4-flash', 'deepseek-v4-pro', 'gemini-3.7-flash'];
    const outdatedVersion = (s.modelVersion || 0) < (defaultSettings.modelVersion || 0);
    // 必须精确或「前缀 + 连字符」匹配：旧版用 includes，OBSOLETE 里的 'gpt-5'
    // 命中了内置的 'gpt-5.6-sol'，于是 hasObsolete 永远为真、每次 getSettings() 都重建价格表
    const hasObsolete = OBSOLETE.some((dep) => s.models.some((m) => {
        const name = String((m && m.name) || '').toLowerCase().trim();
        return name === dep || name.startsWith(dep + '-') || name.startsWith(dep + '_');
    }));
    const missingFlagships = NEEDS.some(need => !s.models.some(m => String(m.name).toLowerCase() === need));
    if (outdatedVersion || hasObsolete || missingFlagships) {
        // v2.1.0：不再整体覆盖。预设只负责「补新」，用户改过的条目原样保留 ——
        // 否则用户手填的单价会在版本升级时被无声抹掉。
        const remaining = new Map(s.models.map(m => [String(m.name).toLowerCase(), m]));
        const fresh = [];
        for (const preset of structuredClone(PRESET_MODELS)) {
            const key = String(preset.name).toLowerCase();
            const existing = remaining.get(key);
            remaining.delete(key);
            if (existing && existing.userEdited) fresh.push(existing);   // 用户改过 → 尊重用户
            else if (existing) {
                // 值没变就复用原对象。旧版无条件新建对象，会让设置面板里
                // 已经打开的输入框闭包指向一个「脱离」的对象 —— 你敲进去的价格被静默丢弃
                const same = ['input', 'output', 'cached', 'perRequest'].every(
                    (f) => Number(existing[f] || 0) === Number(preset[f] || 0));
                fresh.push(same ? existing : { ...preset, userEdited: false });
            }
            else fresh.push(preset);                                     // 新增的预设型号
        }
        for (const [lower, entry] of remaining) {
            // 已淘汰、且用户从没改过的预设残留可以丢；其余（用户自建模型）一律保留
            const obsolete = !entry.userEdited && OBSOLETE.some(dep => lower.includes(dep));
            if (!obsolete) fresh.push(entry);
        }
        s.models = fresh;
        s.modelVersion = defaultSettings.modelVersion;
        saveSettingsDebounced();
    }
    if (!s.stats || typeof s.stats !== 'object') s.stats = structuredClone(defaultSettings.stats);
    if (!s.session || typeof s.session !== 'object') s.session = structuredClone(defaultSettings.session);
    // ===== v1.6.0 兜底：每个模型倍率（缺省 x1）=====
    if (Array.isArray(s.models)) {
        for (const mx of s.models) {
            if (mx && (typeof mx.multiplier !== 'number' || !(mx.multiplier > 0))) mx.multiplier = 1;
        }
    }
    if (!s.stats.models) s.stats.models = {};
    if (!s.session.models) s.session.models = {};
    // ===== v1.1.0 兜底：历史归档 / 预算 / 上下文 =====
    if (!Array.isArray(s.history)) s.history = [];
    if (!s.dailyStats || typeof s.dailyStats !== 'object') s.dailyStats = { cost: 0, tokens: 0, req: 0 };
    if (!s.dailyStats.models || typeof s.dailyStats.models !== 'object') s.dailyStats.models = {};
    if (!s.budget || typeof s.budget !== 'object') s.budget = { enabled: false, dailyLimit: 0, monthlyLimit: 0 };
    if (typeof s.contextSize !== 'number') s.contextSize = 128000;
    if (typeof s.archiveDays !== 'number' || !Number.isFinite(s.archiveDays) || s.archiveDays <= 0) s.archiveDays = 365;
    // ===== v1.3.0 兜底：Gemini 用量限额 =====
    if (!s.geminiQuota || typeof s.geminiQuota !== 'object') {
        s.geminiQuota = structuredClone(defaultSettings.geminiQuota);
    } else {
        // 逐字段补齐，防止旧配置缺字段
        const dq = defaultSettings.geminiQuota;
        for (const k of Object.keys(dq)) {
            if (s.geminiQuota[k] === undefined) s.geminiQuota[k] = dq[k];
        }
    }
    return s;
}

/* ============================================================
 *  费用计算引擎
 * ============================================================ */

const TF_EMPTY_PRICE = { input: 0, output: 0, cached: 0, perRequest: 0, multiplier: 1 };

// 返回里带 matchedBy / matchedName：让「用了哪一档价格」永远可见，
// 不再出现静默按 0 计费、或静默命中同族里最贵一档的情况。
function getPriceFor(settings, model) {
    // 过滤掉非对象项：导入的备份里可能混进 null（旧版会直接抛异常，把整个面板搞空）
    const models = (Array.isArray(settings?.models) ? settings.models : []).filter((m) => m && typeof m === 'object');
    const key = tfCanonicalModel(model);
    if (!key) return { ...TF_EMPTY_PRICE, name: model, matchedBy: 'none', matchedName: null };

    // 1) 归一化后精确命中（去 vendor 前缀 / 日期尾巴 / preview 之类的装饰）
    for (const m of models) {
        if (tfCanonicalModel(m.name) === key) return { ...m, matchedBy: 'exact', matchedName: m.name };
    }
    // 2) 手动/自动别名
    for (const m of models) {
        if (tfAliasList(m).includes(key)) return { ...m, matchedBy: 'alias', matchedName: m.name };
    }
    // 3) 显著词相同（忽略版本词）：deepseek-flash -> deepseek-v4-flash
    //    同族有多个候选时标成 ambiguous，界面上会提示手动指定别名
    const keyTokens = tfSignificantTokens(key);
    const keyVersions = tfVersionTokens(key);
    const tokenMatches = [];
    if (keyTokens.length) {
        for (const m of models) {
            const entryCanonical = tfCanonicalModel(m.name);
            const tokens = tfSignificantTokens(entryCanonical);
            if (!tokens.length || tokens.length !== keyTokens.length) continue;
            if (!tokens.every((tk) => keyTokens.includes(tk))) continue;
            // 关键：只有「请求里的模型名没带版本」时才允许跨版本推断。
            // 否则 gemini-2.5-flash 会被并到同族的 gemini-3.5-flash 上 ——
            // 同名不同版本的价格往往不一样，那就是实打实的算错钱。
            const entryVersions = tfVersionTokens(entryCanonical);
            if (keyVersions.length && entryVersions.join('.') !== keyVersions.join('.')) continue;
            tokenMatches.push(m);
        }
    }
    if (tokenMatches.length === 1) {
        return { ...tokenMatches[0], matchedBy: 'alias', matchedName: tokenMatches[0].name };
    }
    if (tokenMatches.length > 1) {
        const shortest = tokenMatches.slice().sort((a, b) =>
            String(tfCanonicalModel(a.name)).length - String(tfCanonicalModel(b.name)).length)[0];
        return { ...shortest, matchedBy: 'ambiguous', matchedName: shortest.name };
    }
    // 4) 退化为包含匹配
    for (const m of models) {
        const name = tfCanonicalModel(m.name);
        if (!name) continue;
        if (key.includes(name) || name.includes(key)) return { ...m, matchedBy: 'fuzzy', matchedName: m.name };
    }
    return { ...TF_EMPTY_PRICE, name: model, matchedBy: 'none', matchedName: null };
}

/**
 * 计算一次请求的费用（USD 原始 + 换算后显示货币）
 */
function calcCost(settings, model, inTok, outTok, cachedTok, requests = 1) {
    const price = getPriceFor(settings, model);
    const tokenCost =
        (inTok / 1e6) * (price.input || 0) +
        (outTok / 1e6) * (price.output || 0) +
        (cachedTok / 1e6) * (price.cached || 0);
    const reqCost = (price.perRequest || 0) * requests;
    const rawUsd = tokenCost + reqCost;
    const mult = (typeof price.multiplier === 'number' && price.multiplier > 0) ? price.multiplier : 1;
    const usd = rawUsd * mult;
    return {
        usd,
        display: usd * settings.exchangeRate,
        price,
        multiplier: mult,
    };
}

function fmtMoney(settings, usd) {
    const val = usd * settings.exchangeRate;
    if (val === 0) return `${settings.displayCurrency}0`;
    if (Math.abs(val) >= 1000) return `${settings.displayCurrency}${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    if (Math.abs(val) >= 1) return `${settings.displayCurrency}${val.toFixed(3)}`;
    return `${settings.displayCurrency}${val.toFixed(6)}`;
}

function fmtTokens(n) {
    if (!n) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
}

/* ============================================================
 *  数据记录（累计 + 会话双桶）
 * ============================================================ */

function recordUsage(model, inTok, outTok, cachedTok, isEstimate, requests = 1) {
    const s = getSettings();
    if (!s.enabled) return;

    const key = String(model || 'unknown');
    let cost = { usd: 0 };

    for (const bucketName of ['stats', 'session']) {
        const bucket = s[bucketName];
        if (!bucket.models[key]) {
            bucket.models[key] = { in: 0, out: 0, cached: 0, req: 0, cost: 0, est: 0, unpriced: 0 };
        }
        const m = bucket.models[key];
        m.in += inTok || 0;
        m.out += outTok || 0;
        m.cached += cachedTok || 0;
        m.req += requests;
        if (isEstimate) m.est += 1;

        cost = calcCost(s, key, inTok, outTok, cachedTok, requests);
        m.cost += cost.usd;
        if (cost.price && cost.price.matchedBy === 'none') m.unpriced = (m.unpriced || 0) + 1;
        if (cost.price && cost.price.matchedBy === 'fuzzy') m.fuzzyMatched = cost.price.matchedName || '';

        bucket.totalTokens = (bucket.totalTokens || 0) + (inTok || 0) + (outTok || 0) + (cachedTok || 0);
        bucket.totalRequests = (bucket.totalRequests || 0) + requests;
        bucket.totalCost = (bucket.totalCost || 0) + cost.usd;
    }

    if (cost.price && cost.price.matchedBy === 'none') tfNotifyUnpricedModel(key, s);
    recordRPM(s, requests);
    recordDailyUsage(s, cost.usd, inTok + outTok + cachedTok, requests, isEstimate);
    // 按模型累计到当天：补上单价后，今日费用与历史归档都能被重算
    if (!s.dailyStats.models || typeof s.dailyStats.models !== 'object') s.dailyStats.models = {};
    if (!s.dailyStats.models[key]) {
        // 字段要和 stats / session 的桶保持一致：之前这里漏了 est / unpriced，
        // 导致「含估算」在 今天 / 7 天 / 30 天 视图里永远是 0（只有「全部」是对的）
        s.dailyStats.models[key] = { in: 0, out: 0, cached: 0, req: 0, cost: 0, est: 0, unpriced: 0 };
    }
    const dailyModel = s.dailyStats.models[key];
    dailyModel.in += inTok || 0;
    dailyModel.out += outTok || 0;
    dailyModel.cached += cachedTok || 0;
    dailyModel.req += requests;
    // 费用必须一起累加：之前这里只加了 in/out/cached/req/est/unpriced，
    // 漏了 cost，于是「今天」的按模型费用恒为 0 —— 当天明细全是 $0，
    // 而且 近7天/近30天 的合计会整块少算今天这一天的钱。
    dailyModel.cost = (dailyModel.cost || 0) + cost.usd;
    if (isEstimate) dailyModel.est = (dailyModel.est || 0) + 1;
    if (cost.price && cost.price.matchedBy === 'none') dailyModel.unpriced = (dailyModel.unpriced || 0) + 1;
    checkBudgetAlert(s, cost.usd);
    maybeArchive(s);

    saveSettingsDebounced();
    safeUpdateUI();
    updateOrbBadge();
    maybeDailyReport();
    return cost;
}

/* ============================================================
 *  v1.1.0 新增：每日/历史归档、预算、趋势、上下文监控
 * ============================================================ */

function _todayStr(d = new Date()) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

/* ============================================================
 *  v1.5.0 · RPM（每分钟请求数）滑动窗口统计
 *  - window: 最近 60 秒内的请求时间戳队列（环形裁剪）
 *  - getRPM()   : 实时速率 = 最近 60 秒请求数（等效每分钟）
 *  - recordRPM(): 压入时间戳，裁剪过期项，更新峰值
 * ============================================================ */
const RPM_WINDOW_MS = 60 * 1000;   // 滑动窗口：60 秒

// v2.2.0：RPM 是纯瞬时数据，改为只存内存。旧版把最多 500 个时间戳
// 放进了 settings，并随每次请求 saveSettingsDebounced 落盘，settings.json
// 会一直膨胀。s.rpm 保留为兼容字段，但不再被写入。
const TF_RPM = { window: [], peak: 0 };

function _normRPM(s) {
    return TF_RPM;   // getRPM / recordRPM 都通过它拿窗口，无需改动
}

// 实时 RPM：最近 60 秒内的请求数（滑窗），��做惰性裁剪
function getRPM(s) {
    const r = _normRPM(s);
    const now = Date.now();
    const cutoff = now - RPM_WINDOW_MS;
    r.window = r.window.filter(t => t > cutoff);
    return r.window.length;
}

// 记录一次请求：压入时间戳，裁剪窗口，更新峰值 & 会话平均
function recordRPM(s, requests = 1) {
    if (!requests || requests <= 0) return;
    const r = _normRPM(s);
    const now = Date.now();
    const cutoff = now - RPM_WINDOW_MS;
    // 批量压入 requests 个时间戳（记录真正的请求次数）
    for (let i = 0; i < requests && i < 200; i++) r.window.push(now);
    // 裁剪过期项（保持队列 <= 60s + 200 上限，防止异常膨胀）
    r.window = r.window.filter(t => t > cutoff).slice(-500);
    const live = r.window.length;
    if (live > r.peak) r.peak = live;
    return live;
}

// 每日统计：按自然日累积
function recordDailyUsage(s, costUsd, tokens, req, isEstimate) {
    if (!s.dailyStats || typeof s.dailyStats !== 'object') s.dailyStats = { cost: 0, tokens: 0, req: 0 };
    s.dailyStats.cost = (s.dailyStats.cost || 0) + costUsd;
    s.dailyStats.tokens = (s.dailyStats.tokens || 0) + (tokens || 0);
    s.dailyStats.req = (s.dailyStats.req || 0) + (req || 0);
    // 会话开始日期追踪（用于换天重置）
    s.dailyStats.date = s.dailyStats.date || _todayStr();
    if (s.dailyStats.date !== _todayStr()) {
        s.dailyStats = { cost: costUsd, tokens: tokens || 0, req: req || 0, date: _todayStr(), est: isEstimate ? 1 : 0 };
    } else if (isEstimate) {
        s.dailyStats.est = (s.dailyStats.est || 0) + 1;
    }
}

// 预算预警：超过 80%/100% 阈值 → 悬浮球角标
// 旧版只置位、从不清除，角标一旦变成「!」就永远是「!」，跨天也不恢复。
function checkBudgetAlert(s, costUsd) {
    if (!s.budget || !s.budget.enabled) { clearOrbAlert(); return; }
    const dailyLimit = s.budget.dailyLimit || 0;
    const monthlyLimit = s.budget.monthlyLimit || 0;
    const dailyCost = tfTodayStats(s).cost || 0;
    // history 里「今天」那条也是当天总额，排除它、直接加 dailyCost，避免今日计两次
    const monthStr = _todayStr().slice(0, 7);
    const todayKey = _todayStr();
    const monthlyCost = s.history.filter(h => h.date !== todayKey && (h.date || '').startsWith(monthStr))
        .reduce((a, h) => a + (h.cost || 0), 0) + dailyCost;

    let alertMode = null;
    if (dailyLimit > 0 && dailyCost >= dailyLimit) alertMode = 'over_daily';
    else if (monthlyLimit > 0 && monthlyCost >= monthlyLimit) alertMode = 'over_month';
    else if (dailyLimit > 0 && dailyCost >= dailyLimit * 0.8) alertMode = 'warn_daily';
    else if (monthlyLimit > 0 && monthlyCost >= monthlyLimit * 0.8) alertMode = 'warn_month';

    if (alertMode) setOrbAlert(alertMode);
    else clearOrbAlert();
}

// 按日归档：每日记账一条，保留 archiveDays
function maybeArchive(s) {
    // v2.2.0：不再受 autoArchive 开关影响 —— 7 天 / 30 天 / 全部 视图都依赖按日历史，
    // 关掉归档等于把这些视图直接变空。（每天一条记录，开销可以忽略）
    const today = _todayStr();
    if (!Array.isArray(s.history)) s.history = [];
    let rec = s.history.find(h => h.date === today);
    if (!rec) {
        rec = { date: today, cost: 0, tokens: 0, req: 0 };
        s.history.push(rec);
    }
    // dailyStats 是「当天累计值」，所以这里是快照赋值而不是累加。
    // 旧版用 += 反复叠加当天总额，n 次请求后会膨胀成 n(n+1)/2 倍。
    rec.cost = (s.dailyStats ? s.dailyStats.cost : 0);
    rec.tokens = (s.dailyStats ? s.dailyStats.tokens : 0);
    rec.req = (s.dailyStats ? s.dailyStats.req : 0);
    // 一并存下当天的按模型用量，以后补价格时这条历史记录也能重算
    if (s.dailyStats && s.dailyStats.models) rec.models = structuredClone(s.dailyStats.models);
    // 保留最近 N 天
    // archiveDays 可能被脏数据写成字符串/对象 → NaN → 会把全部历史（含今天）删光，
    // 而且每次请求都再删一次。解析不出日期的行也保留，不静默丢。
    const keepDays = Number(s.archiveDays);
    const cutoff = Date.now() - (Number.isFinite(keepDays) && keepDays > 0 ? keepDays : 365) * 86400000;
    s.history = s.history.filter((h) => {
        if (!h || !h.date) return false;
        const ts = new Date(h.date + 'T00:00:00').getTime();
        return Number.isFinite(ts) ? ts >= cutoff : true;
    });
}

// 上下文占用监控（估算当前聊天上下文 token 占用比例）
function contextUsagePercent() {
    const s = getSettings();
    const ctx = s.contextSize || 128000;
    const chatArr = (() => { try { return getContext()?.chat || globalThis.chat || []; } catch { return []; } })();
    let est = 0;
    if (Array.isArray(chatArr)) {
        for (const msg of chatArr) {
            if (!msg || typeof msg !== 'object') continue;
            est += estimateTokens(msg.mes || msg.content || msg.name || '');
        }
    }
    return { used: est, limit: ctx, pct: Math.min(100, (est / ctx) * 100) };
}

// 浮动球角标
function setOrbAlert(mode) {
    const s = getSettings();
    if (s.showOrb === false) return;
    const orbBadge = document.getElementById('token_flow_orb_badge');
    if (!orbBadge) return;
    orbBadge.style.display = '';
    orbBadge.textContent = '!';
    orbBadge.classList.add('tf-alert');
    orbBadge.setAttribute('data-mode', mode);
}

function clearOrbAlert() {
    const orbBadge = document.getElementById('token_flow_orb_badge');
    if (orbBadge) { orbBadge.style.display = 'none'; orbBadge.classList.remove('tf-alert'); }
}

function updateOrbBadge() {
    const s = getSettings();
    if (s.showOrb === false) { clearOrbAlert(); return; }
    const badge = document.getElementById('token_flow_orb_badge');
    if (!badge) return;
    const dailyCost = (s.dailyStats && s.dailyStats.cost) || 0;
    // 有预算预警时显示预警角标，否则显示今日费用
    if (badge.classList.contains('tf-alert')) return;
    if (dailyCost > 0) {
        badge.style.display = '';
        badge.textContent = fmtMoney(s, dailyCost);
    } else {
        badge.style.display = 'none';
    }
}

// 每日用量简报（写入聊天流提示，可关闭）
function maybeDailyReport() {
    const s = getSettings();
    const today = _todayStr();
    if (s.lastDailyReport === today) return;
    // 仅当日有记录时展示一次 —— 先判断再落标记，
    // 旧版先把日期标记写上，于是当天永远等不到「有数据」的那一刻。
    if (!s.dailyStats || (s.dailyStats.cost || 0) <= 0) return;
    s.lastDailyReport = today;
    console.log(`[SillyToken] 今日用量简报: ${fmtMoney(s, s.dailyStats.cost)} · ${fmtTokens(s.dailyStats.tokens)} tokens · ${s.dailyStats.req} 请求`);
}

/* ============================================================
 *  本地估算兜底（中英混合字符估算）
 * ============================================================ */

function estimateTokens(text) {
    if (!text) return 0;
    const str = String(text);
    const cjk = (str.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
    const other = str.length - cjk;
    return Math.max(1, Math.round(cjk * 0.9 + other / 4));
}

/* ============================================================
 *  Fetch 拦截：捕获真实 API usage（monkey-patch window.fetch）
 * ============================================================ */

function extractUsageFromBody(body) {
    if (!body) return null;
    const usage = body.usage || body.data?.usage || body.choices?.[0]?.usage || body.completions?.[0]?.usage;
    if (!usage) return null;
    const rawPrompt = usage.prompt_tokens ?? usage.input_tokens ?? usage.input ?? 0;
    const outTok = usage.completion_tokens || usage.output_tokens || usage.output || 0;
    const cacheRead = usage.prompt_cache_hit_tokens
        ?? usage.prompt_tokens_details?.cached_tokens
        ?? usage.cache_read_input_tokens
        ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;

    // 各家语义不同，先归一化再计价：
    //   OpenAI / DeepSeek：prompt_tokens 已含缓存命中 → 未命中 = prompt - 命中
    //   Anthropic：input_tokens 既不含命中也不含写入 → 未命中 = input + 写入
    // 旧版用一条 `||` 链把「缓存命中」和「缓存写入」混成同一个数：两者同时
    // 出现时 cache_read 会被丢掉，而写入的 token 又完全没进账。
    const promptIncludesCache = usage.prompt_cache_hit_tokens != null
        || usage.prompt_tokens_details?.cached_tokens != null
        || (usage.prompt_tokens != null && usage.cache_read_input_tokens == null);
    const inUncached = promptIncludesCache
        ? Math.max(0, rawPrompt - cacheRead)
        : rawPrompt + cacheWrite;

    const totalTok = usage.total_tokens || (inUncached + outTok + cacheRead);
    if (!totalTok && !inUncached && !outTok) return null;
    return { in: inUncached, out: outTok, cached: cacheRead };
}

/* ============================================================
 *  v2.0.0 · 通用请求捕获层
 *
 *  旧版只在「主窗口」patch 一次 fetch，只能看到主窗口发出的、URL 正好
 *  含生成端点的请求。漏掉的路径：
 *    · 酒馆助手的脚本 / 前端界面运行在 iframe 里（无沙盒 iframe），
 *      那是另一个 window，有自己的 fetch / XMLHttpRequest
 *    · jQuery $.ajax / axios 走 XMLHttpRequest，不经过 fetch；
 *      而酒馆助手脚本里的 $ 还是 window.parent.$，所以打的是主页面那个
 *    · TavernHelper.generateRaw() 等宿主函数，网络层可能不出现 fetch
 *    · TauriTavern / 其它扩展会重写 window.fetch —— 一次普通赋值就把
 *      旧版的捕获层整个丢掉，而它自己并不知道
 *
 *  本版改为「每个同源 window 都装一遍」，对每个 window 装上：
 *    fetch(属性访问器) / XMLHttpRequest / TavernHelper.generateRaw
 *  再用 500ms 看门狗周期补装，防止被宿主覆盖或 iframe 重建后失效。
 *
 *  跨层去重：宿主函数先建一条「待认领」记录，内层 fetch/XHR 看到同一次
 *  生成时把它认领走，于是只记一条、且带真实 usage；若内层网络层始终
 *  不可见，则按本地估算兜底（isEstimate=true，面板显示「含估算」）。
 * ============================================================ */

const CAPTURE_WATCHDOG_MS = 500;
const CAPTURE_PENDING_TTL_MS = 8000;

const CAPTURE_STATS = {
    windows: 0,
    seen: 0,        // 识别到的生成请求次数
    recorded: 0,    // 拿到真实 usage 记账的次数
    estimated: 0,   // 走本地估算兜底的次数
    missed: 0,      // 既没 usage 也没兜底的次数
    lastMissed: [],
};

// 只认真正的生成端点。绝不能写成 '/api/backends/' 前缀 —— 那样
// /api/backends/chat-completions/status 这类状态查询也会被当成生成请求，
// 一旦开着估算兜底就会凭空记账、把用量算虚。
function isCaptureTarget(url) {
    const u = String(url || '');
    return u.includes('/backends/') && u.includes('/generate');
}

function pushCaptureMiss(url, model, reason) {
    CAPTURE_STATS.lastMissed.push({
        at: new Date().toLocaleTimeString(),
        url: String(url || '').slice(0, 160),
        model: String(model || '?').slice(0, 60),
        reason: String(reason || ''),
    });
    while (CAPTURE_STATS.lastMissed.length > 10) CAPTURE_STATS.lastMissed.shift();
}

/**
 * 「精确追踪」开关必须在调用时读，不能只在启动时读一次。
 *
 * 旧版把判断写在 initialize() 里（if (settings.trackExact) installCaptureLayer()），
 * 于是：启动后再勾上 = 抓取层永远不会装（用户以为开了，其实一条都不记）；
 * 取消勾选 = 拦截器照旧在跑（用户以为关了，其实还在抓）。
 *
 * 关掉时不做卸载，而是让补丁层直接透传：抢回 window.fetch 很可能把别的
 * 扩展后来包的层一起丢掉，透传则只影响我们自己。
 */
function captureEnabled() {
    try {
        const s = getSettings();
        return !s || s.trackExact !== false;
    } catch { return true; }
}

/* ---------- 窗口发现：自身 + parent + top + 递归同源 iframe ---------- */

function safeSelfWindow() {
    try { return typeof window === 'undefined' ? null : window; } catch { return null; }
}

function safeRelatedWindow(key) {
    try { return window[key] || null; } catch { return null; }
}

function canReachWindow(win) {
    try { void win.location.href; return true; } catch { return false; }
}

function collectCaptureWindows() {
    const found = [];
    const add = (win) => {
        if (!win || found.includes(win)) return;
        if (!canReachWindow(win)) return;   // 跨域 iframe 够不到，直接放弃
        found.push(win);
        let frames = [];
        try { frames = Array.from(win.document?.querySelectorAll?.('iframe,frame') || []); } catch { frames = []; }
        for (const frame of frames) {
            let child = null;
            try { child = frame?.contentWindow || null; } catch { child = null; }
            if (child) add(child);
        }
    };
    add(safeSelfWindow());
    add(safeRelatedWindow('parent'));
    add(safeRelatedWindow('top'));
    return found;
}

function getCapturePatchState(win) {
    let state = null;
    try { state = win.__sillyTokenPatch || null; } catch { return null; }
    if (!state) {
        state = {
            delegateFetch: null,
            bypassFetch: null,      // 最原始的 fetch：深度保护时用它，避免与宿主包装互相递归
            patchedFetch: null,
            fetchAccessor: false,
            fetchDepth: 0,
            patchedXHR: null,
            hostPatches: [],
        };
        try { win.__sillyTokenPatch = state; } catch { return null; }
    }
    return state;
}

/* ---------- 载荷归一化（fetch / XHR / 宿主函数统一成 messages） ---------- */

function contentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (typeof part === 'string') return part;
            if (!part || typeof part !== 'object') return '';
            if (typeof part.text === 'string') return part.text;
            if (typeof part.content === 'string') return part.content;
            return '';
        }).join('');
    }
    if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
    return '';
}

function toMessageSnapshot(item) {
    if (typeof item === 'string') return { role: 'user', text: item };
    if (!item || typeof item !== 'object') return { role: 'unknown', text: '' };
    const role = typeof item.role === 'string' ? item.role : 'user';
    return { role, text: contentToText(item.content ?? item.text ?? item.prompt ?? '') };
}

function promptLikeToSnapshots(value) {
    if (typeof value === 'string') return value ? [{ role: 'user', text: value }] : [];
    if (!Array.isArray(value)) return [];
    return value.map(toMessageSnapshot).filter((m) => m.text);
}

function normalizeMessages(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.messages)) return payload.messages.map(toMessageSnapshot).filter((m) => m.text);
    if (Array.isArray(payload.ordered_prompts)) {
        return payload.ordered_prompts.map(toMessageSnapshot).filter((m) => m.text);
    }

    const out = [];
    out.push(...promptLikeToSnapshots(payload.prompt));
    out.push(...promptLikeToSnapshots(payload.user_input));
    if (typeof payload.input === 'string') {
        if (payload.input) out.push({ role: 'user', text: payload.input });
    } else if (Array.isArray(payload.input)) {
        out.push(...payload.input.map(toMessageSnapshot).filter((m) => m.text));
    }
    if (Array.isArray(payload.contents)) {
        for (const content of payload.contents) {
            if (!content || typeof content !== 'object') continue;
            const role = content.role === 'model' ? 'assistant' : (typeof content.role === 'string' ? content.role : 'user');
            const text = contentToText(content.parts ?? content.content ?? content.text ?? '');
            if (text) out.push({ role, text });
        }
    }
    return out;
}

function hashText(text) {
    const str = String(text || '');
    let hash = 5381;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    return (hash >>> 0).toString(36);
}

// 用「条数 + 首条 + 末条」做指纹，避免整段 prompt 参与比较
function messagesDigest(messages) {
    if (!messages || !messages.length) return '';
    const first = messages[0];
    const last = messages[messages.length - 1];
    return [
        messages.length,
        hashText(first.role + ':' + first.text),
        hashText(last.role + ':' + last.text),
    ].join('|');
}

function pickModelFor(payload, win) {
    if (payload && typeof payload.model === 'string' && payload.model.trim()) return payload.model.trim();
    try {
        const ctx = win?.SillyTavern?.getContext?.() || globalThis.SillyTavern?.getContext?.();
        const settings = ctx?.chatCompletionSettings || {};
        return settings.openai_model || settings.claude_model || settings.google_model
            || settings.windowai_model || ctx?.main_api || 'tavern-helper';
    } catch { return 'tavern-helper'; }
}

/* ---------- 捕获记录的创建 / 认领 / 结算 ---------- */

let captureSeq = 0;
let pendingCaptures = [];

function prunePendingCaptures(now = Date.now()) {
    pendingCaptures = pendingCaptures.filter((c) => !c.done && now - c.at <= CAPTURE_PENDING_TTL_MS * 2);
}

/**
 * claimable = true  由宿主函数层创建，等待内层网络层认领
 * claimable = false 由 fetch / XHR 创建；先尝试认领宿主层留下的那条
 */
function acquireCapture(payload, url, win, claimable) {
    const messages = normalizeMessages(payload);
    const digest = messagesDigest(messages);
    const now = Date.now();
    prunePendingCaptures(now);

    if (!claimable) {
        const candidates = pendingCaptures.filter((c) => c.claimable && !c.claimed && !c.done
            && now - c.at <= CAPTURE_PENDING_TTL_MS);
        if (candidates.length) {
            const exact = digest ? candidates.find((c) => c.digest && c.digest === digest) : null;
            // 指纹对不上时（宿主函数的 prompt 与最终发出的 messages 常常不同），
            // 按「先进先出」认领最早那条：宿主调用与它内部发出的请求是同一个顺序，
            // 所以最早建的待认领记录对应对早发出的那次请求。
            //
            // 这里踩过两个坑，都别改回去：
            //   · 要求「候选唯一」→ 宿主先 await 再发请求时两条记录同时存在，
            //     于是谁都认领不到，同一次生成被 fetch 记一遍、又被宿主估算记一遍。
            //   · 认领「最近创建」的那条 → 第一次 fetch 会认领到后一次调用的记录，
            //     把自己那条晾着，结果一样是重复记账。
            const chosen = exact || candidates[0];
            chosen.claimed = true;
            tfLog('info', 'capture.claim', '内层网络层认领了宿主层的待认领记录', {
                layer: String(url || '').slice(0, 60),
                candidates: candidates.length,
                exact: !!exact,
                hostId: chosen.id,
            });
            return chosen;
        }
    }

    const capture = {
        id: 'tf_' + now + '_' + (++captureSeq),
        at: now,
        url: String(url || '').slice(0, 160),
        model: pickModelFor(payload, win),
        digest,
        messages,
        stream: !!(payload && payload.stream),
        claimable: !!claimable,
        claimed: !claimable,
        done: false,
    };
    pendingCaptures.push(capture);
    CAPTURE_STATS.seen += 1;
    tfLog('info', 'capture.acquire', claimable ? '宿主层建立待认领记录' : '建立捕获记录', {
        layer: String(url || '').slice(0, 60),
        id: capture.id,
        model: capture.model,
        messages: messages.length,
    });
    return capture;
}

/**
 * 结算一条捕获，三种结局互斥、不会既算估算又算丢失：
 *   有真实 usage                      → 记账（精确）
 *   请求成功但没 usage + 开了估算兜底   → 用 estimateTokens 估算记账（isEstimate）
 *   其余（失败 / 没 usage 且关了兜底）  → 只计一笔「未捕获」，供面板诊断
 *
 * 注意：失败路径一律传 estimate:false。给失败请求凭空估算等于编数字。
 */
function finishCapture(capture, options = {}) {
    if (!capture || capture.done) return;
    capture.done = true;

    if (options.usage) {
        const cost = recordUsage(capture.model, options.usage.in, options.usage.out, options.usage.cached, false);
        CAPTURE_STATS.recorded += 1;
        tfLog('info', 'capture.recorded', capture.model, {
            layer: capture.url,
            in: options.usage.in,
            out: options.usage.out,
            cached: options.usage.cached,
            usd: cost ? Number((cost.usd || 0).toFixed(6)) : 0,
            price: cost?.price ? (cost.price.matchedBy + (cost.price.matchedName ? ':' + cost.price.matchedName : '')) : 'none',
        });
        prunePendingCaptures();
        return;
    }

    const reason = options.reason || '未取到 usage';

    // 先尝试估算兜底：估算了就不计入「未捕获」，
    // 否则诊断条会把每一次估算同时报成一次丢失，数字自相矛盾。
    let settings = null;
    try { settings = getSettings(); } catch { settings = null; }
    const canEstimate = !!(settings && settings.useFallback && options.estimate !== false);

    if (canEstimate) {
        const inTok = capture.messages.reduce((sum, m) => sum + estimateTokens(m.text), 0);
        const outTok = estimateTokens(options.outputText || '');
        if (inTok > 0 || outTok > 0) {
            const cost = recordUsage(capture.model, inTok, outTok, 0, true);
            CAPTURE_STATS.estimated += 1;
            tfLog('warn', 'capture.estimated', capture.model, {
                layer: capture.url, reason, in: inTok, out: outTok,
                usd: cost ? Number((cost.usd || 0).toFixed(6)) : 0,
            });
            prunePendingCaptures();
            return;
        }
    }

    CAPTURE_STATS.missed += 1;
    pushCaptureMiss(capture.url, capture.model, reason);
    tfLog('warn', 'capture.missed', capture.model, { layer: capture.url, reason });
    prunePendingCaptures();
}

/* ---------- 响应解析 ---------- */

async function trackStreamResponse(response, capture) {
    let text = '';
    try {
        const reader = response.clone().body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let usage = null;
        let sawDone = false;

        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split(/\r?\n\r?\n/);   // 兼容 CRLF 分隔的 SSE
            buffer = parts.pop();

            for (const chunk of parts) {
                if (sawDone) continue;
                const line = chunk.split(/\r?\n/).find((l) => l.startsWith('data:'));
                if (!line) continue;
                const data = line.slice(5).trim();
                if (!data) continue;
                if (data === STREAM_DONE) { sawDone = true; break; }
                try {
                    const json = JSON.parse(data);
                    const found = extractUsageFromBody(json);
                    if (found) usage = found;
                    if (json.model) capture.model = json.model;
                    const piece = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
                    if (typeof piece === 'string') text += piece;
                } catch { /* 片段 JSON，跳过 */ }
            }
        }

        finishCapture(capture, usage ? { usage } : { outputText: text, reason: '流式结束但没收到 usage chunk' });
    } catch (error) {
        finishCapture(capture, { reason: '流读取失败: ' + (error?.message || error), estimate: false });
    }
}

function trackResponse(response, capture) {
    try {
        // 非 2xx 不计用量，也不走估算（错误响应里那点文本没有计费意义）
        if (response && response.ok === false) {
            finishCapture(capture, { reason: 'HTTP ' + response.status, estimate: false });
            return;
        }
        const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
        const isStream = contentType.includes('text/event-stream') || capture.stream === true;
        if (isStream && response.body && typeof response.body.getReader === 'function') {
            void trackStreamResponse(response, capture);
            return;
        }
        response.clone().json().then((json) => {
            const usage = extractUsageFromBody(json);
            if (json && typeof json.model === 'string' && json.model) capture.model = json.model;
            finishCapture(capture, usage ? { usage } : { reason: '响应里没有 usage 字段' });
        }).catch(() => finishCapture(capture, { reason: '响应不是 JSON' }));
    } catch (error) {
        finishCapture(capture, { reason: '响应解析异常: ' + (error?.message || error) });
    }
}

async function readRequestPayload(input, init) {
    const body = init?.body;
    if (typeof body === 'string') {
        try { return JSON.parse(body); } catch { return null; }
    }
    if (body && typeof body === 'object' && typeof body !== 'function') {
        try { return JSON.parse(JSON.stringify(body)); } catch { return null; }
    }
    // Request 对象：clone 一份再读，不消费原请求体
    if (input && typeof input === 'object' && typeof input.clone === 'function') {
        try { return JSON.parse(await input.clone().text()); } catch { return null; }
    }
    return null;
}

function resolveRequestUrl(input) {
    try {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return String(input);
    } catch { return ''; }
}

/* ---------- 层 1：fetch（用属性访问器，宿主重写也逃不掉） ---------- */

/**
 * 透传（不记账）也必须走深度保护。
 *
 * 宿主有时会把 fetch 包成「转调我们这一层」：`const o = fetch; fetch = (...a) => o(...a)`。
 * 这种情况下 state.delegateFetch 绕回我们自己的 patchedFetch ——
 * 旧版直接 `return state.delegateFetch(...args)`，于是在
 *   · 请求不是生成端点（状态查询、其它 API），或
 *   · 精确追踪开关被关掉
 * 时会自己调自己，一路递归到栈溢出，而这个异常发生在别人的 await 里，
 * 面板上只会看到请求全部失败。
 *
 * 深度 >0 时改调最初那个 fetch（bypassFetch），环路就断开了。
 */
function passthroughFetch(state, args) {
    if (state.fetchDepth > 0) return (state.bypassFetch || state.delegateFetch)(...args);
    state.fetchDepth += 1;
    try { return state.delegateFetch(...args); } finally { state.fetchDepth -= 1; }
}

function patchFetchOnWindow(win, state) {
    let current = null;
    try { current = typeof win.fetch === 'function' ? win.fetch : null; } catch { return; }
    // 只以「当前 fetch 是不是我们包的那层」为准，不能拿 fetchAccessor 标志当一劳永逸：
    // 宿主若用 Object.defineProperty 把访问器顶掉，标志还是 true，看门狗就再也装不回来了。
    if (!current || current === state.patchedFetch) return;

    const bound = current.bind(win);
    if (!state.bypassFetch) state.bypassFetch = bound;
    state.delegateFetch = bound;
    state.patchedFetch = createPatchedFetch(win, state);
    state.fetchAccessor = false;

    if (!installFetchAccessor(win, state)) {
        try { win.fetch = state.patchedFetch; } catch { /* 宿主冻结了，放弃这一层 */ }
    }
}

function createPatchedFetch(win, state) {
    return async function patchedFetch(...args) {
        // 深度保护走 bypassFetch（最初那个），不能走 delegateFetch：
        // 宿主若写 `const o = fetch; fetch = (...a) => o(...a)`，delegateFetch
        // 就是那个包装，两者会互相调用到栈溢出。
        if (state.fetchDepth > 0) return (state.bypassFetch || state.delegateFetch)(...args);

        const input = args[0];
        const init = args[1];
        const url = resolveRequestUrl(input);
        // 开关关掉时直接透传：补丁还挂在 fetch 上，但不解析 payload、不建记录。
        if (!captureEnabled() || !isCaptureTarget(url)) return passthroughFetch(state, args);

        const payload = await readRequestPayload(input, init);
        const capture = acquireCapture(payload, url, win, false);

        // 守卫只覆盖「同步派发」这一段。旧版让它跨越整个 await，
        // 于是模型思考期间（10-60 秒）由别的脚本发出的第二个请求会走 bypass 分支，
        // 既不记 seen 也不记 missed —— 直接漏记。
        state.fetchDepth += 1;
        let pending;
        try {
            // 只调用一次。旧版在这里的 catch 之后还会再调一次 originalFetch，
            // 网络失败或用户点「停止」产生 AbortError 时会把同一个请求重发一遍。
            pending = state.delegateFetch(...args);
        } finally {
            state.fetchDepth -= 1;
        }
        let response;
        try {
            response = await pending;
        } catch (error) {
            finishCapture(capture, { reason: '请求失败: ' + (error?.message || error), estimate: false });
            throw error;
        }

        trackResponse(response, capture);
        return response;
    };
}

function installFetchAccessor(win, state) {
    try {
        const descriptor = Object.getOwnPropertyDescriptor(win, 'fetch');
        if (descriptor && descriptor.configurable === false) return false;

        Object.defineProperty(win, 'fetch', {
            configurable: true,
            enumerable: descriptor?.enumerable ?? true,
            get() { return state.patchedFetch; },
            set(nextFetch) {
                if (typeof nextFetch !== 'function' || nextFetch === state.patchedFetch) return;
                state.bypassFetch ??= state.delegateFetch;
                state.delegateFetch = nextFetch.bind(win);
                tfLog('info', 'capture.fetchOverride', '宿主重写了 fetch，捕获层保持在最外层', { href: tfWindowHref(win) });
            },
        });
        state.fetchAccessor = true;
        return true;
    } catch {
        state.fetchAccessor = false;
        return false;
    }
}

/* ---------- 层 2：XMLHttpRequest（覆盖 axios / jQuery.ajax） ---------- */

function patchXhrOnWindow(win, state) {
    let current = null;
    try { current = typeof win.XMLHttpRequest === 'function' ? win.XMLHttpRequest : null; } catch { return; }
    if (!current || current === state.patchedXHR) return;

    const PatchedXhr = function SillyTokenXhr() {
        const xhr = new current();
        const rawOpen = xhr.open;
        const rawSend = xhr.send;
        let requestUrl = '';

        xhr.open = function patchedOpen(method, url, ...rest) {
            requestUrl = resolveRequestUrl(url);
            return rawOpen.call(xhr, method, url, ...rest);
        };
        xhr.send = function patchedSend(body) {
            if (captureEnabled() && isCaptureTarget(requestUrl)) {
                let payload = null;
                try { payload = typeof body === 'string' ? JSON.parse(body) : null; } catch { payload = null; }
                const capture = acquireCapture(payload, requestUrl, win, false);
                xhr.addEventListener('loadend', () => {
                    if (xhr.status >= 200 && xhr.status < 400) {
                        let json = null;
                        try { json = JSON.parse(xhr.responseText || ''); } catch { json = null; }
                        if (!json) {
                            finishCapture(capture, { reason: 'XHR 响应不是 JSON' });
                            return;
                        }
                        const usage = extractUsageFromBody(json);
                        if (json.model) capture.model = json.model;
                        finishCapture(capture, usage ? { usage } : { reason: 'XHR 响应里没有 usage 字段' });
                    } else {
                        finishCapture(capture, { reason: 'XHR 失败：HTTP ' + xhr.status, estimate: false });
                    }
                }, { once: true });
            }
            return rawSend.call(xhr, body ?? null);
        };
        return xhr;
    };

    try { PatchedXhr.prototype = current.prototype; } catch { /* 原型可能被冻结 */ }
    for (const key of Object.getOwnPropertyNames(current)) {
        if (key === 'length' || key === 'name' || key === 'prototype') continue;
        try { PatchedXhr[key] = current[key]; } catch { /* ignore */ }
    }

    try {
        win.XMLHttpRequest = PatchedXhr;
        state.patchedXHR = PatchedXhr;
    } catch { /* 宿主冻结了，放弃这一层 */ }
}

/* ---------- 层 3：TavernHelper.generateRaw 宿主函数 ---------- */

function generateRawArgsToPayload(args) {
    const options = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const messages = [
        ...promptLikeToSnapshots(options.prompt),
        ...promptLikeToSnapshots(options.ordered_prompts),
        ...promptLikeToSnapshots(options.user_input),
    ];
    const customApi = options.custom_api && typeof options.custom_api === 'object' ? options.custom_api : null;
    const model = (customApi && typeof customApi.model === 'string' && customApi.model)
        || (typeof options.model === 'string' ? options.model : '');
    return { messages, model, stream: !!options.should_stream };
}

function wrapHostStreamResult(capture, stream, settle) {
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return stream;
    return (async function* wrappedHostStream() {
        let text = '';
        try {
            for await (const value of stream) {
                if (typeof value === 'string') text += value;
                yield value;
            }
        } catch (error) {
            finishCapture(capture, { reason: '宿主流失败: ' + (error?.message || error), estimate: false });
            throw error;
        }
        settle(text);
    })();
}

function patchHostFunctionsOnWindow(win, state) {
    let helper = null;
    try { helper = win.TavernHelper || null; } catch { return; }
    if (!helper || typeof helper.generateRaw !== 'function') return;

    let entry = state.hostPatches.find((p) => p.key === 'generateRaw') || null;
    if (entry && helper.generateRaw === entry.patched) return;
    if (entry) {
        // 宿主每次换掉函数我们都得重新包一层，但如果对方是在包我们的补丁，
        // 这样会一层层叠加（两个窗口可达同一对象时 500ms 看门狗会让它无限增长）。
        // 给它一个上限，超过就不再叠。
        entry.wraps = (entry.wraps || 0) + 1;
        if (entry.wraps > 3) {
            tfLog('warn', 'capture.hostWrapLimit', '宿主反复改写 generateRaw，已达包装上限，停止叠加', { wraps: entry.wraps });
            return;
        }
        if (helper.generateRaw !== entry.original) entry.original = helper.generateRaw;
    }

    const original = entry ? entry.original : helper.generateRaw;
    const patched = function patchedGenerateRaw(...args) {
        if (!captureEnabled()) return original.apply(this, args);
        const payload = generateRawArgsToPayload(args);
        const capture = acquireCapture(payload, 'TavernHelper.generateRaw', win, true);

        let result;
        try {
            result = original.apply(this, args);
        } catch (error) {
            finishCapture(capture, { reason: '宿主函数抛错: ' + (error?.message || error), estimate: false });
            throw error;
        }

        // 内层 fetch/XHR 已经把这条认领走并写好 usage 时，这里什么都不做
        const settle = (value) => {
            if (capture.claimed || capture.done) return;
            finishCapture(capture, {
                outputText: typeof value === 'string' ? value : '',
                reason: '宿主函数调用未经过可见的网络层',
            });
        };

        if (result && typeof result.then === 'function') {
            result.then(
                (value) => settle(value),
                (error) => finishCapture(capture, { reason: '宿主函数失败: ' + (error?.message || error), estimate: false }),
            );
            return result;
        }
        if (result && typeof result.next === 'function') {
            return wrapHostStreamResult(capture, result, settle);
        }
        if (typeof result === 'function') {
            const factory = result;
            return function wrappedHostStreamFactory(...innerArgs) {
                return wrapHostStreamResult(capture, factory.apply(this, innerArgs), settle);
            };
        }
        settle(result);
        return result;
    };

    try {
        helper.generateRaw = patched;
        if (entry) entry.patched = patched;
        else state.hostPatches.push({ key: 'generateRaw', original, patched });
    } catch { /* 宿主可能冻结了 TavernHelper，放弃这一层 */ }
}

/* ---------- 安装 + 看门狗 ---------- */

let captureWatchdog = null;
let tfLastWindowCount = -1;

function installCaptureLayer() {
    const run = () => {
        let windows = [];
        try { windows = collectCaptureWindows(); } catch { windows = []; }
        CAPTURE_STATS.windows = windows.length;
        for (const win of windows) {
            const state = getCapturePatchState(win);
            if (!state) continue;
            try { patchFetchOnWindow(win, state); } catch { /* ignore */ }
            try { patchXhrOnWindow(win, state); } catch { /* ignore */ }
            try { patchHostFunctionsOnWindow(win, state); } catch { /* ignore */ }
        }
    };

    run();
    if (!captureWatchdog && typeof setInterval === 'function') {
        // 宿主会重写 fetch、iframe 会重建、预设切换会换掉函数 —— 周期补装
        captureWatchdog = setInterval(run, CAPTURE_WATCHDOG_MS);
    }
    if (tfLastWindowCount !== CAPTURE_STATS.windows) {
        tfLastWindowCount = CAPTURE_STATS.windows;
        // 只记窗口数：完整诊断快照由面板的「复制诊断」按钮提供，
        // 把整个对象塞进日志行会把那一行撑成一堵 JSON 墙。
        tfLog('info', 'capture.install', '捕获层就绪 · 窗口 ' + CAPTURE_STATS.windows + ' 个');
    }
}

// 兼容旧调用名
const installFetchInterceptor = installCaptureLayer;

function stopCaptureWatchdog() {
    if (!captureWatchdog) return;
    try { clearInterval(captureWatchdog); } catch { /* ignore */ }
    captureWatchdog = null;
}

/* ============================================================
 *  UI：设置面板
 * ============================================================ */

function makeInput(id, type, initial, oninput) {
    const inp = document.createElement('input');
    inp.id = id;
    inp.type = type;
    inp.value = initial;
    inp.className = 'text_pole';
    inp.addEventListener('input', oninput);
    return inp;
}

// v2.1.0：删除了 280 行死代码 addExtensionSettings()。它从未被调用，
// 却和在用的 addExtensionSettingsInto() 创建相同的元素 id（tf_currency /
// tf_rate 等），一旦被调用 getElementById 就会取到错误的那个元素。

/* ============================================================
 *  UI：统计 Dashboard
 * ============================================================ */

function updateDashboard() {
    applyTheme();
    // 优先渲染到悬浮球弹层（主统计页），回退到设置面板内嵌容器
    const el = document.getElementById('token_flow_panel_body') || document.getElementById('token_flow_dashboard');
    if (!el) return;
    const s = getSettings();
    if (!s.enabled) {
        el.innerHTML = '<div class="tf-dash-muted">' + safeT('统计已关闭') + '</div>';
        return;
    }

    const statCard = (label, value, sub) => {
        const card = document.createElement('div');
        card.className = 'tf-stat-card';
        const lab = document.createElement('div');
        lab.className = 'tf-stat-label';
        lab.textContent = label;
        const val = document.createElement('div');
        val.className = 'tf-stat-value';
        val.textContent = value;
        card.appendChild(lab);
        card.appendChild(val);
        if (sub) {
            const s2 = document.createElement('div');
            s2.className = 'tf-stat-sub';
            s2.textContent = sub;
            card.appendChild(s2);
        }
        return card;
    };

    const total = s.stats;
    const session = s.session;
    const totalTokens = (total.totalTokens || 0);
    const totalCost = (total.totalCost || 0);
    const totalReq = (total.totalRequests || 0);
    const sessTokens = (session.totalTokens || 0);
    const sessCost = (session.totalCost || 0);
    const sessReq = (session.totalRequests || 0);

    const grid = document.createElement('div');
    grid.className = 'tf-grid';

    grid.appendChild(statCard(safeT('累计费用'), fmtMoney(s, totalCost), s.displayCurrency));
    grid.appendChild(statCard(safeT('累计 Token'), fmtTokens(totalTokens), totalReq + ' ' + safeT('次请求')));
    grid.appendChild(statCard(safeT('会话费用'), fmtMoney(s, sessCost), s.displayCurrency));
    grid.appendChild(statCard(safeT('会话 Token'), fmtTokens(sessTokens), sessReq + ' ' + safeT('次请求')));
    // ============ v1.5.0：RPM & 请求速率 ============
    const rpmNow = getRPM(s);
    const rpmPeak = TF_RPM.peak || 0;
    const rpmSessAvg = s.sessionStartedAt ? (sessReq * 60000) / Math.max(1000, Date.now() - s.sessionStartedAt) : 0;
    const rpmSessAvgDisp = rpmSessAvg >= 1 ? Math.round(rpmSessAvg) : (rpmSessAvg > 0 ? rpmSessAvg.toFixed(1) : '0');
    grid.appendChild(statCard(safeT('实时 RPM'), rpmNow, safeT('峰值') + ' ' + rpmPeak));
    grid.appendChild(statCard(safeT('会话速率'), rpmSessAvgDisp + (rpmSessAvg>=1?'':'') + ' /min', safeT('峰值') + ' ' + rpmPeak + ' rpm'));

    // ============ 写作画像：字数 + 消息条数（实时统计当前聊天） ============
    const chatArr = (() => { try { return getContext()?.chat || globalThis.chat || []; } catch { return []; } })();
    let uChars = 0, cChars = 0, uMsgs = 0, cMsgs = 0;
    const _strip = (t) => String(t || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ');
    if (Array.isArray(chatArr)) {
        for (const msg of chatArr) {
            if (!msg || typeof msg !== 'object') continue;
            const isU = msg.is_user ? true : (msg.role === 'user');
            const body = _strip(msg.mes || msg.content || '');
            if (isU) { uChars += body.length; uMsgs++; }
            else { cChars += body.length; cMsgs++; }
        }
    }
    const allChars = uChars + cChars;
    const allMsgs = uMsgs + cMsgs;
    const classicBooks = [
        { name: '《红楼梦》', chars: 730000 },
        { name: '《三体》三部曲', chars: 900000 },
        { name: '《三国演义》', chars: 640000 },
        { name: '《活着》', chars: 120000 },
        { name: '《百年孤独》', chars: 300000 },
        { name: '《战争与和平》', chars: 1200000 },
    ];
    const theBook = tfPickStoryBook(classicBooks);   // 固定一本书，别每次重绘都换
    const bookQty = allChars > 0 ? (allChars / theBook.chars).toFixed(allChars / theBook.chars < 10 ? 2 : 1) : '0';

    const writingBlock = document.createElement('div');
    writingBlock.className = 'tf-writing';
    const wTitle = document.createElement('div');
    wTitle.className = 'tf-writing-title';
    wTitle.textContent = '✍ ' + safeT('写作画像');
    const wGrid = document.createElement('div');
    wGrid.className = 'tf-writing-grid';
    const cell = (label, val, hint) => {
        const d = document.createElement('div');
        d.className = 'tf-writing-cell';
        const v = document.createElement('div');
        v.className = 'tf-writing-val';
        v.textContent = val;
        const l = document.createElement('div');
        l.className = 'tf-writing-label';
        l.textContent = label;
        d.appendChild(v); d.appendChild(l);
        if (hint) { const t = document.createElement('div'); t.className = 'tf-writing-hint'; t.textContent = hint; d.appendChild(t); }
        return d;
    };
    wGrid.appendChild(cell(safeT('总字数'), allChars.toLocaleString(), safeT('约') + ' ' + allMsgs + ' ' + safeT('条消息')));
    wGrid.appendChild(cell(safeT('User 字数'), uChars.toLocaleString(), safeT('共') + ' ' + uMsgs + ' ' + safeT('条')));
    wGrid.appendChild(cell(safeT('角色字数'), cChars.toLocaleString(), safeT('共') + ' ' + cMsgs + ' ' + safeT('条')));
    wGrid.appendChild(cell(safeT('总消息'), allMsgs.toLocaleString(), safeT('User') + ' ' + uMsgs + ' · ' + safeT('角色') + ' ' + cMsgs));
    writingBlock.appendChild(wTitle);
    writingBlock.appendChild(wGrid);
    const wTip = document.createElement('div');
    wTip.className = 'tf-writing-tip';
    wTip.textContent = `🎯 ${allChars.toLocaleString()} ${safeT('字约相当于')} 【${theBook.name}】 ${bookQty} ${safeT('本')}`;
    writingBlock.appendChild(wTip);
    grid.appendChild(writingBlock);

    // v2.2.0：旧的 14 天趋势图（按数组下标画、缺日会错位）
    // 由 renderStatsPanel 取代：连续日期轴 + 点选某天看明细 + 范围切换
    renderStatsPanel(grid, s);

    // ============ v1.1.0：预算 + 上下文监控 ============
    const monoBlock = document.createElement('div');
    monoBlock.className = 'tf-mono';
    const monoGrid = document.createElement('div');
    monoGrid.className = 'tf-writing-grid';

    // 今日预算进度
    const dailyCostNow = tfTodayStats(s).cost || 0;
    const dailyLimit = (s.budget && s.budget.dailyLimit) || 0;
    const dPct = dailyLimit > 0 ? Math.min(100, (dailyCostNow / dailyLimit) * 100) : 0;
    const dCell = document.createElement('div');
    dCell.className = 'tf-writing-cell';
    dCell.innerHTML = `<div class="tf-writing-val">${fmtMoney(s, dailyCostNow)}</div><div class="tf-writing-label">${safeT('今日费用')}</div>`;
    if (dailyLimit > 0) {
        const dbar = document.createElement('div');
        dbar.className = 'tf-budget-bar';
        const dfill = document.createElement('div');
        dfill.className = 'tf-budget-fill' + (dPct >= 100 ? ' over' : dPct >= 80 ? ' warn' : '');
        dfill.style.width = dPct + '%';
        dbar.appendChild(dfill);
        dCell.appendChild(dbar);
        const dmeta = document.createElement('div');
        dmeta.className = 'tf-writing-hint';
        dmeta.textContent = `${safeT('日预算')} ${fmtMoney(s, dailyLimit)} · ${Math.round(dPct)}%`;
        dCell.appendChild(dmeta);
    }
    monoGrid.appendChild(dCell);

    // 上下文占用
    const ctx = contextUsagePercent();
    const cCell = document.createElement('div');
    cCell.className = 'tf-writing-cell';
    cCell.innerHTML = `<div class="tf-writing-val">${Math.round(ctx.pct)}%</div><div class="tf-writing-label">${safeT('上下文占用')}</div>`;
    const cbar = document.createElement('div');
    cbar.className = 'tf-budget-bar';
    const cfill = document.createElement('div');
    cfill.className = 'tf-budget-fill' + (ctx.pct >= 90 ? ' over' : ctx.pct >= 70 ? ' warn' : '');
    cfill.style.width = ctx.pct + '%';
    cbar.appendChild(cfill);
    cCell.appendChild(cbar);
    const cmeta = document.createElement('div');
    cmeta.className = 'tf-writing-hint';
    cmeta.textContent = `${fmtTokens(ctx.used)} / ${fmtTokens(ctx.limit)}`;
    cCell.appendChild(cmeta);
    monoGrid.appendChild(cCell);

    monoBlock.appendChild(monoGrid);
    grid.appendChild(monoBlock);
    // ============ v1.5.0：RPM 实时速率面板（可视化） ============
    const rpmBlock = document.createElement('div');
    rpmBlock.className = 'tf-rpm-panel';
    const rpmH = document.createElement('div');
    rpmH.className = 'tf-writing-title';
    rpmH.textContent = '⚡ ' + safeT('请求速率 (RPM)');
    rpmBlock.appendChild(rpmH);
    const rpmInner = document.createElement('div');
    rpmInner.className = 'tf-rpm-inner';
    // 大号实时数字 + 指示灯
    const rpmBig = document.createElement('div');
    rpmBig.className = 'tf-rpm-big';
    const dot = document.createElement('span');
    dot.className = 'tf-rpm-dot' + (rpmNow > 0 ? ' live' : '');
    const num = document.createElement('span');
    num.className = 'tf-rpm-num';
    num.textContent = rpmNow + (safeT('次/min'));
    const bigLab = document.createElement('span');
    bigLab.className = 'tf-rpm-biglab';
    bigLab.textContent = safeT('实时');
    rpmBig.appendChild(dot); rpmBig.appendChild(bigLab);
    rpmBig.appendChild(num);
    rpmInner.appendChild(rpmBig);
    // 峰值 + 会话均值
    const rpmMeta = document.createElement('div');
    rpmMeta.className = 'tf-rpm-meta';
    const mkMeta = (lab, val) => {
        const d = document.createElement('div');
        d.className = 'tf-writing-cell';
        const v = document.createElement('div');
        v.className = 'tf-writing-val';
        v.textContent = val;
        const l = document.createElement('div');
        l.className = 'tf-writing-label';
        l.textContent = lab;
        d.appendChild(v); d.appendChild(l);
        return d;
    };
    rpmMeta.appendChild(mkMeta(safeT('峰值'), rpmPeak));
    rpmMeta.appendChild(mkMeta(safeT('会话平均'), rpmSessAvgDisp));
    rpmMeta.appendChild(mkMeta(safeT('累计请求'), (s.stats.totalRequests||0).toLocaleString()));
    rpmInner.appendChild(rpmMeta);
    // 迷你速率条：按峰值归一化展示当前负载
    const barWrap = document.createElement('div');
    barWrap.className = 'tf-rpm-bar';
    const barFill = document.createElement('div');
    barFill.className = 'tf-rpm-bar-fill';
    const pct = rpmPeak > 0 ? Math.min(100, (rpmNow / rpmPeak) * 100) : 0;
    barFill.style.width = (rpmNow > 0 ? Math.max(8, pct) : 0) + '%';
    barWrap.appendChild(barFill);
    rpmInner.appendChild(barWrap);
    const rpmTip = document.createElement('div');
    rpmTip.className = 'tf-rpm-tip';
    rpmTip.textContent = safeT('基于 60 秒滑动窗口的实时请求速率');
    rpmInner.appendChild(rpmTip);
    rpmBlock.appendChild(rpmInner);
    grid.appendChild(rpmBlock);

    // v2.2.0：模型明细已并入 renderStatsPanel（带范围切换、缓存命中率、计价来源徽标）
    // ============ v2.0.0：抓取诊断（无 DevTools 的设备也能自查） ============
    const diag = document.createElement('div');
    diag.className = 'tf-capture-diag';
    const diagTxt = document.createElement('span');
    diagTxt.textContent = '🛰 ' + safeT('已捕获') + ' ' + CAPTURE_STATS.recorded
        + ' · ' + safeT('估算') + ' ' + CAPTURE_STATS.estimated
        + ' · ' + safeT('未捕获') + ' ' + CAPTURE_STATS.missed
        + ' · ' + safeT('窗口') + ' ' + CAPTURE_STATS.windows;
    const diagBtn = document.createElement('button');
    diagBtn.type = 'button';
    diagBtn.className = 'menu_button tf-diag-btn';
    diagBtn.textContent = safeT('复制诊断');
    diagBtn.addEventListener('click', () => {
        const txt = [
            'SillyToken 抓取诊断 · v' + TF_VERSION,
            '窗口 ' + CAPTURE_STATS.windows + ' 个；识别到生成请求 ' + CAPTURE_STATS.seen + ' 次',
            '精确记账 ' + CAPTURE_STATS.recorded + ' 次；估算兜底 ' + CAPTURE_STATS.estimated + ' 次；未捕获 ' + CAPTURE_STATS.missed + ' 次',
            '--- 最近未捕获 ---',
            ...(CAPTURE_STATS.lastMissed.length
                ? CAPTURE_STATS.lastMissed.map(m => m.at + ' | ' + m.model + ' | ' + m.url + ' | ' + m.reason)
                : ['（无）']),
        ].join('\n');
        tfCopy(txt, safeT('已复制'));
    });
    diag.appendChild(diagTxt);
    diag.appendChild(diagBtn);
    grid.appendChild(diag);
    renderPriceWarnings(grid, s);

    const started = document.createElement('div');
    started.className = 'tf-session-start';
    const d = new Date(s.sessionStartedAt || Date.now());
    started.textContent = safeT('会话开始于') + ' ' + d.toLocaleString();
    grid.appendChild(started);

    el.innerHTML = '';
    el.appendChild(grid);

    // ============ v1.3.0：Gemini 风格用量限额面板 ============
    renderGeminiQuota(el, s);

    // ============ v2.1.0：运行日志 ============
    renderLogPanel(el, s);
}

/* ============================================================
 *  v1.3.0 · Gemini「用量限额」一比一还原
 * ============================================================ */
// 计算当日周期内的用量（按当前 metric）
function quotaMetricUsage(s, windowStartTs) {
    const metric = (s.geminiQuota && s.geminiQuota.metric) || 'tokens';
    // 隔夜后 dailyStats 里还是昨天的数，不能当「今天」用
    const d = tfTodayStats(s);
    if (metric === 'cost') return d.cost || 0;
    if (metric === 'requests') return d.req || 0;
    return d.tokens || 0;
}

function quotaWeeklyUsage(s) {
    const cfg = s.geminiQuota || {};
    const metric = cfg.metric || 'tokens';
    const weekStart = weeklyResetMillis(s);
    let sum = 0;
    const todayKey = _todayStr();
    if (Array.isArray(s.history)) {
        for (const h of s.history) {
            if (!h || !h.date || h.date === todayKey) continue;  // 今天用 dailyStats 计
            const t = new Date(h.date + 'T00:00:00').getTime();
            if (t >= weekStart) {
                if (metric === 'cost') sum += h.cost || 0;
                else if (metric === 'requests') sum += h.req || 0;
                else sum += h.tokens || 0;
            }
        }
    }
    const d = tfTodayStats(s);   // 隔夜后 dailyStats 里还是昨天的数，不能当「今天」用
    sum += (metric === 'cost') ? (d.cost || 0)
        : (metric === 'requests') ? (d.req || 0) : (d.tokens || 0);
    return sum;
}

// 计算本周起始时间戳（基于 weeklyResetDay/weeklyResetTime）
function weeklyResetMillis(s) {
    const cfg = s.geminiQuota || {};
    const day = (cfg.weeklyResetDay == null) ? 4 : (cfg.weeklyResetDay % 7);
    const wt = parseHM(cfg.weeklyResetTime || '12:19');
    const now = new Date();
    const m = new Date(now);
    m.setHours(0, 0, 0, 0);
    // 本周已过天数
    let diff = (now.getDay() - day + 7) % 7;
    m.setDate(m.getDate() - diff);
    m.setHours(wt.h, wt.m, 0, 0);   // 旧版误用 setMinutes，且从未设置小时
    // 如果起始时间在未来，回退到上周
    if (m.getTime() > now.getTime()) m.setDate(m.getDate() - 7);
    return m.getTime();
}
// "HH:MM" -> { h, m }
function parseHM(str) {
    const [h, m] = String(str || '0:0').split(':');
    return { h: parseInt(h, 10) || 0, m: parseInt(m, 10) || 0 };
}
// 计算今日重置时刻（基于 dailyResetTime）
function dailyResetMillis(s) {
    const cfg = s.geminiQuota || {};
    const t = (cfg.dailyResetTime || '17:19').split(':');
    const m = new Date();
    m.setHours(parseInt(t[0], 10) || 0, parseInt(t[1], 10) || 0, 0, 0);
    return m.getTime();
}
function fmtClock(s, mode) {
    const cfg = s.geminiQuota || {};
    let h, min, day;
    if (mode === 'daily') {
        const t = (cfg.dailyResetTime || '17:19').split(':');
        h = t[0]; min = t[1];
        return `${h}:${min}`;
    } else {
        const t = (cfg.weeklyResetTime || '12:19').split(':');
        day = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][(cfg.weeklyResetDay == null ? 4 : cfg.weeklyResetDay % 7)];
        return `${day} ${t[0]}:${t[1]}`;
    }
}

// 渲染环形进度 SVG
function quotaRingHTML(pct, used, limit, label, mode, s) {
    const R = 34, C = 2 * Math.PI * R;
    const safe = Math.max(0, Math.min(100, pct));
    const off = C - (safe / 100) * C;
    const tone = safe >= 100 ? 'over' : safe >= 80 ? 'warn' : '';
    const usedStr = limit > 0 ? `${fmtCompact(s, used)} / ${fmtCompact(s, limit)}` : `${fmtCompact(s, used)}`;
    return `
        <div class="tf-quota-ring">
            <div class="tf-ring">
                <svg viewBox="0 0 78 78">
                    <circle class="tf-ring-bg" cx="39" cy="39" r="${R}"/>
                    <circle class="tf-ring-fg ${tone}" cx="39" cy="39" r="${R}"
                        stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
                </svg>
                <div class="tf-ring-center">
                    <div class="tf-ring-pct">${Math.round(safe)}%</div>
                    <div class="tf-ring-used">${safeT('已用')}</div>
                </div>
            </div>
            <div class="tf-ring-meta">
                <div class="tf-ring-label">${label}</div>
                <div class="tf-ring-desc">${usedStr}</div>
                <div class="tf-ring-reset">🔄 ${safeT('重置')} · ${fmtClock(s, mode)}</div>
            </div>
        </div>`;
}
// 格式化用量：cost -> 金额，tokens -> 万，requests -> 次
function fmtCompact(s, v) {
    const metric = (s.geminiQuota && s.geminiQuota.metric) || 'tokens';
    if (metric === 'cost') return fmtMoney(s, v);
    if (metric === 'requests') return fmtTokens(v) + ' ' + safeT('次');
    return fmtTokens(v);
}

// 主渲染函数：Gemini 风格用量限额面板
function renderGeminiQuota(el, s) {
    const cfg = s.geminiQuota || {};
    if (cfg.enabled === false) return;
    try {
        const wrap = document.createElement('div');
        wrap.className = 'tf-writing';
        // 头部
        const head = document.createElement('div');
        head.className = 'tf-quota-head';
        const title = document.createElement('div');
        title.className = 'tf-quota-title';
        title.innerHTML = `<span class="tf-quota-icon">🧪</span>${safeT('用量限额')}`;
        const sub = document.createElement('div');
        sub.className = 'tf-quota-sub';
        sub.textContent = safeT('用量限额副标题');
        head.appendChild(title);
        head.appendChild(sub);
        wrap.appendChild(head);

        // 两个环形：今日用量 / 每周限额
        const rings = document.createElement('div');
        rings.className = 'tf-quota-ring-wrap';

        const dailyLimit = cfg.dailyLimit || 0;
        const dailyUsed = quotaMetricUsage(s, dailyResetMillis(s));
        const dPct = dailyLimit > 0 ? (dailyUsed / dailyLimit) * 100 : 0;
        rings.innerHTML = quotaRingHTML(dPct, dailyUsed, dailyLimit, safeT('当前用量'), 'daily', s);

        const weeklyLimit = cfg.weeklyLimit || 0;
        const weeklyUsed = quotaWeeklyUsage(s);
        const wPct = weeklyLimit > 0 ? (weeklyUsed / weeklyLimit) * 100 : 0;
        rings.insertAdjacentHTML('beforeend', quotaRingHTML(wPct, weeklyUsed, weeklyLimit, safeT('每周限额'), 'weekly', s));
        wrap.appendChild(rings);

        // 升级卡片
        const up = document.createElement('div');
        up.className = 'tf-quota-upgrade';
        const info = document.createElement('div');
        info.className = 'tf-quota-upgrade-info';
        const emoji = document.createElement('div');
        emoji.className = 'tf-quota-upgrade-emoji';
        emoji.textContent = '⚡';
        const text = document.createElement('div');
        text.className = 'tf-quota-upgrade-text';
        const tb = document.createElement('b');
        tb.textContent = safeT('升级用量限额标题').replace('{n}', cfg.upgradeMultiplier || 2);
        const ts = document.createElement('span');
        ts.textContent = safeT('升级用量限额副标题');
        text.appendChild(tb);
        text.appendChild(ts);
        info.appendChild(emoji);
        info.appendChild(text);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tf-quota-upgrade-btn';
        btn.textContent = safeT('升级');
        btn.addEventListener('click', () => {
            console.log(`[SillyToken] quota upgrade: ${cfg.upgradeLabel} ${cfg.upgradePrice}`);
        });
        up.appendChild(info);
        up.appendChild(btn);
        wrap.appendChild(up);

        el.appendChild(wrap);
    } catch (e) {
        console.warn('[SillyToken] renderGeminiQuota:', e);
    }
}
// 主题 id → 展示名（i18n）
function themeNameOf(id) {
    const map = {
        'cyber-royal': '赛博帝京',
        'ink-zen': '水墨禅境',
        'aurora-midnight': '午夜极光',
        'molten-gold': '熔金斜阳',
        'mono-white': '纯白极简',
    };
    return map[id] || id;
}

// 构建用量摘要文本（供复制）
function buildUsageSummary(s) {
    const total = s.stats || {};
    const sess = s.session || {};
    const now = new Date();
    const lines = [
        `SillyToken · ${safeT('用量摘要')} — ${now.toLocaleString()}`,
        `── ${safeT('累计')} ──`,
        `${safeT('累计费用')}: ${fmtMoney(s, total.totalCost || 0)}`,
        `${safeT('累计')} Token: ${fmtTokens(total.totalTokens || 0)} · ${total.totalRequests || 0} ${safeT('次请求')}`,
        `── ${safeT('会话')} ──`,
        `${safeT('会话费用')}: ${fmtMoney(s, sess.totalCost || 0)}`,
        `${safeT('会话')} Token: ${fmtTokens(sess.totalTokens || 0)} · ${sess.totalRequests || 0} ${safeT('次请求')}`,
    ];
    const ctx = contextUsagePercent();
    if (ctx && ctx.limit) lines.push(`${safeT('上下文占用')}: ${Math.round(ctx.pct)}% (${fmtTokens(ctx.used)}/${fmtTokens(ctx.limit)})`);
    return lines.join('\n');
}

// 剪贴板兜底（textarea 全选 execCommand）
function fallbackCopy(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        globalThis.Toast?.system?.(safeT('已复制'));
    } catch (err) {
        console.warn('[SillyToken] fallbackCopy:', err);
    }
}

function applyTheme() {
    try {
        const s = getSettings();
        const theme = s.theme || 'aurora-midnight';
        const containers = [
            document.getElementById('token_flow_panel'),
            document.getElementById('token_flow_drawer'),
            document.getElementById('token_flow_dashboard'),
        ];
        for (const el of containers) {
            if (el) el.setAttribute('data-tf-theme', theme);
        }
        // 同步悬浮球图标用色（可选）
        const orbIcon = document.querySelector('.tf-orb-icon');
        if (orbIcon) orbIcon.style.color = 'var(--tf-accent, #5eead4)';
    } catch (e) {
        console.warn('[SillyToken] applyTheme:', e);
    }
}

let tfRenderQueued = false;
let tfRenderTimer = null;

function safeUpdateUI() {
    // 面板渲染一旦抛异常，整块 UI 会变空白；用户设备上没有 DevTools，
    // 所以这里兜一层，并把异常写进运行日志（面板底部能看到）。
    //
    // 同时把同一帧里的多次请求合并成一次重绘：一次点击常常连着触发
    // 好几条 safeUpdateUI（改设置 → 重算 → 重画），旧版会排队排出一串
    // 全量重绘 —— 上千条历史记录时点一下要卡好几秒。
    if (tfRenderQueued) return;
    tfRenderQueued = true;
    const run = () => {
        if (!tfRenderQueued) return;   // 已被另一条路径先跑掉了
        tfRenderQueued = false;
        if (tfRenderTimer !== null) {
            try { clearTimeout(tfRenderTimer); } catch { /* ignore */ }
            tfRenderTimer = null;
        }
        try {
            updateDashboard();
        } catch (error) {
            tfLog('error', 'ui.render', '面板渲染失败: ' + (error?.message || error));
        }
    };
    if (typeof requestAnimationFrame === 'function') {
        // 后台标签页 / 熄屏时 rAF 不触发，旧版会一直停在「已排队」状态，
        // 回前台才补一次。定时器兜底保证最长约 0.8 秒内必定重绘一次。
        // 先挂定时器再挂 rAF：rAF 跑起来时会把它清掉。
        if (typeof setTimeout === 'function') tfRenderTimer = setTimeout(run, 800);
        requestAnimationFrame(run);
    } else {
        run();
    }
}

// 清空会话数据（每日/新会话时调用）
function resetSessionStats() {
    const s = getSettings();
    s.session = structuredClone(defaultSettings.session);
    s.sessionStartedAt = Date.now();
    saveSettingsDebounced();
    safeUpdateUI();
}

/* ============================================================
 *  悬浮球 + 统计弹层（对齐 world-backstage 的 orb 模式）
 *  - 悬浮球固定在屏幕，可拖动 + 自动贴边 + 记忆位置
 *  - 点击悬浮球展开/收起实时统计弹层
 * ============================================================ */

const ORB_SIZE = 56;
let orbDragState = null;
let orbSuppressClick = false;

function ensureFloatingUI() {
    if (document.getElementById('token_flow_orb')) return true;
    if (!document.body) return false;

    const fragment = document.createElement('div');
    fragment.innerHTML = `
        <button class="tf-orb" id="token_flow_orb" type="button" aria-label="${safeT('打开用量统计')}" title="SillyToken · ${safeT('用量统计')}">
            <span class="tf-orb-icon fa-solid fa-chart-line"></span>
            <span class="tf-orb-badge" id="token_flow_orb_badge" style="display:none"></span>
        </button>
        <div class="tf-panel-scrim" id="token_flow_panel_scrim" style="display:none"></div>
        <section class="tf-panel" id="token_flow_panel" role="dialog" aria-modal="true" style="display:none">
            <header class="tf-panel-header">
                <div class="tf-panel-title">
                    <b>SillyToken</b>
                    <span>${safeT('用量统计')}</span>
                </div>
                <div class="tf-panel-header-right">
                    <div class="tf-theme-switcher" id="token_flow_theme_switcher" title="${safeT('主题')}">
                        <button class="tf-theme-switch-btn menu_button" type="button" title="${safeT('切换主题')}"><i class="fa-solid fa-palette"></i></button>
                        <div class="tf-theme-menu" id="token_flow_theme_menu">
                            ${['cyber-royal','ink-zen','aurora-midnight','molten-gold','mono-white'].map(id =>
                                `<button type="button" class="tf-theme-menu-item" data-theme-id="${id}" data-theme-name="${safeT(themeNameOf(id))}">${safeT(themeNameOf(id))}</button>`
                            ).join('')}
                        </div>
                    </div>
                    <div class="tf-panel-actions">
                        <button class="tf-panel-copy menu_button" id="token_flow_copy_summary" type="button" title="${safeT('复制用量摘要')}"><i class="fa-solid fa-copy"></i></button>
                        <button class="tf-panel-auto menu_button" id="token_flow_auto_refresh" type="button" title="${safeT('自动刷新')}"><i class="fa-solid fa-rotate"></i></button>
                        <button class="tf-panel-dl menu_button" id="token_flow_dl_backup" type="button" title="${safeT('导出备份')}"><i class="fa-solid fa-download"></i></button>
                        <button class="tf-panel-refresh-tick menu_button" id="token_flow_manual_refresh" type="button" title="${safeT('刷新')}"><i class="fa-solid fa-arrows-rotate"></i></button>
                        <button class="tf-panel-reset menu_button" id="token_flow_reset_session" type="button" title="${safeT('重置会话')}"><i class="fa-solid fa-clock-rotate-left"></i></button>
                        <button class="tf-panel-close menu_button" id="token_flow_panel_close" type="button" title="${safeT('关闭')}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
            </header>
            <div class="tf-panel-body" id="token_flow_panel_body"></div>
        </section>
    `;

    document.body.appendChild(fragment);

    const orb = document.getElementById('token_flow_orb');
    const panel = document.getElementById('token_flow_panel');
    const scrim = document.getElementById('token_flow_panel_scrim');
    const closeBtn = document.getElementById('token_flow_panel_close');
    const refreshBtn = document.getElementById('token_flow_manual_refresh') || document.getElementById('token_flow_refresh');
    const resetBtn = document.getElementById('token_flow_reset_session');

    // 恢复悬浮球位置
    const stored = getSettings().orbPosition;
    if (stored && typeof stored.x === 'number') {
        orb.style.left = stored.x + 'px';
        orb.style.top = stored.y + 'px';
        orb.style.right = 'auto';
        orb.style.bottom = 'auto';
    }

    // 拖动逻辑
    orb.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const rect = orb.getBoundingClientRect();
        orbDragState = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originX: rect.left,
            originY: rect.top,
            moved: false,
        };
        orb.setPointerCapture?.(e.pointerId);
        orb.classList.add('is-dragging');
    });
    orb.addEventListener('pointermove', (e) => {
        if (!orbDragState || e.pointerId !== orbDragState.pointerId) return;
        const dx = e.clientX - orbDragState.startX;
        const dy = e.clientY - orbDragState.startY;
        if (Math.hypot(dx, dy) > 5) orbDragState.moved = true;
        if (!orbDragState.moved) return;
        let x = orbDragState.originX + dx;
        let y = orbDragState.originY + dy;
        x = Math.max(8, Math.min(window.innerWidth - ORB_SIZE - 8, x));
        y = Math.max(8, Math.min(window.innerHeight - ORB_SIZE - 8, y));
        orb.style.left = x + 'px';
        orb.style.top = y + 'px';
        orb.style.right = 'auto';
        orb.style.bottom = 'auto';
        e.preventDefault();
    });
    const finishOrbDrag = (e) => {
        if (!orbDragState || e.pointerId !== orbDragState.pointerId) return;
        orb.classList.remove('is-dragging');
        orb.releasePointerCapture?.(e.pointerId);
        const drag = orbDragState;
        orbDragState = null;
        if (drag.moved) {
            const rect = orb.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const snapLeft = centerX < window.innerWidth / 2;
            const margin = 12;
            const snapX = snapLeft ? margin : window.innerWidth - ORB_SIZE - margin;
            orb.style.left = snapX + 'px';
            orb.style.right = 'auto';
            const s = getSettings();
            s.orbPosition = { x: snapX, y: rect.top };
            saveSettingsDebounced();
            orbSuppressClick = true;
            setTimeout(() => { orbSuppressClick = false; }, 260);
        }
    };
    orb.addEventListener('pointerup', finishOrbDrag);
    orb.addEventListener('pointercancel', finishOrbDrag);

    // 展开/收起
    orb.addEventListener('click', () => {
        if (orbSuppressClick) return;
        const open = panel.style.display !== 'none';
        panel.style.display = open ? 'none' : 'flex';
        scrim.style.display = open ? 'none' : 'block';
        orb.classList.toggle('is-open', !open);
        if (!open) { safeUpdateUI(); }
    });
    closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        scrim.style.display = 'none';
        orb.classList.remove('is-open');
    });
    scrim.addEventListener('click', () => {
        panel.style.display = 'none';
        scrim.style.display = 'none';
        orb.classList.remove('is-open');
    });
    refreshBtn.addEventListener('click', safeUpdateUI);
    resetBtn.addEventListener('click', resetSessionStats);

    // ===== v1.4.0：主题切换下拉 + 快捷功能 =====
    const themeSwitchBtn = document.querySelector('#token_flow_theme_switcher .tf-theme-switch-btn');
    const themeMenu = document.getElementById('token_flow_theme_menu');

    if (themeSwitchBtn) {
        themeSwitchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            themeMenu.classList.toggle('open');
        });
    }
    if (themeMenu) {
        themeMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.tf-theme-menu-item');
            if (!item) return;
            const s = getSettings();
            s.theme = item.getAttribute('data-theme-id') || s.theme;
            applyTheme();
            saveSettingsDebounced();
            document.querySelectorAll('#token_flow_drawer .tf-theme-chip').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-theme') === s.theme);
            });
            themeMenu.classList.remove('open');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#token_flow_theme_switcher')) themeMenu.classList.remove('open');
        });
    }
    applyTheme();

    // 复制用量摘要
    const copyBtn = document.getElementById('token_flow_copy_summary');
    if (copyBtn) copyBtn.addEventListener('click', () => {
        try {
            const s = getSettings();
            const txt = buildUsageSummary(s);
            tfCopy(txt, safeT('已复制'));
        } catch (err) { console.warn('[SillyToken] copy:', err); }
    });

    // 自动刷新
    const autoBtn = document.getElementById('token_flow_auto_refresh');
    if (autoBtn) {
        let autoTimer = null;
        const applyAutoState = () => {
            const s = getSettings();
            if (s.autoRefresh) {
                autoBtn.classList.add('active');
                if (!autoTimer) autoTimer = setInterval(safeUpdateUI, (s.autoRefreshInterval || 15) * 1000);
            } else {
                autoBtn.classList.remove('active');
                if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
            }
        };
        autoBtn.addEventListener('click', () => {
            const s = getSettings();
            s.autoRefresh = !s.autoRefresh;
            saveSettingsDebounced();
            applyAutoState();
        });
        applyAutoState();
    }

    // 导出备份
    const dlBtn = document.getElementById('token_flow_dl_backup');
    if (dlBtn) dlBtn.addEventListener('click', () => {
        try {
            const s = getSettings();
            const payload = { version: 1, exportedAt: Date.now(), settings: s };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'sillytoken_backup.json'; document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
            globalThis.Toast?.system?.(safeT('已导出'));
        } catch (err) { console.warn('[SillyToken] export:', err); }
    });

    // ESC 关闭 & 面板标题栏拖动
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.style.display !== 'none') {
            panel.style.display = 'none';
            scrim.style.display = 'none';
            orb.classList.remove('is-open');
            return;
        }
        // ===== v1.4.0：全局快捷键 Ctrl+Shift+T 开/关悬浮球面板 =====
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 't') {
            e.preventDefault();
            e.stopPropagation();
            const open = panel.style.display !== 'none';
            panel.style.display = open ? 'none' : 'flex';
            scrim.style.display = open ? 'none' : 'block';
            orb.classList.toggle('is-open', !open);
            if (!open) safeUpdateUI();
            globalThis.Toast?.system?.(open ? safeT('隐藏统计面板') : safeT('显示统计面板'));
        }
    });

    console.log('[SillyToken] floating orb + panel mounted');
    safeUpdateUI();
    return true;
}

/* ============================================================
 *  启动与事件绑定
 *  采用 world-backstage 验证过的模式：
 *  DOM 就绪后再注入 UI，并主动探测容器 + 重试兜底
 * ============================================================ */

function installSettingsEntry() {
    if (document.getElementById('token_flow_drawer')) return true;

    const host = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!host) {
        console.warn('[SillyToken] settings container not found, will retry...');
        return false;
    }

    console.log('[SillyToken] injecting settings into', host.id);

    const entry = document.createElement('div');
    entry.id = 'token_flow_entry';
    entry.innerHTML = `
        <div class="inline-drawer" id="token_flow_drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>SillyToken</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="tf-settings-hint">
                    ${safeT('统计面板已移至悬浮球，点击右下角悬浮球即可展开。')}
                </div>
                <div class="tokenflow-settings" id="token_flow_settings_inner"></div>
            </div>
        </div>
    `;
    host.appendChild(entry);

    addExtensionSettingsInto(document.getElementById('token_flow_settings_inner'));
    console.log('[SillyToken] settings panel injected');
    return true;
}

function addExtensionSettingsInto(content) {
    const s = getSettings();
    const wrap = document.createElement('div');
    wrap.className = 'tokenflow-settings';

    const row = (label, el) => {
        const r = document.createElement('div');
        r.className = 'tf-row';
        r.appendChild(label);
        r.appendChild(el);
        wrap.appendChild(r);
    };
    const span = (text) => {
        const e = document.createElement('span');
        e.textContent = text;
        e.className = 'tf-label';
        return e;
    };

    // 开关
    const mkCheck = (key) => {
        const label = document.createElement('label');
        label.className = 'checkbox_label';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!s[key];
        cb.addEventListener('change', () => { s[key] = cb.checked; saveSettingsDebounced(); });
        label.append(cb);
        return label;
    };

    const sw1 = mkCheck('enabled');
    sw1.append(document.createTextNode(safeT('启用统计')));
    row(span(safeT('统计开关')), sw1);

    const sw2 = mkCheck('trackExact');
    sw2.append(document.createTextNode(safeT('捕获真实 API usage')));
    row(span(safeT('精确追踪')), sw2);
    // 旧版只在 initialize() 里读一次 trackExact：启动后再勾上，抓取层
    // 永远不会装（用户以为开了，其实一条都不记）；取消勾选则照旧在抓。
    const sw2Input = sw2.querySelector('input');
    sw2Input.addEventListener('change', () => {
        if (sw2Input.checked) {
            try {
                installCaptureLayer();
                tfLog('info', 'capture.toggle', '已开启精确追踪');
            } catch (e) {
                tfLog('error', 'capture.install', '补装捕获层失败: ' + (e?.message || e));
            }
        } else {
            // 只停看门狗，补丁层留着透传：抢回 window.fetch 会把别的扩展
            // 后来包的层一起丢掉，透传则只影响我们自己。
            stopCaptureWatchdog();
            tfLog('info', 'capture.toggle', '已关闭精确追踪：之后的请求不再记账，本地估算兜底仍可用');
        }
    });

    const sw3 = mkCheck('useFallback');
    sw3.append(document.createTextNode(safeT('本地估算兜底')));
    row(span(safeT('估算兜底')), sw3);

    // 悬浮球开关
    const sw4 = mkCheck('showOrb');
    sw4.append(document.createTextNode(safeT('显示统计悬浮球')));
    row(span(safeT('统计悬浮球')), sw4);
    // 监听悬浮球开关
    const sw4Input = sw4.querySelector('input');
    sw4Input.addEventListener('change', () => {
        const orbe = document.getElementById('token_flow_orb');
        if (orbe) orbe.style.display = sw4Input.checked ? '' : 'none';
    });

    // 打开统计面板按钮
    const openBtnRow = document.createElement('div');
    openBtnRow.className = 'tf-btn-row';
    const openBtn = document.createElement('button');
    openBtn.textContent = safeT('打开统计面板');
    openBtn.className = 'menu_button';
    openBtn.addEventListener('click', () => {
        const panel = document.getElementById('token_flow_panel');
        const scrim = document.getElementById('token_flow_panel_scrim');
        const orbe = document.getElementById('token_flow_orb');
        if (panel) {
            panel.style.display = 'flex';
            scrim.style.display = 'block';
            orbe?.classList.add('is-open');
            safeUpdateUI();
        }
    });
    openBtnRow.appendChild(openBtn);
    wrap.appendChild(openBtnRow);

    // 币种 + 汇率
    row(span(safeT('显示币种')),
        makeInput('tf_currency', 'text', s.displayCurrency, () => {
            s.displayCurrency = document.getElementById('tf_currency').value || '$';
            saveSettingsDebounced(); updateDashboard();
        }));
    row(span(safeT('汇率 (1 USD = ?)')),
        makeInput('tf_rate', 'number', s.exchangeRate, () => {
            const v = parseFloat(document.getElementById('tf_rate').value);
            if (v > 0) { s.exchangeRate = v; saveSettingsDebounced(); updateDashboard(); }
        }));

    // 模型价格编辑表
    const table = document.createElement('table');
    table.className = 'tf-price-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>' + safeT('模型') + '</th><th>' + safeT('输入 $/1M') + '</th><th>' + safeT('输出 $/1M') + '</th><th>' + safeT('缓存 $/1M') + '</th><th>' + safeT('按次 $') + '</th><th>' + safeT('倍率 (x)') + '</th><th>' + safeT('别名') + '</th><th></th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    const renderRows = () => {
        tbody.innerHTML = '';
        s.models.forEach((m, i) => {
            const tr = document.createElement('tr');
            const tdName = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.className = 'text_pole tf-name';
            nameInput.value = m.name;
            nameInput.addEventListener('change', () => { m.name = nameInput.value; m.userEdited = true; onPricesChanged(); });
            tdName.appendChild(nameInput);
            tr.appendChild(tdName);

            for (const f of ['input', 'output', 'cached', 'perRequest']) {
                const td = document.createElement('td');
                const inp = document.createElement('input');
                inp.className = 'text_pole tf-num';
                inp.type = 'number';
                inp.step = 'any';
                inp.value = m[f];
                inp.addEventListener('input', () => {
                    const v = parseFloat(inp.value);
                    m[f] = isNaN(v) ? 0 : v;
                    m.userEdited = true;
                    onPricesChanged();
                });
                td.appendChild(inp);
                tr.appendChild(td);
            }

            // 倍率限制（v1.6.0）：默认 x1，可设为 x0.5/x2 等调整该模型计费成本
            const tdMult = document.createElement('td');
            const multInp = document.createElement('input');
            multInp.className = 'text_pole tf-num';
            multInp.type = 'number';
            multInp.step = 'any';
            multInp.min = '0.01';
            multInp.value = (typeof m.multiplier === 'number' && m.multiplier > 0) ? m.multiplier : 1;
            multInp.title = safeT('倍率限制，默认x1，用于调整计费成本');
            multInp.addEventListener('input', () => {
                const v = parseFloat(multInp.value);
                m.multiplier = (!isNaN(v) && v > 0) ? v : 1;
                m.userEdited = true;
                if (isNaN(v) || v <= 0) multInp.value = 1;
                onPricesChanged();
            });
            tdMult.appendChild(multInp);
            tr.appendChild(tdMult);

            // 别名（v2.2.0）：自动推断不确定时，用它把外部模型名钉到这一档价格
            const tdAlias = document.createElement('td');
            const aliasInp = document.createElement('input');
            aliasInp.className = 'text_pole tf-alias';
            aliasInp.value = m.aliases || '';
            aliasInp.placeholder = safeT('逗号分隔');
            aliasInp.title = safeT('手动指定别名，例如 deepseek-flash, deepseek-chat');
            // 用 change 而不是 input：别名是文本，每敲一个字就全量重算 + 落盘太浪费
            aliasInp.addEventListener('change', () => {
                m.aliases = aliasInp.value;
                m.userEdited = true;
                onPricesChanged();
            });
            tdAlias.appendChild(aliasInp);
            tr.appendChild(tdAlias);

            const tdDel = document.createElement('td');
            const delBtn = document.createElement('button');
            delBtn.textContent = '✕';
            delBtn.className = 'tf-del';
            delBtn.addEventListener('click', () => {
                if (s.models.length <= 1) return;
                s.models.splice(i, 1);
                onPricesChanged(); renderRows();
            });
            tdDel.appendChild(delBtn);
            tr.appendChild(tdDel);
            tbody.appendChild(tr);
        });
    };
    renderRows();
    table.appendChild(tbody);
    wrap.appendChild(span(safeT('模型价格表')));
    wrap.appendChild(table);

    const addBtn = document.createElement('button');
    addBtn.textContent = '+' + safeT('添加模型');
    addBtn.className = 'menu_button';
    addBtn.addEventListener('click', () => {
        s.models.push({ name: 'new-model', input: 0, output: 0, cached: 0, perRequest: 0, multiplier: 1, userEdited: true });
        onPricesChanged(); renderRows();
    });
    wrap.appendChild(addBtn);

    // 数据操作
    const btnRow = document.createElement('div');
    btnRow.className = 'tf-btn-row';
    const resetAll = document.createElement('button');
    resetAll.textContent = safeT('清空全部数据');
    resetAll.className = 'menu_button';
    resetAll.addEventListener('click', () => {
        s.stats = structuredClone(defaultSettings.stats);
        s.session = structuredClone(defaultSettings.session);
        // 旧版漏了这几项：总量归零了，但 7 天/30 天/全部视图照样显示全部历史 —— 等于没擦
        s.history = [];
        s.dailyStats = { cost: 0, tokens: 0, req: 0, models: {}, date: _todayStr() };
        s.lastDailyReport = '';
        saveSettingsDebounced(); updateDashboard();
    });
    const resetSession = document.createElement('button');
    resetSession.textContent = safeT('重置会话');
    resetSession.className = 'menu_button';
    resetSession.addEventListener('click', () => {
        s.session = structuredClone(defaultSettings.session);
        saveSettingsDebounced(); updateDashboard();
    });
    btnRow.appendChild(resetAll);
    btnRow.appendChild(resetSession);
    wrap.appendChild(btnRow);

    // ============ v1.1.0 新增配置：预算监控 ============
    const budgetHead = document.createElement('div');
    budgetHead.className = 'tf-writing-title';
    budgetHead.textContent = '💰 ' + safeT('预算监控');
    wrap.appendChild(budgetHead);

    const mkCheck2 = (key, label) => {
        const lab = document.createElement('label');
        lab.className = 'checkbox_label';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!(s[key]);
        cb.addEventListener('change', () => {
            s[key] = cb.checked; saveSettingsDebounced(); updateDashboard();
        });
        lab.append(cb);
        lab.append(document.createTextNode(safeT(label)));
        return lab;
    };

    // 预算开关（嵌套路径 s.budget.enabled）
    const budgetLab = document.createElement('label');
    budgetLab.className = 'checkbox_label';
    const budgetCb = document.createElement('input');
    budgetCb.type = 'checkbox';
    budgetCb.checked = !!(s.budget && s.budget.enabled);
    budgetCb.addEventListener('change', () => {
        s.budget.enabled = budgetCb.checked; saveSettingsDebounced();
        if (!budgetCb.checked) clearOrbAlert();
        updateDashboard();
    });
    budgetLab.append(budgetCb);
    budgetLab.append(document.createTextNode(safeT('启用预算预警')));
    row(span(safeT('预算开关')), budgetLab);
    row(span(safeT('今日限额 ($/1M)')),
        makeInput('tf_budget_daily', 'number', s.budget && s.budget.dailyLimit, () => {
            const v = parseFloat(document.getElementById('tf_budget_daily').value);
            s.budget.dailyLimit = isNaN(v) ? 0 : v; saveSettingsDebounced(); updateDashboard();
        }));
    row(span(safeT('月度限额 ($/1M)')),
        makeInput('tf_budget_monthly', 'number', s.budget && s.budget.monthlyLimit, () => {
            const v = parseFloat(document.getElementById('tf_budget_monthly').value);
            s.budget.monthlyLimit = isNaN(v) ? 0 : v; saveSettingsDebounced(); updateDashboard();
        }));

    // ============ v1.1.0 新增配置：上下文监控 ============
    const ctxHead = document.createElement('div');
    ctxHead.className = 'tf-writing-title';
    ctxHead.textContent = '🧠 ' + safeT('上下文监控');
    wrap.appendChild(ctxHead);
    row(span(safeT('上下文窗口 (tokens)')),
        makeInput('tf_ctx_size', 'number', s.contextSize, () => {
            const v = parseInt(document.getElementById('tf_ctx_size').value);
            if (v > 0) { s.contextSize = v; saveSettingsDebounced(); updateDashboard(); }
        }));

    // ============ v1.1.0 新增功能：历史归档配置 + 导出/导入 ============
    const histHead = document.createElement('div');
    histHead.className = 'tf-writing-title';
    histHead.textContent = '🗂 ' + safeT('历史归档');
    wrap.appendChild(histHead);

    // v2.2.0：按日归档改为始终开启（范围统计依赖它），开关已无意义，故移除。
    row(span(safeT('保留天数')),
        makeInput('tf_archive_days', 'number', s.archiveDays, () => {
            const v = parseInt(document.getElementById('tf_archive_days').value);
            if (v > 0) { s.archiveDays = v; saveSettingsDebounced(); }
        }));

    const ioRow = document.createElement('div');
    ioRow.className = 'tf-btn-row';

    const exportBtn = document.createElement('button');
    exportBtn.textContent = safeT('导出数据');
    exportBtn.className = 'menu_button';
    exportBtn.addEventListener('click', () => {
        const payload = { version: 1, exportedAt: Date.now(), settings: s };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'sillytoken_backup.json'; a.click();
        URL.revokeObjectURL(url);
    });
    ioRow.appendChild(exportBtn);

    const importBtn = document.createElement('button');
    importBtn.textContent = safeT('导入数据');
    importBtn.className = 'menu_button';
    importBtn.addEventListener('click', () => {
        const fi = document.createElement('input');
        fi.type = 'file'; fi.accept = '.json';
        fi.addEventListener('change', () => {
            const file = fi.files && fi.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(reader.result);
                    if (parsed && parsed.settings) {
                        // 导入是整块覆盖：当前统计与价格表全被换掉，而且没有撤销。
                        // 面板上「导出数据」和「导入数据」就挨着，点错一下数据就没了，
                        // 所以先把「要覆盖什么、覆盖成什么」摆出来让用户确认。
                        const meta = [];
                        if (parsed.exportedAt) {
                            try { meta.push(safeT('备份时间') + ': ' + new Date(parsed.exportedAt).toLocaleString()); } catch { /* 时间戳不可信，忽略 */ }
                        }
                        if (Array.isArray(parsed.settings.models)) meta.push(safeT('价格表条目') + ': ' + parsed.settings.models.length);
                        const ask = (typeof globalThis.confirm === 'function') ? globalThis.confirm : null;
                        if (ask) {
                            const msg = safeT('导入会覆盖当前全部统计与价格设置，且无法撤销。')
                                + '\n\n' + meta.join('\n') + (meta.length ? '\n\n' : '')
                                + safeT('确定继续？');
                            if (!ask(msg)) return;
                        }
                        // 只接受已知字段，并挡掉 __proto__ / constructor —— 导入的 JSON 是不可信输入
                        const incoming = (parsed.settings && typeof parsed.settings === 'object') ? parsed.settings : {};
                        const safeIncoming = {};
                        for (const key of Object.keys(incoming)) {
                            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
                            if (!Object.prototype.hasOwnProperty.call(defaultSettings, key)) continue;
                            safeIncoming[key] = incoming[key];
                        }
                        Object.assign(extension_settings[MODULE], safeIncoming);
                        const imported = getSettings();
                        if (typeof imported.displayCurrency === 'string') imported.displayCurrency = imported.displayCurrency.slice(0, 8);
                        if (!Array.isArray(imported.models)) imported.models = structuredClone(PRESET_MODELS);
                        imported.models = imported.models.filter((m) => m && typeof m === 'object');
                        recomputeAllCosts(imported);
                        saveSettingsDebounced(); updateDashboard();
                        alert(safeT('导入成功'));
                    } else {
                        alert(safeT('导入失败：格式不合法'));
                    }
                } catch (e) { alert(safeT('导入失败') + ': ' + e.message); }
            };
            reader.readAsText(file);
        });
        fi.click();
    });
    ioRow.appendChild(importBtn);
    wrap.appendChild(ioRow);

    content.appendChild(wrap);
}

function initialize() {
    if (globalThis.__sillyTokenLoaded) return;
    globalThis.__sillyTokenLoaded = true;

    console.log('[SillyToken] initialize() called, readyState:', document.readyState);

    try {
        const settings = getSettings();
        tfConsoleMirror = true;   // 控制台镜像常开；日志本身有环形上限，不会刷屏
        // 旧版本把 RPM 时间戳写进过 settings，升上来会把那坨数据一直带着，清一次
        if (settings.rpm && Array.isArray(settings.rpm.window) && settings.rpm.window.length) {
            settings.rpm.window = [];
            settings.rpm.peak = 0;
        }
        recomputeAllCosts(settings);   // 价格表可能刚被升级或改过，费用从用量重算
        tfLog('info', 'app.init', 'SillyToken v' + TF_VERSION + ' 启动', {
            enabled: settings.enabled, trackExact: settings.trackExact,
            models: settings.models.length, windows: collectCaptureWindows().length,
        });

        // 注入设置面板（带重试，等待扩展设置容器出现）
        let retryCount = 0;
        let injectTimer = null;
        const tryInject = () => {
            if (installSettingsEntry()) return;
            retryCount++;
            if (retryCount > 30) {
                console.error('[SillyToken] settings container not found after 30 retries, giving up');
                return;
            }
            console.log('[SillyToken] retrying injection...', retryCount);
            injectTimer = setTimeout(tryInject, 300);
        };
        tryInject();

        // 挂载悬浮球 + 统计弹层（body 顶层，独立于设置面板）
        if (settings.showOrb !== false) {
            ensureFloatingUI();
        }

        // MutationObserver 兜底：即使重试窗口错过容器出现，这里也能捕获
        let mo = null;
        if (window.MutationObserver) {
            mo = new MutationObserver(() => {
                if (!document.getElementById('token_flow_drawer')) installSettingsEntry();
                if (!document.getElementById('token_flow_orb') && getSettings().showOrb !== false) ensureFloatingUI();
            });
            // 观察 body，等待 settings 容器被构建后注入
            mo.observe(document.body, { childList: true, subtree: true });
        }

        // 安装抓取层（多窗口 + fetch/XHR + 宿主函数，含 iframe）
        if (settings.trackExact) installCaptureLayer();

        // 事件绑定：优先通过 SILVYTAVERN 全局上下文获取（world-backstage 验证过的模式），
        // 失败则回退到静态 import 的事件源。
        const context = getContext();
        const source = context?.eventSource || eventSource;
        const events = context?.eventTypes || context?.event_types || event_types;

        const on = (ev, handler) => {
            try {
                const tgt = events[ev];
                if (source && tgt) source.on(tgt, handler);
                else console.warn('[SillyToken] missing event binding for', ev);
            } catch (e) { console.warn('[SillyToken] event bind error:', e); }
        };

        // 聊天切换时重新尝试注入设置面板（有时 settings 容器是切换后才挂载的）
        on('CHAT_CHANGED', () => {
            if (!document.getElementById('token_flow_drawer')) tryInject();
            safeUpdateUI();
        });
        on('GENERATION_ENDED', safeUpdateUI);
        on('MESSAGE_RECEIVED', safeUpdateUI);

        console.log('[SillyToken] initialized successfully');
    } catch (e) {
        console.error('[SillyToken] init error:', e);
    }
}

/* ============================================================
 *  v2.1.0 · 运行日志 / 诊断快照 / 价格缺失处理
 *
 *  日志部分借鉴世界书脚本 cache-inspector 的思路：
 *    · 定长环形缓冲，超限丢最旧，不让日志自己撑爆内存
 *    · 写入前做长度截断，避免把整段 prompt 灌进日志
 *    · 暴露 window 上的诊断入口，便于远程排障
 *  但目标设备是鸿蒙平板、没有 DevTools，看不了控制台，
 *  所以日志直接渲染进统计面板，并提供「复制 / 复制诊断 / 清空」。
 * ============================================================ */

const TF_VERSION = '2.5.0';
const TF_LOG_LIMIT = 400;
const TF_LOG_VIEW = 60;
const TF_LOG_STRING_LIMIT = 200;
const tfLogs = [];
let tfConsoleMirror = true;

function tfTruncate(value, limit = TF_LOG_STRING_LIMIT) {
    const str = String(value == null ? '' : value);
    return str.length > limit ? str.slice(0, limit) + '…(' + str.length + ')' : str;
}

// 受限序列化：长字符串截断、长数组截断、函数打标
function tfJson(value) {
    try {
        return JSON.stringify(value, (key, item) => {
            if (typeof item === 'string') return tfTruncate(item, 160);
            if (typeof item === 'function') return '[fn]';
            if (Array.isArray(item) && item.length > 20) return item.slice(0, 20).concat(['…+' + (item.length - 20)]);
            return item;
        });
    } catch { return '[unserializable]'; }
}

function tfLog(level, stage, message, details) {
    const entry = {
        at: new Date().toLocaleTimeString(),
        ms: Date.now(),
        level,
        stage,
        message: tfTruncate(message, 300),
        details: details === undefined ? null : details,
    };
    tfLogs.push(entry);
    if (tfLogs.length > TF_LOG_LIMIT) tfLogs.splice(0, tfLogs.length - TF_LOG_LIMIT);
    if (tfConsoleMirror) {
        try {
            const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
            method.call(console, '[SillyToken] ' + stage + ' · ' + entry.message, entry.details || '');
        } catch { /* 控制台不可用就算了 */ }
    }
    return entry;
}

function tfClearLogs() {
    tfLogs.length = 0;
}

function tfLogsToText(max = 200) {
    const take = Math.min(max, tfLogs.length);
    const lines = ['SillyToken 日志 · ' + new Date().toLocaleString() + ' · 共 ' + tfLogs.length + ' 条，导出最近 ' + take + ' 条'];
    for (const entry of tfLogs.slice(-max)) {
        lines.push(entry.at + ' [' + entry.level + '] ' + entry.stage + ' · ' + entry.message
            + (entry.details ? ' ' + tfJson(entry.details) : ''));
    }
    return lines.join('\n');
}

function tfWindowHref(win) {
    try { return win.location?.href || '(no-href)'; } catch { return '(cross-origin)'; }
}

// 世界书脚本里 __wbmCacheInspectorDiagnostics() 的对应物
function tfDiagnostics() {
    let s = null;
    try { s = getSettings(); } catch { s = null; }

    const windows = collectCaptureWindows().map((win) => {
        let state = null;
        try { state = win.__sillyTokenPatch || null; } catch { state = null; }
        let fetchIsOutermost = false;
        try { fetchIsOutermost = !!state?.patchedFetch && win.fetch === state.patchedFetch; } catch { fetchIsOutermost = false; }
        let xhrIsOutermost = false;
        try { xhrIsOutermost = !!state?.patchedXHR && win.XMLHttpRequest === state.patchedXHR; } catch { xhrIsOutermost = false; }
        return {
            href: tfWindowHref(win),
            fetch: !!state?.patchedFetch,
            fetchIsOutermost,
            xhr: !!state?.patchedXHR,
            xhrIsOutermost,
            hostFunctions: (state?.hostPatches || []).map((p) => p.key),
        };
    });

    return {
        version: TF_VERSION,
        at: new Date().toISOString(),
        windows,
        capture: {
            seen: CAPTURE_STATS.seen,
            recorded: CAPTURE_STATS.recorded,
            estimated: CAPTURE_STATS.estimated,
            missed: CAPTURE_STATS.missed,
            lastMissed: CAPTURE_STATS.lastMissed.slice(-5),
        },
        totals: s ? {
            costUsd: s.stats?.totalCost || 0,
            tokens: s.stats?.totalTokens || 0,
            requests: s.stats?.totalRequests || 0,
        } : null,
        unpricedModels: s ? [...new Set(collectUnpricedModels(s).map((m) => m.name))] : [],
    };
}

// 把不可信字符串插进 innerHTML 之前先转义
function tfEscapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function tfCopy(text, okMessage) {
    try {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => globalThis.Toast?.system?.(okMessage))
                .catch(() => fallbackCopy(text));
            return;
        }
    } catch { /* 落到兜底 */ }
    fallbackCopy(text);
}

/* ============================================================
 *  价格缺失：「一开始没写价格 → 就不算钱」的补救
 *
 *  两个动作：
 *    1) 让缺失可见 —— 面板顶部警告条 + 模型明细行标注
 *    2) 让费用可追溯重算 —— 每个模型桶都保留了 in/out/cached/req，
 *       所以费用是从用量推导的，随时可以用新价格重算，
 *       不是记下来就固定死。今日与历史归档同样保存了按模型用量。
 * ============================================================ */

const TF_PRICE_FIELDS = ['input', 'output', 'cached', 'perRequest'];

function priceHasValue(price) {
    if (!price) return false;
    return TF_PRICE_FIELDS.some((field) => (price[field] || 0) > 0);
}

/** 用量已经记下、但没有任何可用单价的模型 —— 这些模型的费用目前是 0 */
function collectUnpricedModels(s) {
    const out = [];
    const seen = new Set();
    const sources = [s?.['stats']?.models, s?.['session']?.models];
    // 历史也要扫：旧版只看 stats/session，历史里的未定价模型永远不会被提示
    if (Array.isArray(s?.history)) for (const rec of s.history) if (rec && rec.models) sources.push(rec.models);
    for (const models of sources) {
        for (const [key, m] of Object.entries(models || {})) {
            if (!m || seen.has(key)) continue;
            if (priceHasValue(getPriceFor(s, key))) continue;
            seen.add(key);
            out.push({
                name: key,
                tokens: (m.in || 0) + (m.out || 0) + (m.cached || 0),
                req: m.req || 0,
            });
        }
    }
    return out;
}

/** 一键把缺价格的模型补进价格表（单价留 0 等用户填，填完历史费用自动重算） */
function addMissingPrices(s) {
    const names = [...new Set(collectUnpricedModels(s).map((m) => m.name))];
    let added = 0;
    for (const name of names) {
        const exists = s.models.some((m) => String(m.name).toLowerCase() === String(name).toLowerCase());
        if (exists) continue;
        s.models.push({ name, input: 0, output: 0, cached: 0, perRequest: 0, multiplier: 1, userEdited: true });
        added += 1;
    }
    recomputeAllCosts(s);
    saveSettingsDebounced();
    tfLog('info', 'price.addMissing', '补入 ' + added + ' 个模型到价格表，填好单价后历史费用会自动重算', { added, names });
    safeUpdateUI();
    return added;
}

/** 用当前价格表重算一桶模型的费用 */
function recomputeBucketCost(s, models) {
    let total = 0;
    for (const [key, m] of Object.entries(models || {})) {
        if (!m) continue;
        const price = getPriceFor(s, key);
        if (!price || price.matchedBy === 'none') {
            // 没有可用价格时保留原值：旧版会把它重算成 0，
            // 于是删掉一条价格就能让历史成本静默归零
            total += m.cost || 0;
            continue;
        }
        const cost = calcCost(s, key, m.in || 0, m.out || 0, m.cached || 0, m.req || 0);
        m.cost = cost.usd;
        total += cost.usd;
    }
    return total;
}

/** 全量重算：累计 / 会话 / 今日 / 历史归档（历史里没存按模型用量的旧条目保持原值） */
function recomputeAllCosts(s) {
    for (const bucketName of ['stats', 'session']) {
        const bucket = s[bucketName];
        if (!bucket || !bucket.models) continue;
        bucket.totalCost = recomputeBucketCost(s, bucket.models);
    }
    if (s.dailyStats && s.dailyStats.models) {
        s.dailyStats.cost = recomputeBucketCost(s, s.dailyStats.models);
    }
    if (Array.isArray(s.history)) {
        for (const rec of s.history) {
            if (rec && rec.models) rec.cost = recomputeBucketCost(s, rec.models);
        }
    }
    return s;
}

function onPricesChanged() {
    const s = getSettings();
    recomputeAllCosts(s);
    saveSettingsDebounced();
    safeUpdateUI();
}

/**
 * 只取「今天」的累计。
 * dailyStats 只在有请求进来时才会滚到新的一天，所以隔夜之后它里面还是
 * 昨天的数字。直接拿它当「今日」用，会把昨天再算一遍 —— 月预算、周额度、
 * 面板上的今日费用都受影响。
 */
function tfTodayStats(s) {
    const today = _todayStr();
    const d = s && s.dailyStats;
    if (!d || d.date !== today) return { cost: 0, tokens: 0, req: 0, models: {}, stale: !!d };
    return d;
}

/* ---------- 面板渲染 ---------- */

function tfButton(text, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu_button' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
}

function renderPriceWarnings(container, s) {
    const missing = collectUnpricedModels(s);
    if (!missing.length) return;

    const names = [...new Set(missing.map((m) => m.name))];
    const box = document.createElement('div');
    box.className = 'tf-price-warn';

    const text = document.createElement('span');
    text.textContent = '⚠ ' + safeT('这些模型没设单价，费用暂记 0') + '：'
        + names.slice(0, 3).join('、') + (names.length > 3 ? ' ' + safeT('等') : '')
        + '（' + names.length + '）';
    box.appendChild(text);
    box.appendChild(tfButton(safeT('一键补入价格表'), () => addMissingPrices(s), 'tf-diag-btn'));
    container.appendChild(box);
}

function tfDownload(filename, text) {
    try {
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
        globalThis.Toast?.system?.(safeT('已导出'));
    } catch (error) {
        tfLog('error', 'log.download', '导出日志失败: ' + (error?.message || error));
    }
}

function renderLogPanel(container, s) {
    const block = document.createElement('div');
    block.className = 'tf-log-block';

    const title = document.createElement('div');
    title.className = 'tf-model-title';
    title.textContent = '🧾 ' + safeT('运行日志') + ' · ' + tfLogs.length;
    block.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'tf-btn-row';
    actions.appendChild(tfButton(safeT('复制日志'), () => tfCopy(tfLogsToText(), safeT('已复制')), 'tf-diag-btn'));
    actions.appendChild(tfButton(safeT('复制诊断'), () => tfCopy(tfJson(tfDiagnostics()), safeT('已复制')), 'tf-diag-btn'));
    actions.appendChild(tfButton(safeT('导出'), () => tfDownload('sillytoken-logs.json',
        JSON.stringify({ diagnostics: tfDiagnostics(), logs: tfLogs.slice(-200) }, null, 2)), 'tf-diag-btn'));
    actions.appendChild(tfButton(safeT('清空'), () => { tfClearLogs(); safeUpdateUI(); }, 'tf-diag-btn'));
    block.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'tf-log-list';
    const recent = tfLogs.slice(-TF_LOG_VIEW).reverse();
    if (!recent.length) {
        const empty = document.createElement('div');
        empty.className = 'tf-log-empty';
        empty.textContent = safeT('暂无日志');
        list.appendChild(empty);
    }
    for (const entry of recent) {
        const row = document.createElement('div');
        row.className = 'tf-log-row tf-log-' + entry.level;

        const time = document.createElement('span');
        time.className = 'tf-log-time';
        time.textContent = entry.at;

        const body = document.createElement('span');
        body.className = 'tf-log-body';
        body.textContent = entry.stage + ' · ' + entry.message + (entry.details ? ' ' + tfJson(entry.details) : '');

        row.appendChild(time);
        row.appendChild(body);
        list.appendChild(row);
    }
    block.appendChild(list);
    container.appendChild(block);
}

// 给排障用的全局入口（世界书脚本 __wbmCacheInspectorDiagnostics 的对应物）
try {
    globalThis.__sillyTokenDiagnostics = tfDiagnostics;
    globalThis.__sillyTokenLogs = () => tfLogs.slice();
} catch { /* ignore */ }

/* ============================================================
 *  v2.4.0 · 范围化用量统计面板
 *  对齐 DeepSeek 开放平台 / New API 的视图：
 *    · 时间范围：预设（今天 / 近 7 天 / 本周 / 近 30 天 / 本月 / 全部）
 *      + 自定义起止日期（点范围条展开，原生 date 输入，平板上直接弹系统日历）
 *    · 日柱图按「连续日期」铺满，缺日补 0
 *    · 点选某天 → 下方固定显示当天按模型明细（平板上没有 hover）
 *    · 模型明细：费用 / 占比 / token / 输入 / 输出 / 缓存 / 命中率 / 请求数
 *    · 分组维度：按模型 / 按厂商
 *
 *  v2.4.0 起「范围」是唯一事实来源：图表与明细表共用同一个范围。
 * ============================================================ */

const TF_CHART_MAX_DAYS = 60;       // 柱子最多画这么多天，超出的部分只在合计里体现
const TF_CHART_LABELS = 6;          // 横轴最多显示几个日期刻度
const TF_TABLE_ROWS = 30;

const TF_PRESETS = [
    { id: 'today', label: '今天' },
    { id: '7d', label: '近 7 天' },
    { id: 'week', label: '本周' },
    { id: '30d', label: '近 30 天' },
    { id: 'month', label: '本月' },
    { id: 'all', label: '全部' },
];

let tfRange = { mode: 'preset', id: '7d', from: '', to: '' };
let tfRangeLoaded = false;
let tfPickerOpen = false;
let tfGroupMode = 'model';
let tfSelectedDay = null;
const tfUnpricedWarned = new Set();

/* ============================================================
 *  模型名归一化 + 别名（自动推断，可手动覆盖）
 *  归一化只做「去掉装饰」，不做有损猜测：
 *    deepseek/deepseek-v4-flash:free  ->  deepseek-v4-flash
 *    claude-3-5-sonnet-20260101       ->  claude-3-5-sonnet
 *  真正容易搞错的（deepseek-flash 到底是不是 deepseek-v4-flash）
 *  交给「显著词匹配 + 别名表」，并且命中方式会在界面上标出来。
 * ============================================================ */

const TF_VERSION_TOKEN = /^(v?\d+([.\-]\d+)*|\d+[bkm]|preview|latest|beta|rc|stable|exp|free|nitro)$/;

function tfCanonicalModel(name) {
    let n = String(name || '').toLowerCase().trim();
    n = n.replace(/^[a-z0-9_.-]+\//, '');                                  // vendor/ 前缀
    n = n.replace(/[_\s]+/g, '-');
    n = n.replace(/-(20\d{6}|20\d{2}-\d{2}-\d{2})$/, '');                  // 日期尾巴
    n = n.replace(/[-:](preview|latest|beta|rc|stable|exp|free|nitro)\d*$/g, '');
    n = n.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    return n;
}

/** 去掉版本/修饰词后剩下的「显著词」：gemini-3.5-flash -> [gemini, flash] */
function tfSignificantTokens(canonical) {
    return String(canonical || '').split('-').filter((t) => t && !TF_VERSION_TOKEN.test(t));
}

/** 只取版本/修饰词：gemini-3.5-flash -> [3.5]；deepseek-flash -> []（没有版本信息） */
function tfVersionTokens(canonical) {
    return String(canonical || '').split('-').filter((t) => t && TF_VERSION_TOKEN.test(t));
}

function tfAliasList(entry) {
    const raw = entry && entry.aliases;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : String(raw).split(/[,，;；\s]+/);
    return list.map(tfCanonicalModel).filter(Boolean);
}

function tfProviderOf(model, price) {
    const n = String((price && price.matchedName) || model || '').toLowerCase();
    if (n.includes('deepseek')) return 'DeepSeek';
    if (n.includes('claude') || n.includes('anthropic')) return 'Anthropic';
    if (n.includes('gemini') || n.includes('google') || n.includes('palm')) return 'Google';
    if (n.includes('kimi') || n.includes('moonshot')) return 'Moonshot';
    if (n.includes('qwen') || n.includes('tongyi')) return 'Qwen';
    if (n.includes('glm') || n.includes('zhipu')) return 'Zhipu';
    if (/^(gpt|o[1-9]|chatgpt)/.test(n)) return 'OpenAI';
    return '其他';
}

/* ============================================================
 *  价格缺失提醒：检测到就用 Toast 弹一次
 * ============================================================ */

function tfNotifyUnpricedModel(model, s) {
    const key = String(model || '').trim();
    if (!key || tfUnpricedWarned.has(key)) return;
    tfUnpricedWarned.add(key);

    let names = [key];
    try { names = [...new Set(collectUnpricedModels(s).map((m) => m.name))]; } catch { /* ignore */ }

    tfLog('warn', 'price.missing', '检测到未设单价的模型：' + key, {
        model: key, unpricedTotal: names.length, models: names.slice(0, 10),
    });

    // 模型名来自 API 响应，塞进 Toast 前把尖括号去掉（各宿主对 toast 文本的转义策略不一样）
    const safeName = String(key).replace(/[<>&]/g, '');
    try {
        globalThis.Toast?.warning?.(
            safeT('检测到未设单价的模型') + '：' + safeName + '（' + safeT('费用暂记 0，打开悬浮球可一键补入价格表') + '）',
            'SillyToken',
            { timeOut: 10000, extendedTimeOut: 15000, closeButton: true },
        );
    } catch { /* 宿主没有 Toast 就只写日志 */ }
}

/* ============================================================
 *  日期工具（全部按本地时区，和 _todayStr 保持一致）
 * ============================================================ */

function tfTodayDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function tfParseDay(str) {
    const parts = String(str || '').split('-').map((x) => parseInt(x, 10));
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return tfTodayDate();
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function tfDayOf(date) {
    return _todayStr(date);
}

function tfAddDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

/** 把当前范围解析成 [from, to] 两个本地零点日期 */
function tfRangeBounds(s, range) {
    const today = tfTodayDate();

    if (range && range.mode === 'custom' && range.from) {
        const from = tfParseDay(range.from);
        const to = range.to ? tfParseDay(range.to) : today;
        return from.getTime() <= to.getTime() ? { from, to } : { from: to, to: from };
    }

    switch (range && range.id) {
        case 'today':
            return { from: today, to: today };
        case 'week': {
            const offset = (today.getDay() + 6) % 7;   // 周一为一周之始
            return { from: tfAddDays(today, -offset), to: today };
        }
        case '30d':
            return { from: tfAddDays(today, -29), to: today };
        case 'month':
            return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
        case 'all': {
            const dates = (Array.isArray(s && s.history) ? s.history : [])
                .map((h) => (h && h.date) || '')
                .filter(Boolean)
                .sort();
            return { from: dates.length ? tfParseDay(dates[0]) : today, to: today };
        }
        case '7d':
        default:
            return { from: tfAddDays(today, -6), to: today };
    }
}

/**
 * 图表用的连续日期轴。
 * 只有「画柱子」被限制在 TF_CHART_MAX_DAYS 天内，
 * 合计与明细表仍然覆盖完整范围（clamped=true 时界面会说明）。
 */
function tfChartAxis(bounds) {
    const span = Math.round((bounds.to.getTime() - bounds.from.getTime()) / 86400000) + 1;
    const clamped = span > TF_CHART_MAX_DAYS;
    const start = clamped ? tfAddDays(bounds.to, -(TF_CHART_MAX_DAYS - 1)) : bounds.from;
    const count = clamped ? TF_CHART_MAX_DAYS : Math.max(1, span);
    const axis = [];
    for (let i = 0; i < count; i++) axis.push(tfDayOf(tfAddDays(start, i)));
    return { axis, clamped };
}

/* ============================================================
 *  范围聚合
 * ============================================================ */

function tfNewBucket() {
    return { in: 0, out: 0, cached: 0, req: 0, cost: 0, est: 0, unpriced: 0, rawNames: {} };
}

function tfAccumulate(bucket, src, rawName) {
    bucket.in += src.in || 0;
    bucket.out += src.out || 0;
    bucket.cached += src.cached || 0;
    bucket.req += src.req || 0;
    bucket.cost += src.cost || 0;
    bucket.est += src.est || 0;
    bucket.unpriced += src.unpriced || 0;
    if (rawName) bucket.rawNames[rawName] = (bucket.rawNames[rawName] || 0) + (src.req || 0);
    return bucket;
}

/**
 * 聚合当前范围。
 *   今天     —— 用实时 dailyStats（它是滚动的）
 *   其余日子 —— 逐日累加 history 里的按模型用量
 *   全部     —— 直接用 stats.models（全量最准），图表仍用 history
 * 没有「按模型用量」的老历史条目会被计入总计但无法归到具体模型，
 * 计进 legacyDays 并在界面上说明。
 */
function tfAggregateRange(s, range) {
    const bounds = tfRangeBounds(s, range);
    const chart = tfChartAxis(bounds);
    const fromKey = tfDayOf(bounds.from);
    const toKey = tfDayOf(bounds.to);
    const dayMap = new Map();
    const byModel = new Map();
    const byProvider = new Map();
    const summary = { ...tfNewBucket(), legacyDays: 0, legacyTokens: 0, legacyCost: 0 };

    const addModel = (name, entry) => {
        const price = getPriceFor(s, name);
        const groupKey = (price && price.matchedBy !== 'none')
            ? tfCanonicalModel(price.matchedName)
            : tfCanonicalModel(name);
        if (!byModel.has(groupKey)) {
            byModel.set(groupKey, {
                key: groupKey,
                display: (price && price.matchedName) || name,
                price,
                ...tfNewBucket(),
            });
        }
        const bucket = byModel.get(groupKey);
        bucket.price = price;
        tfAccumulate(bucket, entry, name);
        tfAccumulate(summary, entry, name);

        const provider = tfProviderOf(name, price);
        if (!byProvider.has(provider)) byProvider.set(provider, { key: provider, ...tfNewBucket() });
        tfAccumulate(byProvider.get(provider), entry, name);
    };

    if (range && range.mode === 'preset' && range.id === 'all') {
        for (const [name, entry] of Object.entries(s.stats.models || {})) addModel(name, entry);
        for (const rec of (s.history || [])) {
            if (rec && rec.date) dayMap.set(rec.date, rec);
        }
    } else {
        const inRange = (date) => date >= fromKey && date <= toKey;
        for (const rec of (s.history || [])) {
            if (!rec || !rec.date || !inRange(rec.date)) continue;
            dayMap.set(rec.date, rec);
        }
        // 今天以实时 dailyStats 为准（history 里那条是归档快照）
        const live = tfTodayStats(s);
        if (live && live.date && inRange(live.date)) {
            dayMap.set(live.date, {
                date: live.date,
                cost: live.cost || 0,
                tokens: live.tokens || 0,
                req: live.req || 0,
                models: live.models || {},
            });
        }
        for (const rec of dayMap.values()) {
            const models = rec.models && Object.keys(rec.models).length ? rec.models : null;
            if (models) {
                for (const [name, entry] of Object.entries(models)) addModel(name, entry);
            } else {
                // 老条目只有总量、没有按模型明细：单独计数。
                // 不能塞进「输入」里 —— 那会把输入抬高、把命中率压低。
                summary.legacyDays += 1;
                summary.legacyCost += rec.cost || 0;
                summary.legacyTokens += rec.tokens || 0;
                summary.cost += rec.cost || 0;
                summary.req += rec.req || 0;
            }
        }
    }

    const days = chart.axis.map((date) => {
        const rec = dayMap.get(date);
        return {
            date,
            cost: rec ? (rec.cost || 0) : 0,
            tokens: rec ? (rec.tokens || 0) : 0,
            req: (rec && rec.req) || 0,
            models: (rec && rec.models) || {},
        };
    });

    return {
        rangeId: (range && range.mode === 'custom') ? 'custom' : ((range && range.id) || '7d'),
        axis: chart.axis,
        clamped: chart.clamped,
        from: fromKey,
        to: toKey,
        days,
        summary,
        models: [...byModel.values()],
        providers: [...byProvider.values()],
    };
}

function tfGroupList(stats) {
    return tfGroupMode === 'provider' ? stats.providers : stats.models;
}

function tfHitRate(bucket) {
    const total = (bucket.cached || 0) + (bucket.in || 0);
    return total > 0 ? (bucket.cached || 0) / total : null;
}

function tfTotalTokens(bucket) {
    return (bucket.in || 0) + (bucket.out || 0) + (bucket.cached || 0);
}

/* ============================================================
 *  渲染
 * ============================================================ */

// 「相当于《X》N 本」用的书固定下来：旧版每次重绘都 Math.random()，
// 于是点一下柱子、切一下范围，这句话就换一本书。
let tfStoryBook = null;
function tfPickStoryBook(list) {
    if (!tfStoryBook && Array.isArray(list) && list.length) {
        tfStoryBook = list[Math.floor(Math.random() * list.length)];
    }
    return tfStoryBook || { name: '—', chars: 1 };
}

function tfChip(label, active, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tf-range-chip' + (active ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

function tfSaveRange(s) {
    s.statsRange = { mode: tfRange.mode, id: tfRange.id, from: tfRange.from, to: tfRange.to };
    saveSettingsDebounced();
}

function tfApplyCustom(s, from, to) {
    const bounds = tfRangeBounds(s, tfRange);
    tfRange = {
        mode: 'custom',
        id: 'custom',
        from: from || tfDayOf(bounds.from),
        to: to || tfDayOf(bounds.to),
    };
    tfSelectedDay = null;
    tfSaveRange(s);
    safeUpdateUI();
}

function tfRenderRangePicker(container, s) {
    const bounds = tfRangeBounds(s, tfRange);

    // 第一排：预设 + 分组维度
    const row = document.createElement('div');
    row.className = 'tf-range-row';

    const presets = document.createElement('div');
    presets.className = 'tf-range-group';
    for (const preset of TF_PRESETS) {
        const active = tfRange.mode === 'preset' && tfRange.id === preset.id;
        presets.appendChild(tfChip(safeT(preset.label), active, () => {
            tfRange = { mode: 'preset', id: preset.id, from: '', to: '' };
            tfPickerOpen = false;
            tfSelectedDay = null;
            tfSaveRange(s);
            safeUpdateUI();
        }));
    }
    row.appendChild(presets);

    const groups = document.createElement('div');
    groups.className = 'tf-range-group';
    groups.appendChild(tfChip(safeT('按模型'), tfGroupMode === 'model', () => { tfGroupMode = 'model'; safeUpdateUI(); }));
    groups.appendChild(tfChip(safeT('按厂商'), tfGroupMode === 'provider', () => { tfGroupMode = 'provider'; safeUpdateUI(); }));
    row.appendChild(groups);
    container.appendChild(row);

    // 第二排：范围条（点开选起止日期）
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'tf-range-bar'
        + (tfPickerOpen ? ' open' : '')
        + (tfRange.mode === 'custom' ? ' is-custom' : '');
    bar.title = safeT('点这里选起止日期');

    const barIcon = document.createElement('span');
    barIcon.className = 'tf-range-bar-icon';
    barIcon.textContent = '📅';

    const barText = document.createElement('span');
    barText.className = 'tf-range-bar-text';
    barText.textContent = tfDayOf(bounds.from) + ' 00:00 ~ ' + tfDayOf(bounds.to) + ' 23:00';

    bar.appendChild(barIcon);
    bar.appendChild(barText);
    if (tfRange.mode === 'custom') {
        const tag = document.createElement('span');
        tag.className = 'tf-range-bar-tag';
        tag.textContent = safeT('自定义');
        bar.appendChild(tag);
    }
    const caret = document.createElement('span');
    caret.className = 'tf-range-bar-caret';
    caret.textContent = tfPickerOpen ? '▲' : '▼';
    bar.appendChild(caret);

    bar.addEventListener('click', () => {
        tfPickerOpen = !tfPickerOpen;
        safeUpdateUI();
    });
    container.appendChild(bar);

    if (tfPickerOpen) container.appendChild(tfBuildRangeEditor(s, bounds));
}

function tfBuildRangeEditor(s, bounds) {
    const box = document.createElement('div');
    box.className = 'tf-range-editor';

    // 起始 / 结束：用原生 date 输入，平板上点一下就是系统日历，触控友好且不会写错
    const fields = document.createElement('div');
    fields.className = 'tf-range-fields';

    const makeField = (label, value, onPick) => {
        const wrap = document.createElement('label');
        wrap.className = 'tf-range-field';
        const cap = document.createElement('span');
        cap.className = 'tf-range-field-cap';
        cap.textContent = label;
        const input = document.createElement('input');
        input.type = 'date';
        input.className = 'tf-range-date';
        input.value = value;
        input.addEventListener('change', () => onPick(input.value));
        wrap.appendChild(cap);
        wrap.appendChild(input);
        return wrap;
    };

    fields.appendChild(makeField(safeT('起始时间'), tfDayOf(bounds.from), (v) => tfApplyCustom(s, v, null)));

    const sep = document.createElement('span');
    sep.className = 'tf-range-sep';
    sep.textContent = '~';
    fields.appendChild(sep);

    fields.appendChild(makeField(safeT('结束时间'), tfDayOf(bounds.to), (v) => tfApplyCustom(s, null, v)));
    box.appendChild(fields);

    // 快捷：和上面那排预设一致，点了立刻生效
    const quick = document.createElement('div');
    quick.className = 'tf-range-quick';
    const todayKey = tfDayOf(tfTodayDate());
    for (const preset of TF_PRESETS) {
        if (preset.id === 'all') continue;
        const picked = tfRangeBounds(s, { mode: 'preset', id: preset.id });
        const active = tfRange.mode === 'custom'
            && tfDayOf(picked.from) === tfDayOf(bounds.from)
            && tfDayOf(picked.to) === tfDayOf(bounds.to);
        quick.appendChild(tfChip(safeT(preset.label), active, () => {
            tfRange = { mode: 'custom', id: preset.id, from: tfDayOf(picked.from), to: tfDayOf(picked.to) };
            tfSelectedDay = null;
            tfSaveRange(s);
            safeUpdateUI();
        }));
    }
    box.appendChild(quick);

    const actions = document.createElement('div');
    actions.className = 'tf-range-actions';
    actions.appendChild(tfButton(safeT('今天'), () => tfApplyCustom(s, todayKey, todayKey), 'tf-diag-btn'));
    actions.appendChild(tfButton(safeT('清除'), () => {
        tfRange = { mode: 'preset', id: '7d', from: '', to: '' };
        tfPickerOpen = false;
        tfSelectedDay = null;
        tfSaveRange(s);
        safeUpdateUI();
    }, 'tf-diag-btn'));
    box.appendChild(actions);

    return box;
}

function tfRenderSummary(container, s, stats) {
    const box = document.createElement('div');
    box.className = 'tf-summary';

    const head = document.createElement('div');
    head.className = 'tf-summary-head';
    const money = document.createElement('div');
    money.className = 'tf-summary-money';
    money.textContent = fmtMoney(s, stats.summary.cost || 0);
    const meta = document.createElement('div');
    meta.className = 'tf-summary-meta';
    meta.textContent = tfGroupList(stats).length + ' ' + safeT('个分组') + ' · ' + (stats.summary.req || 0) + ' ' + safeT('次请求');
    head.appendChild(money);
    head.appendChild(meta);
    box.appendChild(head);

    const cells = document.createElement('div');
    cells.className = 'tf-summary-cells';
    const cell = (label, value) => {
        const d = document.createElement('div');
        d.className = 'tf-summary-cell';
        const v = document.createElement('div');
        v.className = 'tf-writing-val';
        v.textContent = value;
        const l = document.createElement('div');
        l.className = 'tf-writing-label';
        l.textContent = label;
        d.appendChild(v);
        d.appendChild(l);
        return d;
    };
    cells.appendChild(cell(safeT('总 Token'), fmtTokens(tfTotalTokens(stats.summary))));
    cells.appendChild(cell(safeT('输入'), fmtTokens(stats.summary.in || 0)));
    cells.appendChild(cell(safeT('输出'), fmtTokens(stats.summary.out || 0)));
    cells.appendChild(cell(safeT('缓存命中'), fmtTokens(stats.summary.cached || 0)));
    const rate = tfHitRate(stats.summary);
    cells.appendChild(cell(safeT('命中率'), rate === null ? '—' : (rate * 100).toFixed(1) + '%'));
    box.appendChild(cells);

    if (stats.summary.est > 0) {
        const est = document.createElement('div');
        est.className = 'tf-writing-hint';
        est.textContent = '⚠ ' + safeT('其中 {n} 次为本地估算').replace('{n}', String(stats.summary.est));
        box.appendChild(est);
    }
    if (stats.summary.legacyDays > 0) {
        const legacy = document.createElement('div');
        legacy.className = 'tf-writing-hint';
        legacy.textContent = safeT('有 {n} 天的旧记录没有按模型明细，只计入总计').replace('{n}', String(stats.summary.legacyDays))
            + (stats.summary.legacyTokens ? '（' + fmtTokens(stats.summary.legacyTokens) + ' token）' : '');
        box.appendChild(legacy);
    }

    container.appendChild(box);
}

function tfRenderChart(container, s, stats) {
    const block = document.createElement('div');
    block.className = 'tf-chart';

    const title = document.createElement('div');
    title.className = 'tf-model-title';
    // 范围很长时柱子只画得下 TF_CHART_MAX_DAYS 天，必须说明，
    // 否则用户会以为图表和上面的合计对不上是算错了
    const clampedNote = stats.clamped
        ? ' · ' + safeT('图表最多显示 {n} 天').replace('{n}', String(TF_CHART_MAX_DAYS))
        : '';
    title.textContent = '📈 ' + safeT('每日消费') + clampedNote + ' · ' + safeT('点柱子看当天明细');
    block.appendChild(title);

    const maxCost = Math.max(0, ...stats.days.map((d) => d.cost || 0));
    const bars = document.createElement('div');
    bars.className = 'tf-chart-bars';

    const labelEvery = Math.max(1, Math.ceil(stats.days.length / TF_CHART_LABELS));
    stats.days.forEach((day, index) => {
        const col = document.createElement('button');
        col.type = 'button';
        col.className = 'tf-chart-col' + (tfSelectedDay === day.date ? ' selected' : '');
        col.title = day.date + ' · ' + fmtMoney(s, day.cost || 0) + ' · ' + fmtTokens(day.tokens || 0);

        const bar = document.createElement('div');
        bar.className = 'tf-chart-bar' + ((day.cost || 0) > 0 ? '' : ' empty');
        const pct = maxCost > 0 ? ((day.cost || 0) / maxCost) * 100 : 0;
        bar.style.height = ((day.cost || 0) > 0 ? Math.max(4, pct) : 2) + '%';
        col.appendChild(bar);

        const label = document.createElement('span');
        label.className = 'tf-chart-label';
        label.textContent = (index % labelEvery === 0 || index === stats.days.length - 1)
            ? day.date.slice(5).replace('-', '/')
            : '';
        col.appendChild(label);

        col.addEventListener('click', () => {
            tfSelectedDay = tfSelectedDay === day.date ? null : day.date;
            safeUpdateUI();
        });
        bars.appendChild(col);
    });
    block.appendChild(bars);

    container.appendChild(block);
}

function tfRenderDayDetail(container, s, stats) {
    if (!tfSelectedDay) return;
    const day = stats.days.find((d) => d.date === tfSelectedDay);
    if (!day) return;

    const box = document.createElement('div');
    box.className = 'tf-day-detail';

    const head = document.createElement('div');
    head.className = 'tf-day-detail-head';
    const left = document.createElement('span');
    left.textContent = day.date;
    const right = document.createElement('span');
    right.textContent = fmtMoney(s, day.cost || 0) + ' · ' + fmtTokens(day.tokens || 0) + ' · ' + day.req + ' ' + safeT('次');
    head.appendChild(left);
    head.appendChild(right);
    box.appendChild(head);

    const entries = Object.entries(day.models || {});
    if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'tf-writing-hint';
        empty.textContent = safeT('这天没有按模型明细');
        box.appendChild(empty);
    }
    entries.sort((a, b) => (b[1].cost || 0) - (a[1].cost || 0));
    for (const [name, entry] of entries) {
        const item = document.createElement('div');
        item.className = 'tf-day-detail-item';

        const line = document.createElement('div');
        line.className = 'tf-day-detail-row';
        const n = document.createElement('span');
        n.className = 'tf-day-detail-name';
        n.textContent = name;
        const v = document.createElement('span');
        v.className = 'tf-day-detail-val';
        v.textContent = fmtMoney(s, entry.cost || 0) + ' · ' + fmtTokens(tfTotalTokens(entry));
        line.appendChild(n);
        line.appendChild(v);
        item.appendChild(line);

        // 第二行：和下面明细表同一个口径，省得两处对不上
        const breakdown = document.createElement('div');
        breakdown.className = 'tf-day-detail-breakdown';
        breakdown.textContent = safeT('输入') + ' ' + fmtTokens(entry.in || 0)
            + ' · ' + safeT('输出') + ' ' + fmtTokens(entry.out || 0)
            + ' · ' + safeT('缓存命中') + ' ' + fmtTokens(entry.cached || 0);
        item.appendChild(breakdown);

        box.appendChild(item);
    }

    container.appendChild(box);
}

function tfRenderGroupTable(container, s, stats) {
    const list = tfGroupList(stats).slice().sort((a, b) => (b.cost || 0) - (a.cost || 0));
    if (!list.length) return;

    const sumCost = list.reduce((n, m) => n + (m.cost || 0), 0) || 1;
    const tbl = document.createElement('div');
    tbl.className = 'tf-model-table';

    const title = document.createElement('div');
    title.className = 'tf-model-title';
    title.textContent = safeT('明细') + ' · ' + (tfGroupMode === 'provider' ? safeT('按厂商') : safeT('按模型')) + ' · ' + safeT('按费用排序');
    tbl.appendChild(title);

    const palette = ['#5eead4', '#93c5fd', '#c4b5fd', '#fda4af', '#fcd34d', '#86efac', '#f9a8d4', '#a5b4fc'];
    list.slice(0, TF_TABLE_ROWS).forEach((entry, index) => {
        const share = (entry.cost || 0) / sumCost;
        const row = document.createElement('div');
        row.className = 'tf-model-row';

        const left = document.createElement('div');
        const topLine = document.createElement('div');
        topLine.className = 'tf-model-top';

        const rank = document.createElement('span');
        rank.className = 'tf-model-rank';
        rank.textContent = index + 1;
        rank.style.background = palette[index % palette.length];
        topLine.appendChild(rank);

        const nameEl = document.createElement('span');
        nameEl.className = 'tf-model-name';
        nameEl.textContent = entry.display || entry.key;
        topLine.appendChild(nameEl);

        const price = entry.price || {};
        if (price.matchedBy === 'none') {
            const badge = document.createElement('span');
            badge.className = 'tf-mult-badge tf-badge-warn';
            badge.textContent = safeT('未设单价');
            badge.title = safeT('这个模型在价格表里找不到，费用暂时是 0');
            topLine.appendChild(badge);
        } else if (price.matchedBy === 'alias' || price.matchedBy === 'ambiguous') {
            const badge = document.createElement('span');
            badge.className = 'tf-mult-badge';
            badge.textContent = (price.matchedBy === 'ambiguous' ? '≈ ' : '= ') + price.matchedName;
            badge.title = price.matchedBy === 'ambiguous'
                ? safeT('同族有多个候选，自动推断可能不准，建议手动指定别名')
                : safeT('按别名自动推断到这一档价格');
            topLine.appendChild(badge);
        } else if (price.matchedBy === 'fuzzy') {
            const badge = document.createElement('span');
            badge.className = 'tf-mult-badge';
            badge.textContent = '≈ ' + price.matchedName;
            badge.title = safeT('模糊匹配到这一档价格');
            topLine.appendChild(badge);
        } else if (typeof price.multiplier === 'number' && price.multiplier !== 1) {
            const badge = document.createElement('span');
            badge.className = 'tf-mult-badge';
            badge.textContent = '× ' + price.multiplier;
            topLine.appendChild(badge);
        }

        const meta = document.createElement('span');
        meta.className = 'tf-model-meta';
        meta.textContent = fmtTokens(tfTotalTokens(entry)) + ' · ' + (entry.req || 0) + ' ' + safeT('次');
        topLine.appendChild(meta);

        const bar = document.createElement('div');
        bar.className = 'tf-model-bar';
        const fill = document.createElement('div');
        fill.className = 'tf-model-bar-fill';
        fill.style.width = Math.round(share * 100) + '%';
        fill.style.background = palette[index % palette.length];
        const pct = document.createElement('span');
        pct.className = 'tf-model-bar-pct';
        pct.textContent = (share * 100).toFixed(share * 100 < 10 ? 1 : 0) + '%';
        bar.appendChild(fill);
        bar.appendChild(pct);

        const breakdown = document.createElement('div');
        breakdown.className = 'tf-model-breakdown';
        const rate = tfHitRate(entry);
        breakdown.textContent = safeT('输入') + ' ' + fmtTokens(entry.in || 0)
            + ' · ' + safeT('输出') + ' ' + fmtTokens(entry.out || 0)
            + ' · ' + safeT('缓存') + ' ' + fmtTokens(entry.cached || 0)
            + ' · ' + safeT('命中率') + ' ' + (rate === null ? '—' : (rate * 100).toFixed(1) + '%');
        if (entry.est > 0) breakdown.textContent += ' · ' + safeT('含估算') + ' ' + entry.est;

        const rawNames = Object.keys(entry.rawNames || {});
        if (rawNames.length > 1 || (rawNames.length === 1 && rawNames[0] !== entry.display)) {
            const raw = document.createElement('div');
            raw.className = 'tf-writing-hint';
            raw.textContent = safeT('来源模型名') + '：' + rawNames.join('、');
            left.appendChild(raw);
        }

        left.insertBefore(topLine, left.firstChild);
        left.appendChild(bar);
        left.appendChild(breakdown);

        const right = document.createElement('div');
        right.className = 'tf-model-cost';
        right.textContent = fmtMoney(s, entry.cost || 0);

        row.appendChild(left);
        row.appendChild(right);
        tbl.appendChild(row);
    });

    container.appendChild(tbl);
}

function renderStatsPanel(container, s) {
    if (!tfRangeLoaded) {
        tfRangeLoaded = true;
        const saved = s && s.statsRange;
        if (saved && typeof saved === 'object' && saved.mode) {
            tfRange = { mode: saved.mode, id: saved.id || '7d', from: saved.from || '', to: saved.to || '' };
        }
    }

    let stats = null;
    try {
        stats = tfAggregateRange(s, tfRange);
    } catch (error) {
        // 不能直接 return 留一块空白：给一条看得见的提示，细节在运行日志里
        tfLog('error', 'stats.aggregate', '统计聚合失败: ' + (error?.message || error));
        const box = document.createElement('div');
        box.className = 'tf-price-warn';
        box.textContent = safeT('统计渲染失败，详情见下方运行日志') + '：' + (error?.message || error);
        container.appendChild(box);
        return;
    }

    tfRenderRangePicker(container, s);
    tfRenderSummary(container, s, stats);
    tfRenderChart(container, s, stats);
    tfRenderDayDetail(container, s, stats);
    tfRenderGroupTable(container, s, stats);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
    initialize();
}