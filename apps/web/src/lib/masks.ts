export function maskCNPJ(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export const unmask = (v: string) => v.replace(/\D/g, "");

/** Stores Brazilian phone numbers in E.164 digits, always with country code 55. */
export function normalizePhone(value: string) {
  const digits = unmask(value);
  if (digits.length > 13) return digits;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    return `55${digits}`;
  }
  return digits;
}

export function maskPhone(value: string) {
  const raw = unmask(value);
  const d = normalizePhone(raw);

  // While typing a local number, wait for DDD + number before inserting 55.
  if (raw.length < 10 && !raw.startsWith("55")) return raw;
  if (d.length <= 2) return d;

  const country = d.slice(0, 2);
  const area = d.slice(2, 4);
  const number = d.slice(4);
  if (d.length <= 4) return `${country} ${area}`.trim();
  if (number.length <= 4) return `${country} ${area} ${number}`;

  const splitAt = number.length === 9 ? 5 : 4;
  return `${country} ${area} ${number.slice(0, splitAt)}-${number.slice(splitAt)}`;
}

// Números de WhatsApp vêm com DDI (ex: "5511999998888", sem "+"). maskPhone
// sozinho não serve pra isso (assume só DDD+número). Tenta reconhecer o "55"
// e formata o resto; sem esse padrão, só antepõe "+".
export function maskWhatsappPhone(value: string) {
  const raw = unmask(value);
  const d = raw.length <= 13 ? normalizePhone(raw) : raw;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    return `+${maskPhone(d)}`;
  }
  return d ? `+${d}` : "—";
}

export function isValidCNPJ(value: string) {
  const c = value.replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string) => {
    const w =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split("").reduce((a, n, i) => a + parseInt(n) * w[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12));
  const d2 = calc(c.slice(0, 12) + d1);
  return d1 === parseInt(c[12]) && d2 === parseInt(c[13]);
}

export function isValidWebsite(value: string) {
  try {
    const v = value.match(/^https?:\/\//i) ? value : `https://${value}`;
    const u = new URL(v);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export function maskCEP(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, "$1-$2");
}
