import { Bot, Context } from "grammy";
import { MyContext } from "../helpers/state.js";
import { getOrCreateUser, listDreams } from "../../db/repo.js";

export function registerListDreamsFlow<C extends Context>(bot: Bot<C>) {
  bot.command("listdreams", async (ctx) => {
    if (!ctx.from?.id) {
      return ctx.reply("Произошла ошибка, не могу определить ваш ID.");
    }
    const user = await getOrCreateUser(ctx.from.id.toString());
    const dreams = await listDreams(user.id, 20);

    if (dreams.length === 0) {
      return ctx.reply("У вас пока нет записанных снов. Используйте /sleep или /nap для добавления.");
    }

    const dreamList = dreams.map((dream, index) => {
      const date = dream.createdAt.toLocaleDateString("ru-RU");
      const time = dream.createdAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      const tags = dream.symbolsRaw ? dream.symbolsRaw.split(',').map(tag => `#${tag}`).join(' ') : "—";
      return `${index + 1}. ${date} ${time} [${tags}]: ${dream.text}`;
    }).join("\n\n");

    await ctx.reply(`Ваши последние 20 снов:\n\n${dreamList}`);
  });
}
