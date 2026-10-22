import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import type { Env } from '../config/env.validation';

export const UPLOAD_BUCKETS = [
  'ticket-attachments',
  'kb-attachments',
  'client-documents',
  'funcionario-documentos',
  'funcionario-beneficios',
  'supplier-payment-receipts',
  'supplier-payable-attachments',
  'apticket-profile-avatars',
] as const;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Injectable()
export class FileSecurityService {
  private active = 0;
  constructor(private readonly config: ConfigService<Env, true>) {}

  async validate(
    bucket: string,
    bytes: Buffer,
    filename: string,
    declaredMime = '',
  ): Promise<string> {
    if (!(UPLOAD_BUCKETS as readonly string[]).includes(bucket))
      throw new BadRequestException('Destino de arquivo inválido.');
    const max =
      bucket === 'ticket-attachments'
        ? MAX_UPLOAD_BYTES
        : bucket === 'apticket-profile-avatars'
          ? 2 * 1024 * 1024
          : 10 * 1024 * 1024;
    if (!bytes.length || bytes.length > max)
      throw new BadRequestException(
        'O arquivo excede o limite permitido para este destino.',
      );
    if (this.active >= 4)
      throw new ServiceUnavailableException(
        'Verificação de arquivos ocupada. Tente novamente em instantes.',
      );
    this.active++;
    try {
      const mime = await this.detect(bytes, filename, declaredMime);
      await this.scan(bytes);
      return mime;
    } finally {
      this.active--;
    }
  }

  private detect(
    bytes: Buffer,
    filename: string,
    mime: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(join(__dirname, 'file-type.worker.mjs'), {
        workerData: { bytes, filename, mime },
        resourceLimits: {
          maxOldGenerationSizeMb: 64,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      });
      let settled = false;
      const finish = (detected?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (detected) resolve(detected);
        else
          reject(
            new BadRequestException(
              'Conteúdo ou tipo de arquivo não permitido.',
            ),
          );
      };
      const timer = setTimeout(() => finish(), 3000);
      worker.once('message', (result: { mime?: string }) =>
        finish(result.mime),
      );
      worker.once('error', () => finish());
      worker.once('exit', () => finish());
    });
  }

  /** ClamD INSTREAM over a private, operator-configured socket. Never accepts a tenant host. */
  private async scan(bytes: Buffer): Promise<void> {
    const socket = createConnection({
      host: this.config.get('CLAMAV_HOST', { infer: true }),
      port: this.config.get('CLAMAV_PORT', { infer: true }),
    });
    let timer: NodeJS.Timeout;
    const result = new Promise<string>((resolve) => {
      let response = '';
      let done = false;
      const finish = (value: string) => {
        if (!done) {
          done = true;
          resolve(value);
        }
      };
      socket.on('data', (chunk: Buffer) => {
        response += chunk.toString('utf8');
        if (response.length > 4096) {
          finish('ERROR');
          socket.destroy();
        } else if (response.includes('\0') || response.includes('\n'))
          finish(response.replace(/[\0\r\n]+$/, ''));
      });
      socket.once('error', () => finish('ERROR'));
      socket.once('close', () => finish('ERROR'));
      timer = setTimeout(() => {
        finish('ERROR');
        socket.destroy(new Error('scanner_timeout'));
      }, 30000);
    });
    try {
      await once(socket, 'connect');
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        const chunk = bytes.subarray(offset, offset + 65536);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        if (!socket.write(chunk)) await once(socket, 'drain');
      }
      socket.write(Buffer.alloc(4));
      const verdict = await result;
      if (/ FOUND$/.test(verdict))
        throw new BadRequestException('Arquivo recusado pelo antivírus.');
      if (verdict !== 'stream: OK')
        throw new ServiceUnavailableException(
          'Verificação de segurança indisponível. Tente enviar o arquivo novamente mais tarde.',
        );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        'Verificação de segurança indisponível. Tente enviar o arquivo novamente mais tarde.',
      );
    } finally {
      clearTimeout(timer!);
      socket.destroy();
    }
  }
}
