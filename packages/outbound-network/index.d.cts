import type { Socket } from "node:net";

export class OutboundNetworkError extends Error { readonly code: string; }
export function isPublicAddress(address: string): boolean;
export interface PublicHttpOptions {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Reject cross-origin redirects when carrying credentials. */
  credentials?: boolean;
}
export interface PublicHttpResponse {
  ok: boolean; status: number; headers: Headers; bytes: Buffer; text(): string;
}
export function publicHttpRequest(url: string, options?: PublicHttpOptions): Promise<PublicHttpResponse>;
export function publicMailEndpoint(host: string, port: number): Promise<{ host: string; port: number; servername?: string }>;
/** A fresh validated, DNS-pinned TCP connection; Nodemailer performs TLS. */
export function publicSmtpSocket(host: string, port: number): (options: unknown,
  callback: (error: Error | null, info?: { connection: Socket; secured: false }) => void) => void;
