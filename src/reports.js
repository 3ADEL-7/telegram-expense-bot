const { formatMoney } = require("./time");

function sumExpenses(expenses) {
  return expenses.reduce((total, expense) => total + Number(expense.amount), 0);
}

function filterByDate(expenses, dateKey) {
  return expenses.filter((expense) => expense.localDate === dateKey);
}

function filterByWeek(expenses, weekKey) {
  return expenses.filter((expense) => expense.localWeekKey === weekKey);
}

function filterByMonth(expenses, monthKey) {
  return expenses.filter((expense) => expense.localMonthKey === monthKey);
}

function buildPeriodMessage(title, expenses) {
  if (expenses.length === 0) {
    return `${title}\nلا توجد مصاريف مسجلة.`;
  }

  const total = sumExpenses(expenses);
  const lines = expenses
    .slice(-5)
    .reverse()
    .map(
      (expense) =>
        `#${expense.id} - ${formatMoney(expense.amount)}${expense.note ? ` - ${expense.note}` : ""}`
    );

  return [
    title,
    `الإجمالي: ${formatMoney(total)}`,
    `عدد العمليات: ${expenses.length}`,
    "آخر العمليات:",
    ...lines
  ].join("\n");
}

function buildRecentMessage(expenses) {
  if (expenses.length === 0) {
    return "لا توجد عمليات مسجلة حتى الآن.";
  }

  const lines = expenses
    .slice(-10)
    .reverse()
    .map((expense) => {
      const note = expense.note ? ` - ${expense.note}` : "";
      return `#${expense.id} | ${expense.localDate} | ${formatMoney(expense.amount)}${note}`;
    });

  return ["آخر 10 عمليات:", ...lines].join("\n");
}

module.exports = {
  buildPeriodMessage,
  buildRecentMessage,
  filterByDate,
  filterByMonth,
  filterByWeek,
  sumExpenses
};
