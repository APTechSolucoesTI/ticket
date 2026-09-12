export type FinancialStatementExportRow = {
  label: string;
  months: number[];
  accumulated: number;
  budget: number;
  deviation: number;
  kind: "section" | "detail" | "result";
};

export type FinancialStatementExportContext = {
  companyName: string;
  year: number;
  centerLabel: string;
  groupingLabel: string;
  rows: FinancialStatementExportRow[];
};

const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const pdfNumber = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export async function exportFinancialStatementXlsx(context: FinancialStatementExportContext) {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["APTicket - Demonstrativo gerencial de resultado"],
    [`Empresa: ${context.companyName}`],
    [
      `Exercício: ${context.year} | Centro de custo: ${context.centerLabel} | Agrupamento: ${context.groupingLabel}`,
    ],
    [`Gerado em: ${new Date().toLocaleString("pt-BR")}`],
    [],
    ["Linha gerencial", ...months, "Acumulado", "Orçado", "Desvio"],
    ...context.rows.map((row) => [
      row.label,
      ...row.months,
      row.accumulated,
      row.budget,
      row.deviation,
    ]),
  ]);
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 15 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 15 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 15 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 15 } },
  ];
  worksheet["!cols"] = [
    { wch: 42 },
    ...Array.from({ length: 12 }, () => ({ wch: 14 })),
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Resultado gerencial");
  XLSX.writeFile(workbook, `resultado-gerencial-${context.year}.xlsx`);
}

export async function exportFinancialStatementPdf(context: FinancialStatementExportContext) {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const widths = [43, ...Array<number>(12).fill(13), 27, 27, 27];

  const drawHeader = () => {
    document.setFillColor(18, 49, 100);
    document.rect(8, 8, 281, 17, "F");
    document.setTextColor(255, 255, 255);
    document.setFont("helvetica", "bold");
    document.setFontSize(13);
    document.text("APTicket | Demonstrativo gerencial de resultado", 12, 15);
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.text(`${context.companyName} | Exercício ${context.year}`, 12, 21);
    document.setTextColor(70, 80, 95);
    document.text(`${context.centerLabel} | Agrupamento: ${context.groupingLabel}`, 8, 30);
    document.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 289, 30, {
      align: "right",
    });
    document.setFillColor(235, 243, 247);
    document.rect(8, 33, 281, 8, "F");
    document.setTextColor(25, 35, 50);
    document.setFont("helvetica", "bold");
    document.setFontSize(6.5);
    let x = 8;
    ["Linha gerencial", ...months, "Acumulado", "Orçado", "Desvio"].forEach((label, index) => {
      document.text(label, index ? x + widths[index] - 1 : x + 1.5, 38, {
        align: index ? "right" : "left",
      });
      x += widths[index];
    });
  };

  drawHeader();
  let y = 41;
  context.rows.forEach((row, rowIndex) => {
    if (y > 197) {
      document.addPage("a4", "landscape");
      drawHeader();
      y = 41;
    }
    if (row.kind !== "detail") {
      const color = row.kind === "result" ? [218, 232, 248] : [241, 245, 249];
      document.setFillColor(color[0], color[1], color[2]);
      document.rect(8, y, 281, 6, "F");
      document.setFont("helvetica", "bold");
    } else {
      if (rowIndex % 2) {
        document.setFillColor(250, 251, 252);
        document.rect(8, y, 281, 6, "F");
      }
      document.setFont("helvetica", "normal");
    }
    document.setTextColor(25, 35, 50);
    document.setFontSize(6.2);
    let x = 8;
    const label = document.splitTextToSize(row.label, widths[0] - 3)[0];
    document.text(label, x + (row.kind === "detail" ? 4 : 1.5), y + 4);
    x += widths[0];
    [...row.months, row.accumulated, row.budget, row.deviation].forEach((value, index) => {
      document.text(pdfNumber.format(value), x + widths[index + 1] - 1, y + 4, {
        align: "right",
      });
      x += widths[index + 1];
    });
    y += 6;
  });
  document.setFont("helvetica", "normal");
  document.setFontSize(6.5);
  document.setTextColor(100, 110, 125);
  document.text("Valores em reais. Despesas são apresentadas com sinal negativo.", 8, 205);
  document.save(`resultado-gerencial-${context.year}.pdf`);
}
