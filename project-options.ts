export const projectPriorityOptions = [
  { value: "urgent", label: "紧急" },
  { value: "high", label: "高" },
  { value: "medium", label: "普通" },
  { value: "low", label: "低" },
] as const;

export type ProjectPriority = typeof projectPriorityOptions[number]["value"];

export const progressPercentOptions = [0, 25, 50, 75, 100] as const;

export function isProjectPriority(value: unknown): value is ProjectPriority {
  return typeof value === "string" && projectPriorityOptions.some((option) => option.value === value);
}

export function parseProgressPercent(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return progressPercentOptions.includes(parsed as typeof progressPercentOptions[number]) ? parsed : null;
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function endOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0);
}

function endOfQuarter(year: number, month: number) {
  const quarterEndMonth = Math.floor(month / 3) * 3 + 2;
  return endOfMonth(year, quarterEndMonth);
}

export function plannedDateOptions(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const addDays = (days: number) => {
    const value = new Date(referenceDate);
    value.setDate(value.getDate() + days);
    return formatDate(value);
  };
  const nextMonth = endOfMonth(year, month + 1);
  const currentQuarter = endOfQuarter(year, month);
  const nextQuarter = new Date(currentQuarter.getFullYear(), currentQuarter.getMonth() + 1, 1);

  return [
    { value: "", label: "未设置" },
    { value: addDays(7), label: `一周内（${addDays(7)}）` },
    { value: addDays(14), label: `两周内（${addDays(14)}）` },
    { value: formatDate(endOfMonth(year, month)), label: `本月底（${formatDate(endOfMonth(year, month))}）` },
    { value: formatDate(nextMonth), label: `下月底（${formatDate(nextMonth)}）` },
    { value: formatDate(currentQuarter), label: `本季度末（${formatDate(currentQuarter)}）` },
    { value: formatDate(endOfQuarter(nextQuarter.getFullYear(), nextQuarter.getMonth())), label: `下季度末（${formatDate(endOfQuarter(nextQuarter.getFullYear(), nextQuarter.getMonth()))}）` },
  ];
}
