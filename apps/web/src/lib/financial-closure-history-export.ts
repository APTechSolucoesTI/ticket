export type ClosureHistoryExportRow = {
  revision: number;
  status: "closed" | "reopened";
  revenue: number;
  expense: number;
  result: number;
  budgetResult: number;
  resultDelta: number | null;
  lineCount: number;
  closedBy: string;
  closedAt: string;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
};

export type ClosureHistoryExportContext = {
  companyName: string;
  periodLabel: string;
  rows: ClosureHistoryExportRow[];
};

const money = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export async function exportClosureHistoryXlsx(context: ClosureHistoryExportContext) {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["APTicket - Histórico de fechamentos financeiros"],
    [`Empresa: ${context.companyName}`],
    [`Competência: ${context.periodLabel}`],
    [`Gerado em: ${new Date().toLocaleString("pt-BR")}`],
    [],
    [
      "Revisão",
      "Situação",
      "Receitas",
      "Despesas",
      "Resultado",
      "Resultado orçado",
      "Variação entre revisões",
      "Linhas",
      "Encerrado por",
      "Encerrado em",
      "Reaberto por",
      "Reaberto em",
      "Justificativa da reabertura",
    ],
    ...context.rows.map((row) => [
      row.revision,
      row.status === "closed" ? "Encerrada" : "Reaberta",
      row.revenue,
      row.expense,
      row.result,
      row.budgetResult,
      row.resultDelta,
      row.lineCount,
      row.closedBy,
      new Date(row.closedAt).toLocaleString("pt-BR"),
      row.reopenedBy ?? "",
      row.reopenedAt ? new Date(row.reopenedAt).toLocaleString("pt-BR") : "",
      row.reopenReason ?? "",
    ]),
  ]);
  worksheet["!merges"] = [0, 1, 2, 3].map((row) => ({
    s: { r: row, c: 0 },
    e: { r: row, c: 12 },
  }));
  worksheet["!cols"] = [
    { wch: 10 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 22 },
    { wch: 10 },
    { wch: 26 },
    { wch: 21 },
    { wch: 26 },
    { wch: 21 },
    { wch: 48 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Histórico");
  XLSX.writeFile(workbook, `historico-fechamento-${context.periodLabel.replace("/", "-")}.xlsx`);
}

export async function exportClosureHistoryPdf(context: ClosureHistoryExportContext) {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const widths = [15, 20, 28, 28, 28, 28, 31, 20, 42, 40];
  const headers = [
    "Rev.",
    "Situação",
    "Receitas",
    "Despesas",
    "Resultado",
    "Orçado",
    "Diferença",
    "Linhas",
    "Responsável",
    "Registro",
  ];
  const drawHeader = () => {
    document.setFillColor(18, 49, 100);
    document.rect(8, 8, 281, 18, "F");
    document.setTextColor(255, 255, 255);
    document.setFont("helvetica", "bold");
    document.setFontSize(13);
    document.text("APTicket | Histórico de fechamentos", 12, 16);
    document.setFont("helvetica", "normal");
    document.setFontSize(8);
    document.text(`${context.companyName} | ${context.periodLabel}`, 12, 22);
    document.setFillColor(235, 243, 247);
    document.rect(8, 31, 281, 8, "F");
    document.setTextColor(25, 35, 50);
    document.setFont("helvetica", "bold");
    document.setFontSize(7);
    let x = 8;
    headers.forEach((header, index) => {
      document.text(header, index > 1 && index < 8 ? x + widths[index] - 1 : x + 1.5, 36, {
        align: index > 1 && index < 8 ? "right" : "left",
      });
      x += widths[index];
    });
  };
  drawHeader();
  let y = 39;
  context.rows.forEach((row, index) => {
    if (y > 190) {
      document.addPage("a4", "landscape");
      drawHeader();
      y = 39;
    }
    if (index % 2) {
      document.setFillColor(249, 250, 251);
      document.rect(8, y, 281, 8, "F");
    }
    const values = [
      String(row.revision),
      row.status === "closed" ? "Encerrada" : "Reaberta",
      money.format(row.revenue),
      money.format(row.expense),
      money.format(row.result),
      money.format(row.budgetResult),
      row.resultDelta === null ? "-" : money.format(row.resultDelta),
      String(row.lineCount),
      row.closedBy,
      new Date(row.closedAt).toLocaleString("pt-BR"),
    ];
    document.setFont("helvetica", row.status === "closed" ? "bold" : "normal");
    document.setFontSize(6.7);
    document.setTextColor(25, 35, 50);
    let x = 8;
    values.forEach((value, valueIndex) => {
      const alignRight = valueIndex > 1 && valueIndex < 8;
      const fitted = document.splitTextToSize(value, widths[valueIndex] - 3)[0];
      document.text(fitted, alignRight ? x + widths[valueIndex] - 1 : x + 1.5, y + 5, {
        align: alignRight ? "right" : "left",
      });
      x += widths[valueIndex];
    });
    y += 8;
    if (row.reopenReason) {
      document.setFont("helvetica", "normal");
      document.setFontSize(6.5);
      document.setTextColor(100, 75, 20);
      document.text(`Reabertura: ${row.reopenReason}`, 12, y + 4, { maxWidth: 273 });
      y += 7;
    }
  });
  document.setFont("helvetica", "normal");
  document.setFontSize(6.5);
  document.setTextColor(100, 110, 125);
  document.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 8, 205);
  document.save(`historico-fechamento-${context.periodLabel.replace("/", "-")}.pdf`);
}
