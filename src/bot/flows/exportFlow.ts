import type { Bot } from 'grammy'
import { InlineKeyboard, InputFile } from 'grammy'
import { getDreamsForExport, getOrCreateUser } from '../../db/repo.js'
import { logger } from '../../util/logger.js'
import type { MyContext } from '../helpers/state.js'

const lastExportTime = new Map<number, number>()
const EXPORT_COOLDOWN_SECONDS = 30

// --- Хелперы для обработки LLM-JSON и форматирования --- 

/** Форматирование даты с учётом таймзоны пользователя */
function formatDate(d: Date, tz: string) {
  return new Date(d.toLocaleString('en-US', { timeZone: tz }))
    .toLocaleString('ru-RU', { 
      timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
}

/** Парсинг и нормализация llmJsonText */
function parseLlm(entry: any) {
  const out = { insight: '', question: '', advice: '', symbolsDetected: [] as string[] };
  const raw = entry.llmJsonText;
  if (!raw) return out;
  try {
    const j = JSON.parse(raw);
    const get = (...keys: string[]) => keys.map(k => j?.[k]).find(v => v != null);
    const sym = get('symbols_detected', 'symbols');
    const toArr = (v: any) =>
      Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[;,]/) : []);
    out.symbolsDetected = toArr(sym).map(s => String(s).trim()).filter(Boolean);
    out.insight   = String(get('barnum_insight', 'insight') ?? '').trim();
    out.question  = String(get('reflective_question', 'question') ?? '').trim();
    out.advice    = String(get('gentle_advice', 'practice', 'soft_steps') ?? '').trim();
  } catch {}
  return out;
}

/** Слияние символов из symbolsRaw и llmJsonText */
function mergeSymbols(symbolsRaw?: string | null, detected?: string[]): string[] {
  const a = (symbolsRaw ?? '')
    .split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const b = (detected ?? []).map(s => s.trim()).filter(Boolean);
  const set = new Set([...a, ...b].map(s => s.toLowerCase()));
  return Array.from(set);
}

/** Унифицированный DTO для рендера экспорта */
type ExportItem = {
  index: number;                 // № записи по убыванию даты
  dateHuman: string;             // дата с учётом timezone
  title: string;                 // short_title или "Запись N"
  text: string;
  symbols: string[];             // объединённые
  insight?: string;
  question?: string;
  advice?: string;
};

const SHOW_EMPTY_LLM_BLOCKS = false; // Показ блоков инсайта/вопроса/практики, если они пустые

// Экранируем Markdown-символы для md-to-pdf
function mdEscape(s: string) {
  return s.replace(/([_*#`~>\[\]\(\)!])/g, '\\$1')
}

/** Форматирование для Markdown */
function buildMarkdown(username: string | undefined, items: ExportItem[]): string {
  const header =
    `# Дневник снов${username ? ` — @${username}` : ''}\n\n` +
    `Генерация: ${formatDate(new Date(), 'UTC')}\n\n---\n\n`; // Используем UTC для даты генерации

  const body = items
    .map(item => {
      const parts = [
        `### Запись ${item.index}: ${item.title}`,
        `**Когда:** ${item.dateHuman}`,
        item.symbols.length ? `**Символы:** ${item.symbols.join(', ')}` : '',
        `**Текст сна:**\n${mdEscape(item.text)}`,
      ];

      if (SHOW_EMPTY_LLM_BLOCKS || item.insight) {
        parts.push(`**Инсайт:** ${item.insight || '—'}`);
      }
      if (SHOW_EMPTY_LLM_BLOCKS || item.question) {
        parts.push(`**Вопрос для размышления:** ${item.question || '—'}`);
      }
      if (SHOW_EMPTY_LLM_BLOCKS || item.advice) {
        parts.push(`**Практика:**\n${item.advice || '—'}`);
      }

      parts.push('\n---\n');
      return parts.filter(Boolean).join('\n');
    })
    .join('\n');

  return header + body;
}

/** Форматирование для TXT */
function buildTxt(items: ExportItem[]): string {
  const header =
    `Дневник снов — экспорт от ${formatDate(new Date(), 'UTC')}\n` + // Используем UTC для даты генерации
    `=============================================\n\n`;

  const body = items
    .map(item => {
      const parts = [
        `Запись ${item.index}: ${item.title}`,
        `Когда: ${item.dateHuman}`,
        item.symbols.length ? `Символы: ${item.symbols.join(', ')}` : '',
        '',
        `Текст сна:\n${item.text}`,
      ];

      if (SHOW_EMPTY_LLM_BLOCKS || item.insight) {
        parts.push(`Инсайт: ${item.insight || '—'}`);
      }
      if (SHOW_EMPTY_LLM_BLOCKS || item.question) {
        parts.push(`Вопрос: ${item.question || '—'}`);
      }
      if (SHOW_EMPTY_LLM_BLOCKS || item.advice) {
        parts.push(`Практика:\n${item.advice || '—'}`);
      }

      parts.push('\n---------------------------------------------\n');
      return parts.filter(Boolean).join('\n');
    })
    .join('\n');

  return header + body;
}

function exportPeriodKb() {
	return new InlineKeyboard()
		.text('7 дней', 'export:period:7')
		.text('30 дней', 'export:period:30')
		.text('90 дней', 'export:period:90')
		.row()
		.text('Всё время', 'export:period:all')
}

function exportFormatKb() {
	return new InlineKeyboard()
		.text('📄 PDF', 'export:format:pdf')
		.text('📝 Markdown', 'export:format:md')
		.text('📃 TXT', 'export:format:txt')
}

export function registerExportFlow(bot: Bot<MyContext>) {
	// Шаг 1: выбрать период
	bot.command('export', async ctx => {
		const userId = ctx.from!.id
		const nowTs = Date.now()
		const last = lastExportTime.get(userId)

		if (last && nowTs - last < EXPORT_COOLDOWN_SECONDS * 1000) {
			const remaining = Math.ceil(
				(last + EXPORT_COOLDOWN_SECONDS * 1000 - nowTs) / 1000
			)
			await ctx.reply(
				`Подождите немного перед следующим экспортом. ${remaining} сек.`
			)
			return
		}

		await ctx.reply('За какой период экспортировать?', {
			reply_markup: exportPeriodKb(),
		})
	})

	// Сохранить период и показать форматы
	bot.callbackQuery(/^export:period:(7|30|90|all)$/, async ctx => {
		await ctx.answerCallbackQuery()
		const period = ctx.match![1]
		ctx.session.exportPeriod = period as any
		await ctx.editMessageText('Выберите формат экспорта:', {
			reply_markup: exportFormatKb(),
		})
	})

	// Собрать и отправить файл
	bot.callbackQuery(/^export:format:(pdf|md|txt)$/, async ctx => {
		await ctx.answerCallbackQuery()
		const nowTs = Date.now()

		try {
			const userId = ctx.from!.id.toString()
			const user = await getOrCreateUser(userId)
			const chosenFormat = ctx.match![1]
			const period = ctx.session.exportPeriod || 'all'

			let fromDate: Date | undefined
			const toDate: Date | undefined = new Date()

			if (period !== 'all') {
				const days = parseInt(String(period), 10)
				fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
			}

			const dreams = await getDreamsForExport(user.id, fromDate, toDate);

			if (!dreams.length) {
				await ctx.editMessageText('У вас пока нет записей для экспорта.');
				return;
			}

			const exportItems: ExportItem[] = dreams.map((d, idx) => {
				const llm = parseLlm(d);
				const symbols = mergeSymbols(d.symbolsRaw, llm.symbolsDetected);
				return {
					index: dreams.length - idx,
					dateHuman: formatDate(d.sleptAt ?? d.createdAt, user.timezone ?? 'UTC'),
					title: llm.insight || d.llmJsonText?.short_title || `Запись ${dreams.length - idx}`,
					text: d.text,
					symbols: symbols,
					insight: llm.insight,
					question: llm.question,
					advice: llm.advice,
				};
			});

			const mdContent = buildMarkdown(ctx.from?.username, exportItems);

			if (chosenFormat === 'md') {
				const buf = Buffer.from(mdContent, 'utf-8');
				await ctx.replyWithDocument(new InputFile(buf, 'dream-journal.md'), {
					caption: 'Экспорт готов. Вот ваш дневник снов.',
				});
				lastExportTime.set(ctx.from!.id, nowTs);
				return;
			}

			if (chosenFormat === 'txt') {
				const txt = buildTxt(exportItems);
				const buf = Buffer.from(txt, 'utf-8');
				await ctx.replyWithDocument(new InputFile(buf, 'dream-journal.txt'), {
					caption: 'Экспорт готов. Вот ваш дневник снов.',
				});
				lastExportTime.set(ctx.from!.id, nowTs);
				return;
			}

			// PDF
			if (chosenFormat === 'pdf') {
				try {
					const { mdToPdf } = await import('md-to-pdf')

					const pdf = await mdToPdf(
						{ content: mdContent },
						{
							launch_options: {
								args: ['--no-sandbox', '--disable-setuid-sandbox'],
								headless: true, // <-- фикс типов: boolean вместо "new"
								// Если на сервере нет встроенного Chromium — укажи путь через .env
								// Пример: CHROMIUM_PATH=/usr/bin/chromium
								executablePath: process.env.CHROMIUM_PATH || undefined,
							},
							pdf_options: {
								format: 'A4',
								margin: {
									top: '15mm',
									right: '15mm',
									bottom: '15mm',
									left: '15mm',
								},
							},
							// timeout: 60000, // раскомментируй при больших объёмах
						}
					)

					if (!pdf?.content) throw new Error('md-to-pdf returned empty content')

					await ctx.replyWithDocument(
						new InputFile(pdf.content, 'dream-journal.pdf'),
						{
							caption: 'Экспорт готов. Вот ваш дневник снов.',
						}
					)
				} catch (pdfError: any) {
					logger.warn(
						{
							message: pdfError?.message,
							stack: pdfError?.stack?.split('\n').slice(0, 3).join(' | '),
						},
						'PDF export failed, fallback to Markdown.'
					)
					await ctx.reply('Не удалось сделать PDF. Отправляю Markdown-версию.')
					const buf = Buffer.from(mdContent, 'utf-8')
					await ctx.replyWithDocument(new InputFile(buf, 'dream-journal.md'))
				}
				lastExportTime.set(ctx.from!.id, nowTs)
				return
			}
		} catch (e: any) {
			// Логируем не как { e }, а явные поля — чтобы видеть message/stack
			logger.error(
				{
					name: e?.name,
					message: e?.message,
					stack: e?.stack,
				},
				'export failed'
			)
			await ctx.reply('Не удалось выполнить экспорт. Попробуйте позже.')
		}
	})
}
