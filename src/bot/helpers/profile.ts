import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../helpers/state.js'

/**
 * Профиль считаем «заполненным», если указаны:
 * 1) тайм-зона (IANA), 2) время подъёма (HH:MM), 3) время отхода ко сну (HH:MM).
 * Остальные поля желательны, но не блокируют.
 */
export function isProfileComplete(u: {
	timezone?: string | null
	ageBand?: string | null
	chronotype?: string | null
	wakeTime?: string | null
	sleepTime?: string | null
	stressLevel?: number | null
}): boolean {
	const tzOk = !!u.timezone && u.timezone.trim().length > 0
	const wakeOk = !!u.wakeTime && u.wakeTime.trim().length > 0
	const sleepOk = !!u.sleepTime && u.sleepTime.trim().length > 0
	return tzOk && wakeOk && sleepOk
}

/** Сообщение после успешного заполнения профиля + CTA продолжить сценарий */
export async function sendProfileReadyCta(ctx: MyContext) {
	const kb = new InlineKeyboard()
	if (ctx.session.onboarding?.pendingEntryId) {
		// ВАЖНО: правильный паттерн колбэка — interpret:<entryId>
		kb.text(
			'🔮 Разобрать сейчас',
			`interpret:${ctx.session.onboarding!.pendingEntryId}`
		)
	} else {
		kb.text('✍ Записать сон', 'sleep:start')
	}
	await ctx.reply(
		'✨ Профиль заполнен — спасибо! Теперь разборы будут точнее.',
		{ reply_markup: kb }
	)
}

/** Валидация IANA тайм-зоны */
export function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
		return true
	} catch {
		return false
	}
}

/** Подсчёт максимального стрика (подряд дней с записями) */
export function calculateDreamStreak(dreams: Array<any>): number {
	if (!dreams.length) return 0
	const sorted = [...dreams].sort(
		(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
	)

	let maxStreak = 0
	let current = 0
	let last: Date | null = null

	for (const d of sorted) {
		const day = new Date(d.createdAt)
		day.setHours(0, 0, 0, 0)

		if (!last) {
			current = 1
		} else {
			const diff = Math.round(
				(day.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
			)
			if (diff === 1) current += 1
			else if (diff > 1) current = 1
		}
		maxStreak = Math.max(maxStreak, current)
		last = day
	}
	return maxStreak
}
