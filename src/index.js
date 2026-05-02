const { config, validateConfig } = require("./config");
const { buildPeriodMessage, buildRecentMessage, filterByDate, filterByMonth, filterByWeek } = require("./reports");
const { Storage } = require("./storage");
const { TelegramClient } = require("./telegram");
const { formatMoney, getLocalDateKey, getLocalMonthKey, getLocalWeekKey } = require("./time");

const storage = new Storage(config.dataFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text) {
  return String(text || "").trim();
}

function normalizeArabicDigits(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[٫،]/g, ".")
    .replace(/\u066C/g, "");
}

function buildKeyboard() {
  return {
    keyboard: [
      [{ text: "➕ إضافة مصروف" }, { text: "📅 اليوم" }],
      [{ text: "🗓 الأسبوع" }, { text: "📆 الشهر" }],
      [{ text: "🧾 آخر العمليات" }, { text: "❌ حذف عملية" }]
    ],
    resize_keyboard: true
  };
}

function buildHelpMessage() {
  return [
    "أهلًا بك في بوت المصاريف.",
    "",
    "الأوامر المتاحة:",
    "/add 25 قهوة",
    "/today",
    "/week",
    "/month",
    "/recent",
    "/delete 3",
    "",
    "يمكنك أيضًا الضغط على الأزرار أو كتابة المبلغ ثم الوصف بعد اختيار إضافة مصروف."
  ].join("\n");
}

function parseExpenseInput(text) {
  const normalized = normalizeArabicDigits(text).trim();
  const match = normalized.match(/^(\d+(?:[.,]\d{1,2})?)(?:\s+(.+))?$/);

  if (!match) {
    return null;
  }

  return {
    amount: Number(match[1].replace(",", ".")),
    note: (match[2] || "").trim()
  };
}

function createExpenseRecord(chatId, parsed) {
  const now = new Date();

  return {
    chatId,
    amount: parsed.amount,
    note: parsed.note,
    createdAt: now.toISOString(),
    localDate: getLocalDateKey(now, config.timezone),
    localWeekKey: getLocalWeekKey(now, config.timezone),
    localMonthKey: getLocalMonthKey(now, config.timezone)
  };
}

async function sendMainMenu(client, chatId, text) {
  await client.sendMessage(chatId, text, {
    reply_markup: buildKeyboard()
  });
}

async function handleAddCommand(client, chatId, textAfterCommand) {
  const parsed = parseExpenseInput(textAfterCommand);

  if (!parsed) {
    storage.setChatState(chatId, "awaiting_expense");
    await sendMainMenu(
      client,
      chatId,
      "أرسل المصروف بهذه الصيغة:\n25 قهوة\nأو\n18.5 مواصلات"
    );
    return;
  }

  const expense = storage.addExpense(createExpenseRecord(chatId, parsed));
  storage.clearChatState(chatId);

  await sendMainMenu(
    client,
    chatId,
    `تم تسجيل المصروف رقم #${expense.id}\nالقيمة: ${formatMoney(expense.amount)}${
      expense.note ? `\nالوصف: ${expense.note}` : ""
    }`
  );
}

async function handleDeleteCommand(client, chatId, textAfterCommand) {
  const expenseId = Number(normalizeArabicDigits(textAfterCommand).trim());

  if (!expenseId) {
    storage.setChatState(chatId, "awaiting_delete");
    await sendMainMenu(client, chatId, "أرسل رقم العملية التي تريد حذفها، مثل:\n3");
    return;
  }

  const removed = storage.deleteExpense(chatId, expenseId);
  storage.clearChatState(chatId);

  if (!removed) {
    await sendMainMenu(client, chatId, "لم أجد عملية بهذا الرقم.");
    return;
  }

  await sendMainMenu(
    client,
    chatId,
    `تم حذف العملية #${removed.id} بقيمة ${formatMoney(removed.amount)}`
  );
}

async function handleAwaitingState(client, chatId, text, state) {
  if (state === "awaiting_expense") {
    const parsed = parseExpenseInput(text);

    if (!parsed) {
      await sendMainMenu(client, chatId, "الصيغة غير صحيحة. أرسل مثل:\n25 غداء");
      return true;
    }

    const expense = storage.addExpense(createExpenseRecord(chatId, parsed));
    storage.clearChatState(chatId);

    await sendMainMenu(
      client,
      chatId,
      `تم تسجيل المصروف رقم #${expense.id} بقيمة ${formatMoney(expense.amount)}`
    );
    return true;
  }

  if (state === "awaiting_delete") {
    await handleDeleteCommand(client, chatId, text);
    return true;
  }

  return false;
}

async function sendTodayReport(client, chatId) {
  const expenses = storage.getExpensesByChat(chatId);
  const todayKey = getLocalDateKey(new Date(), config.timezone);
  const report = buildPeriodMessage("تقرير اليوم", filterByDate(expenses, todayKey));
  await sendMainMenu(client, chatId, report);
}

async function sendWeekReport(client, chatId) {
  const expenses = storage.getExpensesByChat(chatId);
  const weekKey = getLocalWeekKey(new Date(), config.timezone);
  const report = buildPeriodMessage("تقرير الأسبوع", filterByWeek(expenses, weekKey));
  await sendMainMenu(client, chatId, report);
}

async function sendMonthReport(client, chatId) {
  const expenses = storage.getExpensesByChat(chatId);
  const monthKey = getLocalMonthKey(new Date(), config.timezone);
  const report = buildPeriodMessage("تقرير الشهر", filterByMonth(expenses, monthKey));
  await sendMainMenu(client, chatId, report);
}

async function sendRecentReport(client, chatId) {
  const expenses = storage.getExpensesByChat(chatId);
  await sendMainMenu(client, chatId, buildRecentMessage(expenses));
}

async function handleMessage(client, message) {
  const chatId = message.chat && message.chat.id;
  const text = normalizeText(message.text);

  if (!chatId || !text) {
    return;
  }

  const state = storage.getChatState(chatId);
  if (state) {
    const handled = await handleAwaitingState(client, chatId, text, state);
    if (handled) {
      return;
    }
  }

  if (text === "/start" || text === "/help") {
    await sendMainMenu(client, chatId, buildHelpMessage());
    return;
  }

  if (text.startsWith("/add")) {
    await handleAddCommand(client, chatId, text.slice(4).trim());
    return;
  }

  if (text === "/today" || text === "📅 اليوم") {
    await sendTodayReport(client, chatId);
    return;
  }

  if (text === "/week" || text === "🗓 الأسبوع") {
    await sendWeekReport(client, chatId);
    return;
  }

  if (text === "/month" || text === "📆 الشهر") {
    await sendMonthReport(client, chatId);
    return;
  }

  if (text === "/recent" || text === "🧾 آخر العمليات") {
    await sendRecentReport(client, chatId);
    return;
  }

  if (text.startsWith("/delete")) {
    await handleDeleteCommand(client, chatId, text.slice(7).trim());
    return;
  }

  if (text === "➕ إضافة مصروف") {
    storage.setChatState(chatId, "awaiting_expense");
    await sendMainMenu(client, chatId, "أرسل المصروف بهذه الصيغة:\n25 قهوة");
    return;
  }

  if (text === "❌ حذف عملية") {
    storage.setChatState(chatId, "awaiting_delete");
    await sendMainMenu(client, chatId, "أرسل رقم العملية التي تريد حذفها.");
    return;
  }

  if (parseExpenseInput(text)) {
    storage.setChatState(chatId, "awaiting_expense");
    await handleAwaitingState(client, chatId, text, "awaiting_expense");
    return;
  }

  await sendMainMenu(client, chatId, "لم أفهم الطلب. أرسل /help لمعرفة الأوامر.");
}

async function runBot() {
  validateConfig();

  const client = new TelegramClient(config.botToken);

  console.log("Bot is running...");

  while (true) {
    try {
      const offset = storage.getLastUpdateId() + 1;
      const updates = await client.getUpdates(offset, config.pollingTimeoutSeconds);

      for (const update of updates) {
        storage.setLastUpdateId(update.update_id);

        if (update.message) {
          await handleMessage(client, update.message);
        }
      }
    } catch (error) {
      console.error("Bot loop error:", error.message);
      await sleep(3000);
    }
  }
}

runBot().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
