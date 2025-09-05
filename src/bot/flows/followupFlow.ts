import type { Bot } from 'grammy'
import type { MyContext } from '../helpers/state.js'
import { getOrCreateUser, getLastDream } from '../../db/repo.js'
import { logger } from '../../util/logger.js'
import { followupAnswer } from '../../core/llm.js'
import { InlineKeyboard } from 'grammy'

/** Проверка таймзоны и нудж, если не задана */
async function checkTimezoneAndNudge(ctx: MyContext): Promise<boolean> {
	const userId = ctx.from!.id.toString()
	const user = await getOrCreateUser(userId)

	if (!user.timezone) {
		const kb = new InlineKeyboard().text(
			'⏰ Изменить таймзону',
			'profile:timezone:menu'
		)
		await ctx.reply(
			'⏰ Укажите вашу таймзону в профиле для корректных дат и напоминаний.',
			{ reply_markup: kb }
		)
		return true
	}
	return false
}

export async function answerFollowup(bot: Bot<MyContext>, ctx: MyContext, entryId: string, question: string) {
  const userId = ctx.from?.id.toString();
  if (!userId) return;
  if (await checkTimezoneAndNudge(ctx)) return

  try {
    const user = await getOrCreateUser(userId);
    const dream = await getLastDream(user.id);
    if (!dream || dream.id !== entryId) {
      return ctx.reply("Сон для уточнения не найден.");
    }

    let llmJson: any = null;
    if (dream.llmJsonText) {
      try {
        llmJson = JSON.parse(dream.llmJsonText);
      } catch (e) {
        logger.error({ e }, "Failed to parse llmJsonText for followup");
      }
    }

    const answer = await followupAnswer({
      profile: {
        timezone: user.timezone ?? "UTC",
        ageBand: (user.ageBand ?? undefined) as any,
        chronotype: (user.chronotype ?? undefined) as any,
        tone: "poetic", // Fixed to poetic as per new requirements
        esotericaLevel: user.esotericaLevel ?? 50,
        sleepGoal: (user.sleepGoal ?? undefined) as any,
        wakeTime: user.wakeTime ?? undefined,
        sleepTime: user.sleepTime ?? undefined,
        stressLevel: user.stressLevel ?? undefined,
        dreamFrequency: (user.dreamFrequency ?? undefined) as any,
      },
      dream_text: dream.text,
      user_question: question,
      // tone: tone // Removed, now fixed to poetic
    });

    ctx.session.followupsUsed = (ctx.session.followupsUsed ?? 0) + 1;
    const kb = new InlineKeyboard()
        .text('✨ Духовная практика', `practice:followup:${entryId}`)
        .row()
        .text('📔 Открыть дневник', 'analytics:tab:journal'); // новая точка входа
    await ctx.reply(answer, { reply_markup: kb });

  } catch (e: any) {
    logger.error(e, "followup failed");
    await ctx.reply("Не удалось ответить на вопрос. Попробуйте ещё раз чуть позже.");
  }
}

export function registerFollowupFlow(bot: Bot<MyContext>) {
  // No specific handlers here, all handled in message router in index.ts
}
