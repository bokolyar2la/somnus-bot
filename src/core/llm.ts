import {
	InterpretationSchema,
	type Interpretation,
} from '../types/interpretation.js'
import { OPENAI_API_KEY } from '../util/config.js'
import { SYSTEM_PROMPT_RU } from './prompts.js'

function clampStr(s: unknown, max = 700): string | null {
	if (typeof s !== 'string') return null
	return s.length > max ? s.slice(0, max) : s
}

function sanitizeLlmJson(obj: any) {
	if (!obj || typeof obj !== 'object') return obj
	obj.esoteric_interpretation = clampStr(obj.esoteric_interpretation, 700) ?? ''
	obj.barnum_insight = clampStr(obj.barnum_insight, 700) ?? obj.barnum_insight
	obj.reflective_question = clampStr(obj.reflective_question, 300) ?? obj.reflective_question
	// при необходимости — по другим строковым полям
	return obj
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
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

// JSON Schema под инструмент (function-calling в Chat Completions)
const toolSchema = {
	type: 'object',
	additionalProperties: false,
	required: [
		'short_title',
		'symbols_detected',
		'barnum_insight',
		'esoteric_interpretation',
		'reflective_question',
		'gentle_advice',
	],
	properties: {
		short_title: { type: 'string', maxLength: 60 },
		symbols_detected: {
			type: 'array',
			items: { type: 'string' },
			maxItems: 12,
			default: [],
		},
		barnum_insight: { type: 'string', maxLength: 300 },
		esoteric_interpretation: { type: 'string', maxLength: 700 },
		reflective_question: { type: 'string', maxLength: 200 },
		gentle_advice: {
			type: 'array',
			items: { type: 'string' },
			maxItems: 5,
			default: [],
		},
		risk_flags: {
			type: 'array',
			items: { type: 'string' },
		},
		paywall_teaser: { type: 'string', maxLength: 140 },
	},
}

function buildSystemPrompt(payload: any) {
	// const allowed = ['neutral', 'poetic', 'mystic', 'calm-science'] as const
	// const pTone = payload?.profile?.tone
	// const desiredTone = (allowed as readonly string[]).includes(pTone)
	// 	? pTone
	// 	: 'neutral'

	return (
		SYSTEM_PROMPT_RU +
		`

ЖЁСТКИЕ ТРЕБОВАНИЯ К ВЫХОДУ:
- Верни ТОЛЬКО вызов инструмента return_interpretation с корректными аргументами.
- Поле "tone" выставь в "poetic".
- Если нет советов — gentle_advice: [].
- Укладывайся в maxLength/maxItems.`
	)
}

function buildFollowupSystemPrompt(payload: any) {
	// const allowed = ['neutral', 'poetic', 'mystic', 'calm-science'] as const;
	// const pTone = payload?.tone;
	// const desiredTone = (allowed as readonly string[]).includes(pTone)
	//   ? pTone
	//   : 'neutral';

	return (
		SYSTEM_PROMPT_RU +
		`

ЖЁСТКИЕ ТРЕБОВАНИЯ К ВЫХОДУ:
- Ответь кратко (2-5 предложений).
- Используй настроение: "poetic".
- Верни ТОЛЬКО текст ответа, без JSON и вызова инструментов.`
	)
}

export async function interpretDream(payload: {
	profile: any
	dream_text: string
	user_symbols?: string[]
	history_summary?: string
	week_context?: string
}): Promise<Interpretation> {
	if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is empty')

	const url = 'https://api.openai.com/v1/chat/completions'
	const maxAttempts = 3
	let lastErr: any = null

	// Инструмент под схему
	const tools = [
		{
			type: 'function',
			function: {
				name: 'return_interpretation',
				description:
					'Верни структурированную интерпретацию сна по заданной схеме. Не добавляй пояснения вне аргументов.',
				parameters: toolSchema,
			},
		},
	]

	// Сообщения
	const system = buildSystemPrompt(payload)
	const messages = [
		{ role: 'system', content: system },
		{ role: 'user', content: JSON.stringify(payload) },
	]

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const body: any = {
				model: MODEL,
				messages,
				tools,
				tool_choice: {
					type: 'function',
					function: { name: 'return_interpretation' },
				},
				temperature: 0.4,
				// НЕЛЬЗЯ "сломать" JSON вокруг, т.к. ответ приходит в tool_calls.arguments
				max_tokens: 900,
			}

			const res = await fetchWithTimeout(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${OPENAI_API_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				timeoutMs: 30000,
			})

			const raw = await res.text()

			if (!res.ok) {
				let apiErr: any = null
				try {
					apiErr = JSON.parse(raw)
				} catch {}
				const hint =
					apiErr?.error?.message || (raw ? String(raw).slice(0, 400) : '')
				const httpMsg = `OpenAI HTTP ${res.status}: ${hint}`
				if (
					[429, 500, 502, 503, 504].includes(res.status) &&
					attempt < maxAttempts
				) {
					await delay(400 * attempt)
					continue
				}
				throw new Error(httpMsg)
			}

			// OK → парсим Chat Completions
			let json: any
			try {
				json = JSON.parse(raw)
			} catch {
				throw new Error('OpenAI returned non-JSON body from /chat/completions')
			}

			const choice = json?.choices?.[0]
			const toolCall = choice?.message?.tool_calls?.[0]
			const argsStr = toolCall?.function?.arguments

			if (!argsStr) {
				// редкий случай — модель не сделала tool_call (хотя мы требовали)
				// попробуем fallback: возможно, вернули текстом
				const content = choice?.message?.content ?? ''
				try {
					const fallbackParsed = JSON.parse(content)
					const safe2 = InterpretationSchema.safeParse(fallbackParsed)
					if (!safe2.success) {
						throw new Error(
							'LLM JSON does not match schema (fallback): ' +
								safe2.error.message
						)
					}
					return safe2.data
				} catch {
					throw new Error(
						'Model did not return tool_call arguments nor valid JSON content'
					)
				}
			}

			let parsed: any
			try {
				parsed = JSON.parse(argsStr)
			} catch {
				throw new Error('Tool call arguments are not valid JSON')
			}

			const sanitized = sanitizeLlmJson(parsed)
			const safe = InterpretationSchema.safeParse(sanitized)
			if (!safe.success) {
				// при отладке можно включить подробности:
				// console.error("Schema mismatch:", safe.error.format());
				throw new Error(
					'LLM JSON does not match schema (post-validate): ' +
						safe.error.message
				)
			}

			return safe.data
		} catch (e: any) {
			lastErr = e
			const msg = String(e?.message || e)
			const retryable = /timeout|aborted|fetch failed|429|5\d\d/i.test(msg)
			if (retryable && attempt < maxAttempts) {
				await delay(400 * attempt)
				continue
			}
			break
		}
	}

	if (lastErr) throw lastErr
	throw new Error('interpretDream failed: unknown error')
}

export async function followupAnswer(payload: {
	profile: any
	dream_text: string
	user_question: string
}): Promise<string> {
	if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is empty')

	const url = 'https://api.openai.com/v1/chat/completions'
	const maxAttempts = 3
	let lastErr: any = null

	const system = buildFollowupSystemPrompt(payload)
	const messages = [
		{ role: 'system', content: system },
		{
			role: 'user',
			content: `Сон: ${payload.dream_text}\nВопрос: ${payload.user_question}`,
		},
	]

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const body: any = {
				model: MODEL,
				messages,
				temperature: 0.5, // 0.4-0.6 range
				max_tokens: 250, // ~ 2-5 sentences
			}

			const res = await fetchWithTimeout(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${OPENAI_API_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				timeoutMs: 30000,
			})

			const raw = await res.text()

			if (!res.ok) {
				let apiErr: any = null
				try {
					apiErr = JSON.parse(raw)
				} catch {}
				const hint =
					apiErr?.error?.message || (raw ? String(raw).slice(0, 400) : '')
				const httpMsg = `OpenAI HTTP ${res.status}: ${hint}`
				if (
					[429, 500, 502, 503, 504].includes(res.status) &&
					attempt < maxAttempts
				) {
					await delay(400 * attempt)
					continue
				}
				throw new Error(httpMsg)
			}

			let json: any
			try {
				json = JSON.parse(raw)
			} catch {
				// not necessarily an error, as we expect plain text
			}

			const content = json?.choices?.[0]?.message?.content
			if (content) {
				return content
			} else {
				throw new Error('OpenAI did not return content for followup')
			}
		} catch (e: any) {
			lastErr = e
			const msg = String(e?.message || e)
			const retryable = /timeout|aborted|fetch failed|429|5\d\d/i.test(msg)
			if (retryable && attempt < maxAttempts) {
				await delay(400 * attempt)
				continue
			}
			break
		}
	}

	if (lastErr) throw lastErr
	throw new Error('followupAnswer failed: unknown error')
}

export async function generatePractice(payload: {
	entry_text: string
	interpretation: string
}): Promise<string> {
	if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is empty')

	const url = 'https://api.openai.com/v1/chat/completions'
	const maxAttempts = 3
	let lastErr: any = null

	const system = `Ты — AI-интерпретатор снов для телеграм-бота “AI-Сонник”. Твоя задача — сгенерировать короткую духовную практику (2–6 строк инструкции, 1 строка смысла/эффекта), базирующуюся на предоставленном контексте сна и его разбора. Используй поэтично-мистический стиль с лёгкой психологией.`
	const messages = [
		{ role: 'system', content: system },
		{
			role: 'user',
			content: `Текст сна: ${payload.entry_text}\nРазбор сна: ${payload.interpretation}\n\nСгенерируй духовную практику.`,
		},
	]

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const body: any = {
				model: MODEL,
				messages,
				temperature: 0.7, // Higher temperature for more creative output
				max_tokens: 200, // Limit practice length
			}

			const res = await fetchWithTimeout(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${OPENAI_API_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				timeoutMs: 30000,
			})

			const raw = await res.text()

			if (!res.ok) {
				let apiErr: any = null
				try {
					apiErr = JSON.parse(raw)
				} catch {}
				const hint =
					apiErr?.error?.message || (raw ? String(raw).slice(0, 400) : '')
				const httpMsg = `OpenAI HTTP ${res.status}: ${hint}`
				if (
					[429, 500, 502, 503, 504].includes(res.status) &&
					attempt < maxAttempts
				) {
					await delay(400 * attempt)
					continue
				}
				throw new Error(httpMsg)
			}

			let json: any
			try {
				json = JSON.parse(raw)
			} catch {
				// not necessarily an error, as we expect plain text
			}

			const content = json?.choices?.[0]?.message?.content
			if (content) {
				return content
			} else {
				throw new Error('OpenAI did not return content for practice generation')
			}
		} catch (e: any) {
			lastErr = e
			const msg = String(e?.message || e)
			const retryable = /timeout|aborted|fetch failed|429|5\d\d/i.test(msg)
			if (retryable && attempt < maxAttempts) {
				await delay(400 * attempt)
				continue
			}
			break
		}
	}

	if (lastErr) throw lastErr
	throw new Error('generatePractice failed: unknown error')
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
	if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is empty')

	const url = 'https://api.openai.com/v1/chat/completions'
	const maxAttempts = 3
	let lastErr: any = null

	// длина текста — короче для free, длиннее для paid
	const isPaid = input.plan !== 'free'
	const desiredLength = isPaid ? 7 : 4 // предложений

	const topSymStr =
		input.topSymbols.length > 0
			? `Топ символов: ${input.topSymbols
					.map(s => `${s.symbol} (${s.count} раз)`)
					.join(', ')}.`
			: ''

	const userPrompt = [
		`Сгенерируй мистический и тёплый обзор снов пользователя за ${input.periodDays} дней.`,
		`Количество снов: ${input.countDreams}.`,
		`Количество разборов ИИ: ${input.countInterps}.`,
		`Максимальный стрик: ${input.streakMax} дней.`,
		topSymStr,
		input.profile?.stressLevel != null
			? `Уровень стресса (профиль): ${input.profile.stressLevel}.`
			: '',
		input.profile?.sleepGoal
			? `Цель сна (профиль): ${input.profile.sleepGoal}.`
			: '',
		input.profile?.chronotype
			? `Хронотип (профиль): ${input.profile.chronotype}.`
			: '',
		`Суммируй всё в ${desiredLength} предложениях.`,
		`Стиль: поэтично-мистический с лёгкой психологией, дружеский, человечный.`,
		`Обязательно используй уместные эмодзи.`,
		`Заверши одной мягкой рекомендацией/практикой, продолжая доминирующий образ.`,
	]
		.filter(Boolean)
		.join('\n')

	const messages = [
		{ role: 'system', content: SYSTEM_PROMPT_RU },
		{ role: 'user', content: userPrompt },
	]

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const body: any = {
				model: MODEL,
				messages,
				temperature: 0.7,
				max_tokens: 300,
			}

			const res = await fetchWithTimeout(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${OPENAI_API_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				timeoutMs: 30000,
			})

			const raw = await res.text()

			if (!res.ok) {
				let apiErr: any = null
				try {
					apiErr = JSON.parse(raw)
				} catch {}
				const hint =
					apiErr?.error?.message || (raw ? String(raw).slice(0, 400) : '')
				const httpMsg = `OpenAI HTTP ${res.status}: ${hint}`
				if (
					[429, 500, 502, 503, 504].includes(res.status) &&
					attempt < maxAttempts
				) {
					await delay(400 * attempt)
					continue
				}
				throw new Error(httpMsg)
			}

			let json: any
			try {
				json = JSON.parse(raw)
			} catch {
				// норм: ждём обычный текст, но API возвращает JSON-обёртку
			}

			const content = json?.choices?.[0]?.message?.content
			if (content) {
				return content
			} else {
				throw new Error('OpenAI did not return content for report summary')
			}
		} catch (e: any) {
			lastErr = e
			const msg = String(e?.message || e)
			const retryable = /timeout|aborted|fetch failed|429|5\d\d/i.test(msg)
			if (retryable && attempt < maxAttempts) {
				await delay(400 * attempt)
				continue
			}
			break
		}
	}

	if (lastErr) throw lastErr

	// Фолбэк (если LLM недоступен): короткая «нить периода»
	if (input.topSymbols.length >= 2) {
		return `Период под знаком ${input.topSymbols[0].symbol} и ${input.topSymbols[1].symbol} — про движение ваших внутренних сюжетов и мягкое переосмысление ✨`
	} else if (input.topSymbols.length === 1) {
		return `Период под знаком ${input.topSymbols[0].symbol} — про то, что этот образ сейчас важен и просит внимания ✨`
	} else {
		return `Период спокойный, без ярко повторяющихся образов 🙂`
	}
}
