import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { followupAnswer } from '../../core/llm.js'
import { getLastDream, getOrCreateUser } from '../../db/repo.js'
import { logger } from '../../util/logger.js'
import type { MyContext } from '../helpers/state.js'

export async function answerFollowup(
	bot: Bot<MyContext>,
	ctx: MyContext,
	entryId: string,
	question: string
) {
	const userId = ctx.from?.id.toString()
	if (!userId) return

	try {
		const user = await getOrCreateUser(userId)
		const dream = await getLastDream(user.id)
		if (!dream || dream.id !== entryId) {
			return ctx.reply('Сон для уточнения не найден.')
		}

		let llmJson: any = null
		if (dream.llmJsonText) {
			try {
				llmJson = JSON.parse(dream.llmJsonText)
			} catch (e) {
				logger.error({ e }, 'Failed to parse llmJsonText for followup')
			}
		}

		const answer = await followupAnswer({
			profile: {
				timezone: user.timezone ?? 'UTC',
				ageBand: (user.ageBand ?? undefined) as any,
				chronotype: (user.chronotype ?? undefined) as any,
				tone: 'poetic',
				esotericaLevel: user.esotericaLevel ?? 50,
				sleepGoal: (user.sleepGoal ?? undefined) as any,
				wakeTime: user.wakeTime ?? undefined,
				sleepTime: user.sleepTime ?? undefined,
				stressLevel: user.stressLevel ?? undefined,
				dreamFrequency: (user.dreamFrequency ?? undefined) as any,
			},
			dream_text: dream.text,
			user_question: question,
		})

		ctx.session.followupsUsed = (ctx.session.followupsUsed ?? 0) + 1

		const kb = new InlineKeyboard()
			.text('✨ Духовная практика', `practice:followup:${entryId}`)
			.row()
			.text('📔 Открыть дневник', 'analytics:tab:journal')

		await ctx.reply(answer, { reply_markup: kb })
	} catch (e: any) {
		logger.error(e, 'followup failed')
		await ctx.reply(
			'Не удалось ответить на вопрос. Попробуйте ещё раз чуть позже.'
		)
	}
}

export function registerFollowupFlow(_bot: Bot<MyContext>) {
	// Роутинг в index.ts
}
