export type NormalizedOfxTransaction = {
  fit_id: string;
  posted_at: string;
  amount: number;
  transaction_type: string | null;
  document_number: string | null;
  memo: string;
};

export type ParsedOfx = {
  periodStart: string;
  periodEnd: string;
  transactions: NormalizedOfxTransaction[];
};

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function ofxDate(value: string) {
  const compact = value.replace(/[^0-9]/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(compact)) throw new Error("O extrato contém uma data inválida.");
  const result = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  if (Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) {
    throw new Error("O extrato contém uma data inválida.");
  }
  return result;
}

export function parseOfx(text: string): ParsedOfx {
  const blocks = [
    ...text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi),
  ];
  const transactions = blocks.map((match, index) => {
    const block = match[1];
    const amount = Number(tag(block, "TRNAMT").replace(",", "."));
    const fitId = tag(block, "FITID");
    const memo = tag(block, "MEMO") || tag(block, "NAME") || `Movimento ${index + 1}`;
    if (!fitId || !Number.isFinite(amount) || amount === 0) {
      throw new Error(`O movimento ${index + 1} não possui identificador ou valor válido.`);
    }
    return {
      fit_id: fitId.slice(0, 150),
      posted_at: ofxDate(tag(block, "DTPOSTED")),
      amount: Math.round(amount * 100) / 100,
      transaction_type: tag(block, "TRNTYPE").slice(0, 30) || null,
      document_number: (tag(block, "CHECKNUM") || tag(block, "REFNUM")).slice(0, 100) || null,
      memo: memo.slice(0, 500),
    };
  });
  if (!transactions.length)
    throw new Error("Nenhum movimento bancário foi encontrado no arquivo OFX.");
  const dates = transactions.map((item) => item.posted_at).sort();
  return {
    periodStart: tag(text, "DTSTART") ? ofxDate(tag(text, "DTSTART")) : dates[0]!,
    periodEnd: tag(text, "DTEND") ? ofxDate(tag(text, "DTEND")) : dates[dates.length - 1]!,
    transactions,
  };
}

export async function readOfxFile(file: File) {
  if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".ofx")) {
    throw new Error("Selecione um arquivo no formato OFX.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("O arquivo OFX deve possuir no máximo 10 MB.");
  const bytes = await file.arrayBuffer();
  const header = new TextDecoder("windows-1252").decode(bytes.slice(0, 500));
  const utf8 = /CHARSET:\s*(UTF-?8|65001)/i.test(header);
  const text = new TextDecoder(utf8 ? "utf-8" : "windows-1252").decode(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return { ...parseOfx(text), hash };
}
