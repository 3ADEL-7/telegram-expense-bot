const fs = require("node:fs");
const path = require("node:path");

class Storage {
  constructor(filePath) {
    this.filePath = filePath;
    this.dirPath = path.dirname(filePath);
    this.state = null;
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

    this.state = {
      lastUpdateId: Number(parsed.lastUpdateId || 0),
      nextExpenseId: Number(parsed.nextExpenseId || 1),
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      chatStates: parsed.chatStates && typeof parsed.chatStates === "object" ? parsed.chatStates : {}
    };
  }

  createInitialState() {
    return {
      lastUpdateId: 0,
      nextExpenseId: 1,
      expenses: [],
      chatStates: {}
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

    const item = {
      id: this.state.nextExpenseId++,
      chatId: String(expense.chatId),
      amount: Number(expense.amount),
      note: expense.note || "",
      createdAt: expense.createdAt || new Date().toISOString(),
      localDate: expense.localDate,
      localWeekKey: expense.localWeekKey,
      localMonthKey: expense.localMonthKey
    };

    this.state.expenses.push(item);
    this.save();
    return item;
  }

  getExpensesByChat(chatId) {
    this.ensureLoaded();
    const normalizedChatId = String(chatId);
    return this.state.expenses.filter((expense) => expense.chatId === normalizedChatId);
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

  setChatState(chatId, nextAction) {
    this.ensureLoaded();
    this.state.chatStates[String(chatId)] = nextAction;
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
}

module.exports = {
  Storage
};
