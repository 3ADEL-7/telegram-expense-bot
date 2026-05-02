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

function summarizeCategories(expenses) {
  const totals = new Map();

  for (const expense of expenses) {
    const category = expense.category || "عام";
    totals.set(category, (totals.get(category) || 0) + Number(expense.amount));
  }

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([category, total]) => ({ category, total }));
}

function buildBudgetSection(expenses, budgetAmount) {
  if (!Number.isFinite(Number(budgetAmount))) {
    return [];
  }

  const total = sumExpenses(expenses);
  const normalizedBudget = Number(budgetAmount);
  const remaining = normalizedBudget - total;

  if (remaining >= 0) {
    return [
      `الميزانية: ${formatMoney(normalizedBudget)}`,
      `المتبقي: ${formatMoney(remaining)}`
    ];
  }

  return [
    `الميزانية: ${formatMoney(normalizedBudget)}`,
    `تم تجاوزها بـ ${formatMoney(Math.abs(remaining))}`
  ];
}

function buildCategorySection(expenses) {
  const categories = summarizeCategories(expenses).slice(0, 5);

  if (categories.length === 0) {
    return [];
  }

  return [
    "التصنيفات:",
    ...categories.map(({ category, total }) => `- ${category}: ${formatMoney(total)}`)
  ];
}

function buildRecentLines(expenses, limit) {
  return expenses
    .slice(-limit)
    .reverse()
    .map((expense) => {
      const note = expense.note ? ` - ${expense.note}` : "";
      const category = expense.category ? ` [${expense.category}]` : "";
      return `#${expense.id} - ${formatMoney(expense.amount)}${category}${note}`;
    });
}

function buildPeriodMessage(title, expenses, options = {}) {
  const lines = [title];

  if (expenses.length === 0) {
    const budgetLines = buildBudgetSection(expenses, options.budgetAmount);
    lines.push("لا توجد مصاريف مسجلة.");

    if (budgetLines.length > 0) {
      lines.push(...budgetLines);
    }

    return lines.join("\n");
  }

  lines.push(`الإجمالي: ${formatMoney(sumExpenses(expenses))}`);
  lines.push(`عدد العمليات: ${expenses.length}`);

  const budgetLines = buildBudgetSection(expenses, options.budgetAmount);
  if (budgetLines.length > 0) {
    lines.push(...budgetLines);
  }

  const categoryLines = buildCategorySection(expenses);
  if (categoryLines.length > 0) {
    lines.push(...categoryLines);
  }

  lines.push("آخر العمليات:");
  lines.push(...buildRecentLines(expenses, options.recentLimit || 5));

  return lines.join("\n");
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
      const category = expense.category ? ` [${expense.category}]` : "";
      return `#${expense.id} | ${expense.localDate} | ${formatMoney(expense.amount)}${category}${note}`;
    });

  return ["آخر 10 عمليات:", ...lines].join("\n");
}

function buildCategoriesMessage(expenses) {
  const categories = summarizeCategories(expenses);

  if (categories.length === 0) {
    return "لا توجد مصاريف لهذا الشهر حتى الآن.";
  }

  return [
    "تصنيفات هذا الشهر:",
    ...categories.map(({ category, total }) => `- ${category}: ${formatMoney(total)}`)
  ].join("\n");
}

function buildBudgetMessage(monthExpenses, budgetAmount) {
  if (!Number.isFinite(Number(budgetAmount))) {
    return "لم يتم تعيين ميزانية شهرية بعد. استخدم:\n/budget 2000";
  }

  const total = sumExpenses(monthExpenses);
  const normalizedBudget = Number(budgetAmount);
  const remaining = normalizedBudget - total;

  return [
    "الميزانية الشهرية:",
    `الميزانية: ${formatMoney(normalizedBudget)}`,
    `المصروف الحالي: ${formatMoney(total)}`,
    remaining >= 0
      ? `المتبقي: ${formatMoney(remaining)}`
      : `تم تجاوز الميزانية بـ ${formatMoney(Math.abs(remaining))}`
  ].join("\n");
}

module.exports = {
  buildBudgetMessage,
  buildCategoriesMessage,
  buildPeriodMessage,
  buildRecentMessage,
  filterByDate,
  filterByMonth,
  filterByWeek,
  sumExpenses
};
