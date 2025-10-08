// src/core/llm.ts
import {
	InterpretationSchema,
	type Interpretation,
} from '../types/interpretation.js'
import { SYSTEM_PROMPT_RU } from './prompts.js'

// ---- Provider selection & env ----
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'openai').toLowerCase()

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

const YANDEX_API_KEY =
	process.env.YANDEX_API_KEY || process.env.YC_API_KEY || ''
const YANDEX_FOLDER_ID =
	process.env.YANDEX_FOLDER_ID || process.env.YC_FOLDER_ID || ''
const YANDEX_MODEL =
	process.env.YANDEX_MODEL ||
	(YANDEX_FOLDER_ID ? `gpt://${YANDEX_FOLDER_ID}/yandexgpt-lite/latest` : '')

// ---- Small utils ----
const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

async function fetchWithTimeout(
	input: RequestInfo,
	init: RequestInit & { timeoutMs?: number } = {}
) {
	const { timeoutMs = 30000, ...rest } = init
	const controller = new AbortController()
	const id = setTimeout(
		() => controller.abort(new Error('Request timeout')),
		timeoutMs
	)
	try {
		// @ts-ignore
		return await fetch(input, { ...rest, signal: controller.signal })
	} finally {
		clearTimeout(id)
	}
}

function clampStr(s: unknown, max = 700): string | null {
	if (typeof s !== 'string') return null
	return s.length > max ? s.slice(0, max) : s
}

function sanitizeLlmJson(obj: any) {
	if (!obj || typeof obj !== 'object') return obj
	obj.esoteric_interpretation = clampStr(obj.esoteric_interpretation, 700) ?? ''
	obj.barnum_insight = clampStr(obj.barnum_insight, 700) ?? obj.barnum_insight
	obj.reflective_question =
		clampStr(obj.reflective_question, 300) ?? obj.reflective_question
	return obj
}

// ---- Yandex chat wrapper ----
type YaMsg = { role: 'system' | 'user' | 'assistant'; text: string }
async function yandexChat(
	messages: YaMsg[],
	opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
	if (!YANDEX_API_KEY) throw new Error('YANDEX_API_KEY is not set')
	const modelUri =
		YANDEX_MODEL ||
		(YANDEX_FOLDER_ID ? `gpt://${YANDEX_FOLDER_ID}/yandexgpt-lite/latest` : '')
	if (!modelUri.startsWith('gpt://')) {
		throw new Error('YANDEX_MODEL (modelUri) is not set correctly')
	}

	const body = {
		modelUri,
		completionOptions: {
			stream: false,
			temperature:
				typeof opts?.temperature === 'number' ? opts.temperature : 0.3,
			maxTokens: typeof opts?.maxTokens === 'number' ? opts.maxTokens : 1024,
		},
		messages,
	}

	const res = await fetchWithTimeout(
		'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
		{
			method: 'POST',
			headers: {
				Authorization: `Api-Key ${YANDEX_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			timeoutMs: 30000,
		}
	)

	const raw = await res.text()
	if (!res.ok) {
		let hint = ''
		try {
			hint = JSON.parse(raw)?.error?.message || ''
		} catch {}
		throw new Error(
			`Yandex LLM HTTP ${res.status}: ${hint || raw.slice(0, 400)}`
		)
	}
	let json: any
	try {
		json = JSON.parse(raw)
	} catch {
		throw new Error('Yandex returned non-JSON')
	}

	const txt = json?.result?.alternatives?.[0]?.message?.text
	if (!txt) throw new Error('Yandex LLM: empty response')
	return txt
}

// ---- OpenAI chat wrapper (fallback/compat) ----
type OAIMsg = { role: 'system' | 'user' | 'assistant'; content: string }
async function openaiChat(
	messages: OAIMsg[],
	opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
	if (!OPENAI_API_KEY)
		throw new Error('OPENAI_API_KEY is empty (LLM_PROVIDER=openai)')
	const body = {
		model: OPENAI_MODEL,
		messages,
		temperature: typeof opts?.temperature === 'number' ? opts.temperature : 0.3,
		max_tokens: typeof opts?.maxTokens === 'number' ? opts.maxTokens : 1024,
	}

	const res = await fetchWithTimeout(
		'https://api.openai.com/v1/chat/completions',
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			timeoutMs: 30000,
		}
	)

	const raw = await res.text()
	if (!res.ok) {
		let hint = ''
		try {
			hint = JSON.parse(raw)?.error?.message || ''
		} catch {}
		throw new Error(`OpenAI HTTP ${res.status}: ${hint || raw.slice(0, 400)}`)
	}

	let json: any
	try {
		json = JSON.parse(raw)
	} catch {}
	const content = json?.choices?.[0]?.message?.content
	if (!content) throw new Error('OpenAI: empty response')
	return content
}

// ---- Provider router ----
async function chatText(
	sys: string,
	user: string,
	opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
	if (LLM_PROVIDER === 'yandex') {
		const msgs: YaMsg[] = [
			{ role: 'system', text: sys },
			{ role: 'user', text: user },
		]
		return yandexChat(msgs, {
			temperature: opts?.temperature,
			maxTokens: opts?.maxTokens,
		})
	} else {
		const msgs: OAIMsg[] = [
			{ role: 'system', content: sys },
			{ role: 'user', content: user },
		]
		return openaiChat(msgs, {
			temperature: opts?.temperature,
			maxTokens: opts?.maxTokens,
		})
	}
}

// Вспомогалка: аккуратно достать JSON из текста (если модель вдруг добавит что-то лишнее)
function extractJsonObject(text: string): any {
	try {
		return JSON.parse(text)
	} catch {}
	const start = text.indexOf('{')
	const end = text.lastIndexOf('}')
	if (start >= 0 && end > start) {
		const maybe = text.slice(start, end + 1)
		try {
			return JSON.parse(maybe)
		} catch {}
	}
	throw new Error('Model did not return valid JSON')
}

// ---- Промпты ----
function buildSystemPrompt(payload: any) {
	return (
		SYSTEM_PROMPT_RU +
		`

ЖЁСТКИЕ ТРЕБОВАНИЯ К ВЫХОДУ (ОЧЕНЬ ВАЖНО):
- Верни ТОЛЬКО JSON-объект строго по схеме:
{
  "short_title": string (<=60),
  "symbols_detected": string[] (<=12),
  "barnum_insight": string (<=300),
  "esoteric_interpretation": string (<=700),
  "reflective_question": string (<=200),
  "gentle_advice": string[] (<=5),
  "risk_flags": string[] (опционально),
  "paywall_teaser": string (<=140, опционально)
}
- Никакого текста ДО или ПОСЛЕ JSON.
- Укладывайся в maxLength/maxItems. Тон: "poetic".`
	)
}

function buildFollowupSystemPrompt(payload: any) {
	return (
		SYSTEM_PROMPT_RU +
		`

ЖЁСТКИЕ ТРЕБОВАНИЯ К ВЫХОДУ:
- Ответь кратко (2–5 предложений), по-русски.
- Тон: "poetic".
- Верни ТОЛЬКО чистый текст ответа (без JSON).`
	)
}

// ================== Экспорт API ==================

export async function interpretDream(payload: {
	profile: any
	dream_text: string
	user_symbols?: string[]
	history_summary?: string
	week_context?: string
}): Promise<Interpretation> {
	const system = buildSystemPrompt(payload)
	const user = JSON.stringify(payload)

	const maxAttempts = 3
	let lastErr: any = null

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const txt = await chatText(system, user, {
				temperature: 0.35,
				maxTokens: 900,
			})
			const parsed = extractJsonObject(txt)
			const sanitized = sanitizeLlmJson(parsed)
			const safe = InterpretationSchema.safeParse(sanitized)
			if (!safe.success) {
				throw new Error('LLM JSON does not match schema: ' + safe.error.message)
			}
			return safe.data
		} catch (e: any) {
			lastErr = e
			const retryable = /timeout|aborted|fetch failed|429|5\d\d/i.test(
				String(e?.message || e)
			)
			if (retryable && attempt < maxAttempts) {
				await delay(400 * attempt)
				continue
			}
			break
		}
	}
	throw lastErr || new Error('interpretDream failed')
}

export async function followupAnswer(payload: {
	profile: any
	dream_text: string
	user_question: string
}): Promise<string> {
	const system = buildFollowupSystemPrompt(payload)
	const user = `Сон:\n${payload.dream_text}\n\nВопрос:\n${payload.user_question}`

	const maxAttempts = 3
	let lastErr: any = null

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const txt = await chatText(system, user, {
				temperature: 0.3,
				maxTokens: 300,
			})
			return txt.trim()
		} catch (e: any) {
			lastErr = e
			const retryable = /timeout|aborted|fetch failed|429|5\d\d/i.test(
				String(e?.message || e)
			)
			if (retryable && attempt < maxAttempts) {
				await delay(400 * attempt)
				continue
			}
			break
		}
	}
	throw lastErr || new Error('followupAnswer failed')
}

export async function generatePractice(payload: {
	entry_text: string
	interpretation: string
}): Promise<string> {
	const system =
		`Ты — AI-интерпретатор снов для телеграм-бота “AI-Сонник”. ` +
		`Сгенерируй короткую духовную практику: название + 3–5 очень коротких шагов, ` +
		`и 1 строка смысла/эффекта. Стиль — поэтично-мистический, бережный.`
	const user =
		`Текст сна:\n${payload.entry_text}\n\nРазбор сна:\n${payload.interpretation}\n\n` +
		`Сделай практику как списком шагов и одной завершающей строкой.`

	const maxAttempts = 3
	let lastErr: any = null

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const txt = await chatText(system, user, {
				temperature: 0.6,
				maxTokens: 220,
			})
			return txt.trim()
		} catch (e: any) {
			lastErr = e
			const retryable = /timeout|aborted|fetch failed|429|5\d\d/i.test(
				String(e?.message || e)
			)
			if (retryable && attempt < maxAttempts) {
				await delay(400 * attempt)
				continue
			}
			break
		}
	}
	throw lastErr || new Error('generatePractice failed')
}

export async function generateReportSummary(input: {
	periodDays: 7 | 30 | 90
	countDreams: number
	countInterps: number
	streakMax: number
	topSymbols: Array<{ symbol: string; count: number }>
	plan: 'free' | 'paid'
	profile?: {
		stressLevel?: number | null
		sleepGoal?: string | null
		chronotype?: string | null
	}
}): Promise<string> {
	const isPaid = input.plan !== 'free'
	const desiredLength = isPaid ? 7 : 4

	const topSymStr =
		input.topSymbols.length > 0
			? `Топ символов: ${input.topSymbols
					.map(s => `${s.symbol} (${s.count})`)
					.join(', ')}.`
			: ''

	const userPrompt = [
		`Сгенерируй тёплый обзор снов за ${input.periodDays} дней.`,
		`Снов: ${input.countDreams}. ИИ-разборов: ${input.countInterps}. Максимальный стрик: ${input.streakMax}.`,
		topSymStr,
		input.profile?.stressLevel != null
			? `Уровень стресса: ${input.profile.stressLevel}.`
			: '',
		input.profile?.sleepGoal ? `Цель сна: ${input.profile.sleepGoal}.` : '',
		input.profile?.chronotype ? `Хронотип: ${input.profile.chronotype}.` : '',
		`Длина — ${desiredLength} предложений. Поэтично-мистический стиль, дружеский тон. Уместные эмодзи.`,
		`Заверши одной мягкой рекомендацией/практикой.`,
	]
		.filter(Boolean)
		.join('\n')

	const maxAttempts = 3
	let lastErr: any = null

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const txt = await chatText(SYSTEM_PROMPT_RU, userPrompt, {
				temperature: 0.6,
				maxTokens: 320,
			})
			return txt.trim()
		} catch (e: any) {
			lastErr = e
			const retryable = /timeout|aborted|fetch failed|429|5\d\d/i.test(
				String(e?.message || e)
			)
			if (retryable && attempt < maxAttempts) {
				await delay(400 * attempt)
				continue
			}
			break
		}
	}

	// fallback, если LLM недоступен
	if (input.topSymbols.length >= 2) {
		return `Период под знаком ${input.topSymbols[0].symbol} и ${input.topSymbols[1].symbol} — про движение внутренних сюжетов и мягкое переосмысление ✨`
	} else if (input.topSymbols.length === 1) {
		return `Период под знаком ${input.topSymbols[0].symbol} — этот образ сейчас важен и просит внимания ✨`
	} else {
		return `Период спокойный, без повторяющихся образов 🙂`
	}
}
