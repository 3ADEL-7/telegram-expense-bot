const fs = require("node:fs");
const path = require("node:path");

class Storage {
  constructor(filePath) {
    this.filePath = filePath;
    this.dirPath = path.dirname(filePath);
    this.state = null;
  }

  buildNextExpenseIds(expenses) {
    const nextExpenseIds = {};

    for (const expense of expenses) {
      const chatId = String(expense.chatId);
      const expenseId = Number(expense.id) || 0;
      const nextId = expenseId + 1;

      if (!nextExpenseIds[chatId] || nextExpenseIds[chatId] < nextId) {
        nextExpenseIds[chatId] = nextId;
      }
    }

    return nextExpenseIds;
  }

  normalizeChatStates(chatStates) {
    const normalizedStates = {};

    if (!chatStates || typeof chatStates !== "object") {
      return normalizedStates;
    }

    for (const [chatId, state] of Object.entries(chatStates)) {
      if (!state) {
        continue;
      }

      normalizedStates[String(chatId)] =
        typeof state === "string" ? { action: state } : state;
    }

    return normalizedStates;
  }

  normalizeChatSettings(chatSettings) {
    if (!chatSettings || typeof chatSettings !== "object") {
      return {};
    }

    const normalizedSettings = {};

    for (const [chatId, settings] of Object.entries(chatSettings)) {
      normalizedSettings[String(chatId)] = {
        monthlyBudget: settings && Number.isFinite(Number(settings.monthlyBudget))
          ? Number(settings.monthlyBudget)
          : null,
        autoWeeklySummary: Boolean(settings && settings.autoWeeklySummary),
        lastAutoSummaryWeekKey:
          settings && typeof settings.lastAutoSummaryWeekKey === "string"
            ? settings.lastAutoSummaryWeekKey
            : null
      };
    }

    return normalizedSettings;
  }

  normalizeExpenses(expenses) {
    const normalizedExpenses = [];
    let maxRecordId = 0;

    for (const expense of expenses) {
      const recordId = Number(expense.recordId || maxRecordId + 1);
      maxRecordId = Math.max(maxRecordId, recordId);

      normalizedExpenses.push({
        recordId,
        id: Number(expense.id),
        chatId: String(expense.chatId),
        amount: Number(expense.amount),
        note: expense.note || "",
        category: expense.category || "عام",
        createdAt: expense.createdAt || new Date().toISOString(),
        localDate: expense.localDate,
        localWeekKey: expense.localWeekKey,
        localMonthKey: expense.localMonthKey
      });
    }

    return {
      expenses: normalizedExpenses,
      nextRecordId: maxRecordId + 1
    };
  }

  ensureLoaded() {
    if (this.state) {
      return;
    }

    fs.mkdirSync(this.dirPath, { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      this.state = this.createInitialState();
      this.save();
      return;
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    const parsed = JSON.parse(raw);
    const normalizedExpensesState = this.normalizeExpenses(
      Array.isArray(parsed.expenses) ? parsed.expenses : []
    );
    const nextExpenseIds =
      parsed.nextExpenseIds && typeof parsed.nextExpenseIds === "object"
        ? parsed.nextExpenseIds
        : this.buildNextExpenseIds(normalizedExpensesState.expenses);

    this.state = {
      lastUpdateId: Number(parsed.lastUpdateId || 0),
      nextExpenseIds,
      nextRecordId: Number(parsed.nextRecordId || normalizedExpensesState.nextRecordId),
      expenses: normalizedExpensesState.expenses,
      chatStates: this.normalizeChatStates(parsed.chatStates),
      chatSettings: this.normalizeChatSettings(parsed.chatSettings)
    };

    this.save();
  }

  createInitialState() {
    return {
      lastUpdateId: 0,
      nextExpenseIds: {},
      nextRecordId: 1,
      expenses: [],
      chatStates: {},
      chatSettings: {}
    };
  }

  save() {
    const tempFile = `${this.filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tempFile, this.filePath);
  }

  getLastUpdateId() {
    this.ensureLoaded();
    return this.state.lastUpdateId;
  }

  setLastUpdateId(updateId) {
    this.ensureLoaded();
    this.state.lastUpdateId = Number(updateId || 0);
    this.save();
  }

  addExpense(expense) {
    this.ensureLoaded();
    const normalizedChatId = String(expense.chatId);
    const nextExpenseId = Number(this.state.nextExpenseIds[normalizedChatId] || 1);

    const item = {
      recordId: this.state.nextRecordId++,
      id: nextExpenseId,
      chatId: normalizedChatId,
      amount: Number(expense.amount),
      note: expense.note || "",
      category: expense.category || "عام",
      createdAt: expense.createdAt || new Date().toISOString(),
      localDate: expense.localDate,
      localWeekKey: expense.localWeekKey,
      localMonthKey: expense.localMonthKey
    };

    this.state.nextExpenseIds[normalizedChatId] = nextExpenseId + 1;
    this.state.expenses.push(item);
    this.save();
    return item;
  }

  getExpensesByChat(chatId) {
    this.ensureLoaded();
    const normalizedChatId = String(chatId);
    return this.state.expenses
      .filter((expense) => expense.chatId === normalizedChatId)
      .sort((left, right) => left.recordId - right.recordId);
  }

  getExpenseById(chatId, expenseId) {
    this.ensureLoaded();
    const normalizedChatId = String(chatId);
    const numericId = Number(expenseId);

    return (
      this.state.expenses.find(
        (expense) => expense.chatId === normalizedChatId && expense.id === numericId
      ) || null
    );
  }

  updateExpense(chatId, expenseId, updates) {
    this.ensureLoaded();
    const expense = this.getExpenseById(chatId, expenseId);

    if (!expense) {
      return null;
    }

    if (updates.amount !== undefined) {
      expense.amount = Number(updates.amount);
    }

    if (updates.note !== undefined) {
      expense.note = updates.note || "";
    }

    if (updates.category !== undefined) {
      expense.category = updates.category || "عام";
    }

    this.save();
    return expense;
  }

  deleteExpense(chatId, expenseId) {
    this.ensureLoaded();
    const normalizedChatId = String(chatId);
    const numericId = Number(expenseId);
    const index = this.state.expenses.findIndex(
      (expense) => expense.chatId === normalizedChatId && expense.id === numericId
    );

    if (index === -1) {
      return null;
    }

    const [removed] = this.state.expenses.splice(index, 1);
    this.save();
    return removed;
  }

  resetExpenseCounter(chatId) {
    this.ensureLoaded();
    const normalizedChatId = String(chatId);
    const expenses = this.state.expenses
      .filter((expense) => expense.chatId === normalizedChatId)
      .sort((left, right) => {
        if (left.createdAt === right.createdAt) {
          return left.recordId - right.recordId;
        }

        return left.createdAt.localeCompare(right.createdAt);
      });

    for (let index = 0; index < expenses.length; index += 1) {
      expenses[index].id = index + 1;
    }

    this.state.nextExpenseIds[normalizedChatId] = expenses.length + 1;
    this.save();

    return {
      count: expenses.length,
      nextId: expenses.length + 1
    };
  }

  setChatState(chatId, nextAction) {
    this.ensureLoaded();
    this.state.chatStates[String(chatId)] =
      typeof nextAction === "string" ? { action: nextAction } : nextAction;
    this.save();
  }

  getChatState(chatId) {
    this.ensureLoaded();
    return this.state.chatStates[String(chatId)] || null;
  }

  clearChatState(chatId) {
    this.ensureLoaded();
    delete this.state.chatStates[String(chatId)];
    this.save();
  }

  getChatSettings(chatId) {
    this.ensureLoaded();
    const normalizedChatId = String(chatId);

    return (
      this.state.chatSettings[normalizedChatId] || {
        monthlyBudget: null,
        autoWeeklySummary: false,
        lastAutoSummaryWeekKey: null
      }
    );
  }

  updateChatSettings(chatId, updates) {
    this.ensureLoaded();
    const normalizedChatId = String(chatId);
    const current = this.getChatSettings(normalizedChatId);

    this.state.chatSettings[normalizedChatId] = {
      ...current,
      ...updates
    };

    this.save();
    return this.state.chatSettings[normalizedChatId];
  }

  getChatsForAutoWeeklySummary() {
    this.ensureLoaded();

    return Object.entries(this.state.chatSettings)
      .filter(([, settings]) => settings.autoWeeklySummary)
      .map(([chatId, settings]) => ({
        chatId,
        settings
      }));
  }
}

module.exports = {
  Storage
};
