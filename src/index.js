const { config, validateConfig } = require("./config");
const {
  buildBudgetMessage,
  buildCategoriesMessage,
  buildPeriodMessage,
  buildRecentMessage,
  filterByDate,
  filterByMonth,
  filterByWeek
} = require("./reports");
const { Storage } = require("./storage");
const { TelegramClient } = require("./telegram");
const {
  formatMoney,
  getLocalDateKey,
  getLocalMonthKey,
  getLocalWeekKey,
  shiftDateKey
} = require("./time");

const storage = new Storage(config.dataFile);
const AUTO_SUMMARY_CHECK_INTERVAL_MS = 60 * 1000;

let lastAutoSummaryCheckAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text) {
  return String(text || "").trim();
}

function normalizeArabicDigits(value) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const easternDigits = "۰۱۲۳۴۵۶۷۸۹";

  return String(value || "")
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(easternDigits.indexOf(digit)))
    .replace(/[٫،]/g, ".")
    .replace(/\u066C/g, "");
}

function buildKeyboard() {
  return {
    keyboard: [
      [{ text: "➕ إضافة مصروف" }, { text: "📅 اليوم" }],
      [{ text: "🗓 الأسبوع" }, { text: "📆 الشهر" }],
      [{ text: "🧾 آخر العمليات" }, { text: "🏷 التصنيفات" }],
      [{ text: "💰 الميزانية" }, { text: "✏️ تعديل مصروف" }],
      [{ text: "❌ حذف عملية" }, { text: "🔁 تصفير العداد" }]
    ],
    resize_keyboard: true
  };
}

function buildHelpMessage() {
  return [
    "أهلًا بك في بوت المصاريف.",
    "",
    "الأوامر الأساسية:",
    "/add 25 قهوة",
    "/add 35 أوبر #مواصلات",
    "/today",
    "/week",
    "/month",
    "/recent",
    "/delete 3",
    "/edit 3 45 أوبر #مواصلات",
    "",
    "أوامر إضافية:",
    "/categories",
    "/budget 2000",
    "/budget off",
    "/autosummary on",
    "/autosummary off",
    "/resetcounter",
    "",
    "اكتب التصنيف بهذه الصيغة: #تصنيف",
    "مثال: 18 لاتيه #قهوة"
  ].join("\n");
}

function parseCategory(rest) {
  if (!rest) {
    return {
      note: "",
      category: "عام"
    };
  }

  const categoryMatch = rest.match(/(?:^|\s)#([^\s#]+)/);
  const category = categoryMatch ? categoryMatch[1].trim() : "عام";
  const note = rest.replace(/(?:^|\s)#[^\s#]+/, " ").replace(/\s+/g, " ").trim();

  return {
    note,
    category
  };
}

function parseExpenseInput(text) {
  const normalized = normalizeArabicDigits(text).trim();
  const match = normalized.match(/^(\d+(?:[.,]\d{1,2})?)(?:\s+(.+))?$/);

  if (!match) {
    return null;
  }

  const amount = Number(match[1].replace(",", "."));

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const details = parseCategory((match[2] || "").trim());

  return {
    amount,
    note: details.note,
    category: details.category
  };
}

function parseExpenseId(value) {
  const normalized = normalizeArabicDigits(value).trim();
  const numericId = Number(normalized);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  return numericId;
}

function parseBudgetAmount(value) {
  const normalized = normalizeArabicDigits(value).trim().toLowerCase();

  if (!normalized) {
    return { action: "show" };
  }

  if (normalized === "off" || normalized === "cancel" || normalized === "disable") {
    return { action: "disable" };
  }

  const amount = Number(normalized.replace(",", "."));

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return {
    action: "set",
    amount
  };
}

function parseCommandWithTarget(text, command) {
  const normalized = normalizeText(text);
  const regex = new RegExp(`^\\/${command}(?:@[\\w_]+)?(?:\\s+(.*))?$`, "i");
  const match = normalized.match(regex);
  return match ? (match[1] || "").trim() : null;
}

function isCommand(text, command) {
  return parseCommandWithTarget(text, command) !== null;
}

function isConfirmation(text) {
  const normalized = normalizeText(text).toLowerCase();
  return ["نعم", "اي", "أيوه", "ايوه", "yes", "y", "confirm", "تأكيد"].includes(normalized);
}

function formatExpenseLine(expense) {
  return [
    `#${expense.id}`,
    formatMoney(expense.amount),
    `[${expense.category || "عام"}]`,
    expense.note || ""
  ]
    .filter(Boolean)
    .join(" - ");
}

function createExpenseRecord(chatId, parsed) {
  const now = new Date();

  return {
    chatId,
    amount: parsed.amount,
    note: parsed.note,
    category: parsed.category,
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

async function sendHelp(client, chatId) {
  await sendMainMenu(client, chatId, buildHelpMessage());
}

async function saveExpenseAndConfirm(client, chatId, parsed) {
  const expense = storage.addExpense(createExpenseRecord(chatId, parsed));
  storage.clearChatState(chatId);

  await sendMainMenu(
    client,
    chatId,
    [
      `تم تسجيل المصروف ${formatExpenseLine(expense)}`,
      `عددك التالي لهذا المستخدم: #${expense.id + 1}`
    ].join("\n")
  );
}

async function handleAddCommand(client, chatId, textAfterCommand) {
  const parsed = parseExpenseInput(textAfterCommand);

  if (!parsed) {
    storage.setChatState(chatId, { action: "awaiting_expense" });
    await sendMainMenu(
      client,
      chatId,
      "أرسل المصروف بهذه الصيغة:\n25 قهوة\nأو\n35 أوبر #مواصلات"
    );
    return;
  }

  await saveExpenseAndConfirm(client, chatId, parsed);
}

async function handleDeleteCommand(client, chatId, textAfterCommand) {
  const expenseId = parseExpenseId(textAfterCommand);

  if (!expenseId) {
    storage.setChatState(chatId, { action: "awaiting_delete" });
    await sendMainMenu(client, chatId, "أرسل رقم العملية التي تريد حذفها، مثل:\n3");
    return;
  }

  const removed = storage.deleteExpense(chatId, expenseId);
  storage.clearChatState(chatId);

  if (!removed) {
    await sendMainMenu(client, chatId, "لم أجد عملية بهذا الرقم.");
    return;
  }

  await sendMainMenu(client, chatId, `تم حذف ${formatExpenseLine(removed)}`);
}

async function handleEditCommand(client, chatId, textAfterCommand) {
  const normalized = normalizeText(textAfterCommand);
  const match = normalized.match(/^(\S+)(?:\s+(.+))?$/);
  const expenseId = match ? parseExpenseId(match[1]) : null;

  if (!expenseId) {
    await sendMainMenu(
      client,
      chatId,
      "استخدم الأمر هكذا:\n/edit 3 45 أوبر #مواصلات"
    );
    return;
  }

  const existingExpense = storage.getExpenseById(chatId, expenseId);
  if (!existingExpense) {
    await sendMainMenu(client, chatId, "لم أجد عملية بهذا الرقم.");
    return;
  }

  if (!match[2]) {
    storage.setChatState(chatId, {
      action: "awaiting_edit",
      expenseId
    });
    await sendMainMenu(
      client,
      chatId,
      [
        `أرسل البيانات الجديدة للعملية #${expenseId}`,
        "مثال:",
        "45 أوبر #مواصلات"
      ].join("\n")
    );
    return;
  }

  const parsed = parseExpenseInput(match[2]);
  if (!parsed) {
    await sendMainMenu(client, chatId, "الصيغة غير صحيحة. مثال:\n/edit 3 45 أوبر #مواصلات");
    return;
  }

  const updated = storage.updateExpense(chatId, expenseId, parsed);
  await sendMainMenu(client, chatId, `تم تعديل المصروف إلى:\n${formatExpenseLine(updated)}`);
}

async function handleBudgetCommand(client, chatId, textAfterCommand) {
  const parsedBudget = parseBudgetAmount(textAfterCommand);
  const monthKey = getLocalMonthKey(new Date(), config.timezone);
  const monthExpenses = filterByMonth(storage.getExpensesByChat(chatId), monthKey);

  if (!parsedBudget) {
    await sendMainMenu(
      client,
      chatId,
      "استخدم الأمر هكذا:\n/budget 2000\nأو\n/budget off"
    );
    return;
  }

  if (parsedBudget.action === "show") {
    const settings = storage.getChatSettings(chatId);
    await sendMainMenu(client, chatId, buildBudgetMessage(monthExpenses, settings.monthlyBudget));
    return;
  }

  if (parsedBudget.action === "disable") {
    storage.updateChatSettings(chatId, { monthlyBudget: null });
    await sendMainMenu(client, chatId, "تم إيقاف الميزانية الشهرية.");
    return;
  }

  storage.updateChatSettings(chatId, { monthlyBudget: parsedBudget.amount });
  await sendMainMenu(
    client,
    chatId,
    [
      `تم تعيين الميزانية الشهرية إلى ${formatMoney(parsedBudget.amount)}`,
      buildBudgetMessage(monthExpenses, parsedBudget.amount)
    ].join("\n")
  );
}

async function handleAutoSummaryCommand(client, chatId, textAfterCommand) {
  const value = normalizeText(textAfterCommand).toLowerCase();
  const currentWeekKey = getLocalWeekKey(new Date(), config.timezone);

  if (!value) {
    const settings = storage.getChatSettings(chatId);
    await sendMainMenu(
      client,
      chatId,
      settings.autoWeeklySummary
        ? "الملخص الأسبوعي التلقائي مفعّل."
        : "الملخص الأسبوعي التلقائي متوقف."
    );
    return;
  }

  if (value === "on" || value === "enable" || value === "start") {
    storage.updateChatSettings(chatId, {
      autoWeeklySummary: true,
      lastAutoSummaryWeekKey: currentWeekKey
    });
    await sendMainMenu(client, chatId, "تم تفعيل الملخص الأسبوعي التلقائي.");
    return;
  }

  if (value === "off" || value === "disable" || value === "stop") {
    storage.updateChatSettings(chatId, { autoWeeklySummary: false });
    await sendMainMenu(client, chatId, "تم إيقاف الملخص الأسبوعي التلقائي.");
    return;
  }

  await sendMainMenu(client, chatId, "استخدم:\n/autosummary on\nأو\n/autosummary off");
}

async function handleResetCounterCommand(client, chatId) {
  storage.setChatState(chatId, { action: "awaiting_reset_counter_confirmation" });
  await sendMainMenu(
    client,
    chatId,
    [
      "سيتم حذف كل مصاريفك الحالية وتصفير العداد لهذا المستخدم.",
      "أرسل: نعم",
      "أو أرسل أي شيء آخر للإلغاء."
    ].join("\n")
  );
}

async function handleAwaitingState(client, chatId, text, state) {
  if (!state || !state.action) {
    return false;
  }

  if (state.action === "awaiting_expense") {
    const parsed = parseExpenseInput(text);

    if (!parsed) {
      await sendMainMenu(client, chatId, "الصيغة غير صحيحة. أرسل مثل:\n25 غداء #أكل");
      return true;
    }

    await saveExpenseAndConfirm(client, chatId, parsed);
    return true;
  }

  if (state.action === "awaiting_delete") {
    await handleDeleteCommand(client, chatId, text);
    return true;
  }

  if (state.action === "awaiting_edit") {
    const parsed = parseExpenseInput(text);

    if (!parsed) {
      await sendMainMenu(client, chatId, "الصيغة غير صحيحة. أرسل مثل:\n45 أوبر #مواصلات");
      return true;
    }

    const updated = storage.updateExpense(chatId, state.expenseId, parsed);
    storage.clearChatState(chatId);

    if (!updated) {
      await sendMainMenu(client, chatId, "لم أجد العملية المراد تعديلها.");
      return true;
    }

    await sendMainMenu(client, chatId, `تم تعديل المصروف إلى:\n${formatExpenseLine(updated)}`);
    return true;
  }

  if (state.action === "awaiting_reset_counter_confirmation") {
    storage.clearChatState(chatId);

    if (!isConfirmation(text)) {
      await sendMainMenu(client, chatId, "تم إلغاء تصفير العداد.");
      return true;
    }

    const result = storage.resetExpenseCounter(chatId);
    await sendMainMenu(
      client,
      chatId,
      [
        `تم حذف ${result.count} عملية من سجلك.`,
        `تم تصفير العداد، وأول مصروف جديد سيكون رقمه #${result.nextId}.`
      ].join("\n")
    );
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

async function sendWeekReport(client, chatId, title = "تقرير الأسبوع") {
  const expenses = storage.getExpensesByChat(chatId);
  const weekKey = getLocalWeekKey(new Date(), config.timezone);
  const report = buildPeriodMessage(title, filterByWeek(expenses, weekKey));
  await sendMainMenu(client, chatId, report);
}

async function sendMonthReport(client, chatId) {
  const expenses = storage.getExpensesByChat(chatId);
  const monthKey = getLocalMonthKey(new Date(), config.timezone);
  const settings = storage.getChatSettings(chatId);
  const report = buildPeriodMessage("تقرير الشهر", filterByMonth(expenses, monthKey), {
    budgetAmount: settings.monthlyBudget
  });
  await sendMainMenu(client, chatId, report);
}

async function sendRecentReport(client, chatId) {
  const expenses = storage.getExpensesByChat(chatId);
  await sendMainMenu(client, chatId, buildRecentMessage(expenses));
}

async function sendCategoriesReport(client, chatId) {
  const expenses = storage.getExpensesByChat(chatId);
  const monthKey = getLocalMonthKey(new Date(), config.timezone);
  await sendMainMenu(client, chatId, buildCategoriesMessage(filterByMonth(expenses, monthKey)));
}

async function processAutoWeeklySummaries(client) {
  const now = Date.now();

  if (now - lastAutoSummaryCheckAt < AUTO_SUMMARY_CHECK_INTERVAL_MS) {
    return;
  }

  lastAutoSummaryCheckAt = now;

  const currentWeekKey = getLocalWeekKey(new Date(), config.timezone);
  const previousWeekKey = shiftDateKey(currentWeekKey, -7);

  for (const item of storage.getChatsForAutoWeeklySummary()) {
    if (item.settings.lastAutoSummaryWeekKey === currentWeekKey) {
      continue;
    }

    const expenses = storage.getExpensesByChat(item.chatId);
    const weeklyExpenses = filterByWeek(expenses, previousWeekKey);
    const report = buildPeriodMessage("الملخص الأسبوعي التلقائي", weeklyExpenses);

    await sendMainMenu(client, item.chatId, report);
    storage.updateChatSettings(item.chatId, {
      lastAutoSummaryWeekKey: currentWeekKey
    });
  }
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

  if (isCommand(text, "start") || isCommand(text, "help")) {
    await sendHelp(client, chatId);
    return;
  }

  if (isCommand(text, "add")) {
    await handleAddCommand(client, chatId, parseCommandWithTarget(text, "add"));
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

  if (isCommand(text, "delete")) {
    await handleDeleteCommand(client, chatId, parseCommandWithTarget(text, "delete"));
    return;
  }

  if (isCommand(text, "edit")) {
    await handleEditCommand(client, chatId, parseCommandWithTarget(text, "edit"));
    return;
  }

  if (isCommand(text, "budget") || text === "💰 الميزانية") {
    await handleBudgetCommand(client, chatId, parseCommandWithTarget(text, "budget") || "");
    return;
  }

  if (isCommand(text, "autosummary")) {
    await handleAutoSummaryCommand(client, chatId, parseCommandWithTarget(text, "autosummary"));
    return;
  }

  if (text === "/categories" || text === "🏷 التصنيفات") {
    await sendCategoriesReport(client, chatId);
    return;
  }

  if (text === "/resetcounter" || text === "🔁 تصفير العداد") {
    await handleResetCounterCommand(client, chatId);
    return;
  }

  if (text === "➕ إضافة مصروف") {
    storage.setChatState(chatId, { action: "awaiting_expense" });
    await sendMainMenu(client, chatId, "أرسل المصروف بهذه الصيغة:\n25 قهوة #مشروبات");
    return;
  }

  if (text === "❌ حذف عملية") {
    storage.setChatState(chatId, { action: "awaiting_delete" });
    await sendMainMenu(client, chatId, "أرسل رقم العملية التي تريد حذفها.");
    return;
  }

  if (text === "✏️ تعديل مصروف") {
    await sendMainMenu(client, chatId, "استخدم:\n/edit 3 45 أوبر #مواصلات");
    return;
  }

  if (parseExpenseInput(text)) {
    await saveExpenseAndConfirm(client, chatId, parseExpenseInput(text));
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

      await processAutoWeeklySummaries(client);
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
