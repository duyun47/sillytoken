// SillyToken · 厂商模型目录（内置静态快照）
// ---------------------------------------------------------------------------
// 这是什么：一份「厂商 → 模型 → 上下文 / 能力 / 参考价 / 状态」的离线目录。
// 插件不发任何网络请求，所以这里的数据是随版本发布的**快照**，不是实时行情。
//
// 数据从哪来：
//   1) 本轮由人工检索各厂商官方文档整理（见每条 entry 的 source 字段），
//      检索日 2026-10-30；第三方聚合站只用于交叉校验。
//   2) 标注 status: 'unverified' 的条目来自插件内置价表（PRESET_MODELS），
//      厂商文档未逐条核对：上下文/能力留空，价格沿用价表，不猜。
//   3) 人民币原价按 1 USD ≈ 6.71 CNY 折算为 USD/1M tokens。
//
// 怎么维护（三种方式，按侵入性从低到高）：
//   a. 面板 → 管理 → 厂商目录 →「导入目录」：不改本文件，结果存进 settings。
//   b. 改本文件后重新发布扩展：适用于对外分发（记得同步 TF_CATALOG_UPDATED_AT）。
//   c. 面板 → 管理 → 厂商目录 →「恢复内置」：丢弃 settings 里的自定义目录。
//
// 字段约定：
//   context / maxOutput   tokens；null = 查不到，界面显示「未收录」，不猜。
//   capabilities          只能取 TF_CATALOG_CAPABILITIES 里的值。
//   status                ga | preview | deprecated | unverified。
//   prices                USD / 1M tokens；null = 该项查不到；perRequest 为按次计价（多为 0）。
//   source / checkedAt    该条目的来源与核对日期——数据可追溯，是本目录的底线。
// ---------------------------------------------------------------------------

export const TF_CATALOG_SCHEMA = 'sillytoken-catalog/v1';
export const TF_CATALOG_UPDATED_AT = '2026-10-30';
export const TF_CATALOG_CURRENCY = 'USD';

export const TF_CATALOG_CAPABILITIES = ['text', 'vision', 'audio', 'tools', 'reasoning', 'caching', 'image_gen'];

export const TF_CATALOG_STATUS_NOTE = {
    ga: '正式可用',
    preview: '预览版',
    deprecated: '厂商已弃用',
    unverified: '未核对（来自内置价表）',
};

export const TF_BUILTIN_CATALOG =
{
    "schema": "sillytoken-catalog/v1",
    "updatedAt": "2026-10-30",
    "currency": "USD",
    "notes": "检索于 2026-10-30（UTC），数据取自各厂商官方文档（developers.openai.com、platform.claude.com、ai.google.dev、api-docs.deepseek.com、platform.kimi.ai、alibabacloud.com/model-studio、glmmodel.cn、docs.x.ai、docs.mistral.ai、llama.com、openrouter.ai），第三方聚合站仅用于交叉校验；人民币原价按 1 USD = 6.71 CNY 折算（中国货币网 2026-10-30 即期 6.7138），DeepSeek 列高峰价（空闲时段为 5 折），Gemini 3.8 Flash 列 2026-12-31 前入门价（2027-01-01 起标准价为 $1.50/$7.50 per 1M）。",
    "vendors": [
        {
            "id": "openai",
            "name": "OpenAI",
            "site": "https://platform.openai.com/docs/models",
            "sillyTavernSource": "openai",
            "models": [
                {
                    "id": "gpt-5.6-sol",
                    "label": "GPT-5.6 Sol",
                    "context": 1050000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 4,
                        "output": 20,
                        "cached": 0.4,
                        "perRequest": 0
                    },
                    "source": "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "gpt-5.6-terra",
                    "label": "GPT-5.6 Terra",
                    "context": 1050000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 2,
                        "output": 12,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "gpt-5.6-luna",
                    "label": "GPT-5.6 Luna",
                    "context": 1050000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.2,
                        "output": 1.2,
                        "cached": 0.02,
                        "perRequest": 0
                    },
                    "source": "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "gpt-5.4",
                    "label": "GPT-5.4",
                    "context": 400000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 2.5,
                        "output": 15,
                        "cached": 0.25,
                        "perRequest": 0
                    },
                    "source": "https://developers.openai.com/api/docs/models/gpt-5.4",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "gpt-5.4-mini",
                    "label": "GPT-5.4 mini",
                    "context": 400000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.75,
                        "output": 4.5,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "gpt-5.4-nano",
                    "label": "GPT-5.4 nano",
                    "context": 400000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.2,
                        "output": 1.25,
                        "cached": 0.02,
                        "perRequest": 0
                    },
                    "source": "https://developers.openai.com/api/docs/models/gpt-5.4-nano",
                    "checkedAt": "2026-10-30"
                }
            ]
        },
        {
            "id": "anthropic",
            "name": "Anthropic",
            "site": "https://platform.claude.com/docs/en/about-claude/models/overview",
            "sillyTavernSource": "claude",
            "models": [
                {
                    "id": "claude-fable-5-1",
                    "label": "Claude Fable 5.1",
                    "context": 1000000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 10,
                        "output": 50,
                        "cached": 0.25,
                        "perRequest": 0
                    },
                    "source": "https://platform.claude.com/docs/en/models/fable-5-1/overview",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "claude-opus-5-5",
                    "label": "Claude Opus 5.5",
                    "context": 1000000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 4,
                        "output": 20,
                        "cached": 0.2,
                        "perRequest": 0
                    },
                    "source": "https://platform.claude.com/docs/en/about-claude/models/overview",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "claude-sonnet-5-5",
                    "label": "Claude Sonnet 5.5",
                    "context": 1000000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 2,
                        "output": 10,
                        "cached": 0.1,
                        "perRequest": 0
                    },
                    "source": "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "claude-haiku-5-5",
                    "label": "Claude Haiku 5.5",
                    "context": 1000000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.1,
                        "output": 0.5,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://platform.claude.com/docs/en/models/haiku-5-5/overview",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "claude-opus-4-6",
                    "label": "Claude Opus 4.6",
                    "context": 1000000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "deprecated",
                    "prices": {
                        "input": 5,
                        "output": 25,
                        "cached": 0.5,
                        "perRequest": 0
                    },
                    "source": "https://platform.claude.com/docs/en/models/opus-4-6/overview",
                    "checkedAt": "2026-10-30",
                    "aliases": [
                        "claude-opus-4.6"
                    ]
                },
                {
                    "id": "claude-sonnet-4.6",
                    "label": "Claude Sonnet 4.6",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [],
                    "status": "unverified",
                    "prices": {
                        "input": 3.0,
                        "output": 15.0,
                        "cached": 0.3,
                        "perRequest": 0
                    },
                    "source": "内置价表（PRESET_MODELS），厂商文档未核对",
                    "checkedAt": "2026-09-16"
                }
            ]
        },
        {
            "id": "google",
            "name": "Google",
            "site": "https://ai.google.dev/gemini-api/docs/models",
            "sillyTavernSource": "makersuite",
            "models": [
                {
                    "id": "gemini-3.8-flash",
                    "label": "Gemini 3.8 Flash",
                    "context": 1048576,
                    "maxOutput": 65536,
                    "capabilities": [
                        "text",
                        "vision",
                        "audio",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.75,
                        "output": 3.75,
                        "cached": 0.075,
                        "perRequest": 0
                    },
                    "source": "https://ai.google.dev/gemini-api/docs/pricing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "gemini-3.5-flash",
                    "label": "Gemini 3.5 Flash",
                    "context": 1048576,
                    "maxOutput": 65536,
                    "capabilities": [
                        "text",
                        "vision",
                        "audio",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 1.5,
                        "output": 9,
                        "cached": 0.15,
                        "perRequest": 0
                    },
                    "source": "https://ai.google.dev/gemini-api/docs/pricing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "gemini-3-pro-preview",
                    "label": "Gemini 3 Pro (Preview)",
                    "context": 1048576,
                    "maxOutput": 65535,
                    "capabilities": [
                        "text",
                        "vision",
                        "audio",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "preview",
                    "prices": {
                        "input": 2,
                        "output": 12,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://ai.google.dev/gemini-api/docs/pricing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "gemini-3.1-pro",
                    "label": "Gemini 3.1 Pro",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [],
                    "status": "unverified",
                    "prices": {
                        "input": 2.0,
                        "output": 12.0,
                        "cached": 0.4,
                        "perRequest": 0
                    },
                    "source": "内置价表（PRESET_MODELS），厂商文档未核对",
                    "checkedAt": "2026-09-16"
                },
                {
                    "id": "gemini-3.6-flash",
                    "label": "Gemini 3.6 Flash",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [],
                    "status": "unverified",
                    "prices": {
                        "input": 1.5,
                        "output": 7.5,
                        "cached": 0.3,
                        "perRequest": 0
                    },
                    "source": "内置价表（PRESET_MODELS），厂商文档未核对",
                    "checkedAt": "2026-09-16"
                },
                {
                    "id": "gemini-3.7-flash",
                    "label": "Gemini 3.7 Flash",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [],
                    "status": "unverified",
                    "prices": {
                        "input": 0.75,
                        "output": 3.75,
                        "cached": 0.15,
                        "perRequest": 0
                    },
                    "source": "内置价表（PRESET_MODELS），厂商文档未核对",
                    "checkedAt": "2026-09-16"
                },
                {
                    "id": "gemini-3-flash",
                    "label": "Gemini 3 Flash",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [],
                    "status": "unverified",
                    "prices": {
                        "input": 0.5,
                        "output": 3.0,
                        "cached": 0.05,
                        "perRequest": 0
                    },
                    "source": "内置价表（PRESET_MODELS），厂商文档未核对",
                    "checkedAt": "2026-09-16"
                },
                {
                    "id": "gemini-2.5-pro",
                    "label": "Gemini 2.5 Pro",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [],
                    "status": "unverified",
                    "prices": {
                        "input": 1.25,
                        "output": 10.0,
                        "cached": 0.125,
                        "perRequest": 0
                    },
                    "source": "内置价表（PRESET_MODELS），厂商文档未核对",
                    "checkedAt": "2026-09-16"
                },
                {
                    "id": "gemma-4-31b-it",
                    "label": "Gemma 4 31B IT",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [],
                    "status": "unverified",
                    "prices": {
                        "input": 0.15,
                        "output": 0.6,
                        "cached": 0.0,
                        "perRequest": 0
                    },
                    "source": "内置价表（PRESET_MODELS），厂商文档未核对",
                    "checkedAt": "2026-09-16"
                },
                {
                    "id": "gemma-4-26b-a4b-it",
                    "label": "Gemma 4 26B A4B IT",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [],
                    "status": "unverified",
                    "prices": {
                        "input": 0.15,
                        "output": 0.6,
                        "cached": 0.0,
                        "perRequest": 0
                    },
                    "source": "内置价表（PRESET_MODELS），厂商文档未核对",
                    "checkedAt": "2026-09-16"
                }
            ]
        },
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "site": "https://api-docs.deepseek.com/quick_start/pricing",
            "sillyTavernSource": "deepseek",
            "models": [
                {
                    "id": "deepseek-v4-pro",
                    "label": "DeepSeek V4 Pro",
                    "context": 1000000,
                    "maxOutput": 384000,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 1.32,
                        "output": 3.96,
                        "cached": 0.044,
                        "perRequest": 0
                    },
                    "source": "https://api-docs.deepseek.com/quick_start/pricing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "deepseek-flash",
                    "label": "DeepSeek V4.1 Flash",
                    "context": 1000000,
                    "maxOutput": 384000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.3,
                        "output": 1.2,
                        "cached": 0.006,
                        "perRequest": 0
                    },
                    "source": "https://api-docs.deepseek.com/quick_start/pricing",
                    "checkedAt": "2026-10-30",
                    "aliases": [
                        "deepseek-v4-flash"
                    ]
                }
            ]
        },
        {
            "id": "moonshot",
            "name": "Moonshot / Kimi",
            "site": "https://platform.kimi.ai/docs/pricing/chat",
            "sillyTavernSource": "moonshot",
            "models": [
                {
                    "id": "kimi-k3.1-pro",
                    "label": "Kimi K3.1 Pro",
                    "context": 1048576,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 2,
                        "output": 10,
                        "cached": 0.2,
                        "perRequest": 0
                    },
                    "source": "https://platform.kimi.ai/docs/pricing/chat",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "kimi-k3",
                    "label": "Kimi K3",
                    "context": 1048576,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": null,
                        "output": null,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://platform.kimi.ai/docs/pricing/chat",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "kimi-k2.7-code",
                    "label": "Kimi K2.7 Code",
                    "context": 262144,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "deprecated",
                    "prices": {
                        "input": 0.95,
                        "output": 4,
                        "cached": 0.19,
                        "perRequest": 0
                    },
                    "source": "https://platform.kimi.ai/docs/pricing/chat",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "kimi-k2.6",
                    "label": "Kimi K2.6",
                    "context": 262144,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "deprecated",
                    "prices": {
                        "input": 0.95,
                        "output": 4,
                        "cached": 0.19,
                        "perRequest": 0
                    },
                    "source": "https://platform.kimi.ai/docs/pricing/chat",
                    "checkedAt": "2026-10-30"
                }
            ]
        },
        {
            "id": "alibaba",
            "name": "阿里云通义千问 Qwen",
            "site": "https://www.alibabacloud.com/help/en/model-studio/models",
            "sillyTavernSource": null,
            "models": [
                {
                    "id": "qwen3.8-max",
                    "label": "Qwen3.8 Max",
                    "context": 1000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 2,
                        "output": 6,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.alibabacloud.com/help/zh/model-studio/model-pricing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "qwen3.7-max",
                    "label": "Qwen3.7 Max",
                    "context": 1000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 2.5,
                        "output": 7.5,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.alibabacloud.com/help/zh/model-studio/model-pricing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "qwen3.7-plus",
                    "label": "Qwen3.7 Plus",
                    "context": 1000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.4,
                        "output": 1.6,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.alibabacloud.com/help/zh/model-studio/model-pricing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "qwen3.8-flash",
                    "label": "Qwen3.8 Flash",
                    "context": 1000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.15,
                        "output": 0.47,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.alibabacloud.com/help/zh/model-studio/model-pricing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "qwen-plus-character",
                    "label": "Qwen Plus Character（角色扮演）",
                    "context": null,
                    "maxOutput": null,
                    "capabilities": [
                        "text"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.5,
                        "output": 1.4,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.alibabacloud.com/help/zh/model-studio/model-pricing",
                    "checkedAt": "2026-10-30"
                }
            ]
        },
        {
            "id": "zhipu",
            "name": "智谱 GLM",
            "site": "https://www.glmmodel.cn/models.html",
            "sillyTavernSource": "zai",
            "models": [
                {
                    "id": "glm-5.3",
                    "label": "GLM-5.3",
                    "context": 1000000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 1.19,
                        "output": 4.17,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.glmmodel.cn/models.html",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "glm-5.2",
                    "label": "GLM-5.2",
                    "context": 1000000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 1.19,
                        "output": 4.17,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.glmmodel.cn/models.html",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "glm-5.3-flash",
                    "label": "GLM-5.3-Flash",
                    "context": 1000000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.06,
                        "output": 0.21,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.glmmodel.cn/models.html",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "glm-5.1",
                    "label": "GLM-5.1",
                    "context": 200000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.89,
                        "output": 3.58,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.glmmodel.cn/models.html",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "glm-4.7",
                    "label": "GLM-4.7",
                    "context": 200000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.3,
                        "output": 1.19,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.glmmodel.cn/models.html",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "glm-5v-turbo",
                    "label": "GLM-5V-Turbo",
                    "context": 200000,
                    "maxOutput": 128000,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.75,
                        "output": 3.28,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.glmmodel.cn/models.html",
                    "checkedAt": "2026-10-30"
                }
            ]
        },
        {
            "id": "xai",
            "name": "xAI",
            "site": "https://docs.x.ai/docs/models",
            "sillyTavernSource": "xai",
            "models": [
                {
                    "id": "grok-4.7",
                    "label": "Grok 4.7",
                    "context": 500000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 2,
                        "output": 6,
                        "cached": 0.55,
                        "perRequest": 0
                    },
                    "source": "https://docs.x.ai/docs/models",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "grok-4.1-fast-reasoning",
                    "label": "Grok 4.1 Fast (Reasoning)",
                    "context": 2000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning",
                        "caching"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.2,
                        "output": 0.5,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://docs.x.ai/docs/models",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "grok-4.1-fast-non-reasoning",
                    "label": "Grok 4.1 Fast (Non-Reasoning)",
                    "context": 2000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.2,
                        "output": 0.5,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://docs.x.ai/docs/models",
                    "checkedAt": "2026-10-30"
                }
            ]
        },
        {
            "id": "mistral",
            "name": "Mistral AI",
            "site": "https://docs.mistral.ai/getting-started/models/models_overview/",
            "sillyTavernSource": "mistralai",
            "models": [
                {
                    "id": "mistral-medium-3.5",
                    "label": "Mistral Medium 3.5",
                    "context": 262144,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "tools",
                        "reasoning"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 1.5,
                        "output": 7.5,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://docs.mistral.ai/getting-started/models/models_overview/",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "mistral-large-3",
                    "label": "Mistral Large 3",
                    "context": 262144,
                    "maxOutput": 32768,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0.5,
                        "output": 1.5,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://docs.mistral.ai/getting-started/models/models_overview/",
                    "checkedAt": "2026-10-30"
                }
            ]
        },
        {
            "id": "meta",
            "name": "Meta Llama（开放权重）",
            "site": "https://www.llama.com/models/llama-4/",
            "sillyTavernSource": null,
            "models": [
                {
                    "id": "llama-4-maverick",
                    "label": "Llama 4 Maverick",
                    "context": 1000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": null,
                        "output": null,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/open-models/use-llama",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "llama-4-scout",
                    "label": "Llama 4 Scout",
                    "context": 10000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": null,
                        "output": null,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/open-models/use-llama",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "llama-3.3-70b-instruct",
                    "label": "Llama 3.3 70B Instruct",
                    "context": 131072,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "tools"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": null,
                        "output": null,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://www.llama.com/models/llama-4/",
                    "checkedAt": "2026-10-30"
                }
            ]
        },
        {
            "id": "openrouter",
            "name": "OpenRouter（聚合路由）",
            "site": "https://openrouter.ai/models",
            "sillyTavernSource": "openrouter",
            "models": [
                {
                    "id": "openrouter/auto",
                    "label": "Auto Router",
                    "context": 2000000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools",
                        "reasoning"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": null,
                        "output": null,
                        "cached": null,
                        "perRequest": 0
                    },
                    "source": "https://openrouter.ai/docs/features/model-routing",
                    "checkedAt": "2026-10-30"
                },
                {
                    "id": "openrouter/free",
                    "label": "Free Models Router",
                    "context": 200000,
                    "maxOutput": null,
                    "capabilities": [
                        "text",
                        "vision",
                        "tools"
                    ],
                    "status": "ga",
                    "prices": {
                        "input": 0,
                        "output": 0,
                        "cached": 0,
                        "perRequest": 0
                    },
                    "source": "https://openrouter.ai/docs/features/model-routing",
                    "checkedAt": "2026-10-30"
                }
            ]
        }
    ]
};

export default TF_BUILTIN_CATALOG;
