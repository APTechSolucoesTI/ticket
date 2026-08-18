import { Injectable } from '@nestjs/common';

// Portado de callUazapi + testUazapiConnection/connect/disconnect/send em
// apps/web/src/lib/whatsapp.functions.ts. O token da uazapi só existe aqui
// (client HTTP puro), nunca chega ao frontend.

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function normalizeNumber(raw: string): string {
  return String(raw).replace(/\D/g, '');
}

export interface UazapiResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

@Injectable()
export class UazapiService {
  async call(
    baseUrl: string,
    token: string,
    path: string,
    init?: RequestInit,
  ): Promise<UazapiResponse> {
    const url = `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        token,
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep as text */
    }
    return { ok: res.ok, status: res.status, body };
  }

  async status(baseUrl: string, token: string) {
    const r = await this.call(baseUrl, token, '/instance/status', {
      method: 'GET',
    });
    const b = (r.body ?? {}) as Record<string, unknown>;
    const instance = (b.instance as Record<string, unknown> | undefined) ?? b;
    return {
      ok: r.ok,
      connected:
        instance?.status === 'connected' ||
        instance?.state === 'open' ||
        (b as { connected?: boolean }).connected === true,
      number:
        (instance?.owner as string | undefined) ??
        (instance?.number as string | undefined) ??
        null,
    };
  }

  async connect(baseUrl: string, token: string) {
    const r = await this.call(baseUrl, token, '/instance/connect', {
      method: 'POST',
      body: '{}',
    });
    const b = (r.body ?? {}) as Record<string, unknown>;
    const inst = (b.instance as Record<string, unknown> | undefined) ?? b;
    let qr =
      (b.qrcode as string | undefined) ??
      (b.qr as string | undefined) ??
      (inst?.qrcode as string | undefined) ??
      (inst?.qr as string | undefined) ??
      null;
    if (qr && !qr.startsWith('data:')) qr = `data:image/png;base64,${qr}`;
    return {
      ok: r.ok,
      qrcode: qr,
      connected: inst?.status === 'connected' || inst?.state === 'open',
    };
  }

  async disconnect(baseUrl: string, token: string) {
    const r = await this.call(baseUrl, token, '/instance/disconnect', {
      method: 'POST',
      body: '{}',
    });
    return { ok: r.ok };
  }

  async sendText(baseUrl: string, token: string, number: string, text: string) {
    return this.call(baseUrl, token, '/send/text', {
      method: 'POST',
      body: JSON.stringify({ number: normalizeNumber(number), text }),
    });
  }
}
