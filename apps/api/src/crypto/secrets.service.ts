import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.validation';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // padrão recomendado pro GCM

/**
 * Criptografa senha IMAP/SMTP e token da uazapi antes de gravar no Postgres
 * — só a API tem `SECRETS_ENCRYPTION_KEY`, nunca chega no frontend nem fica
 * em texto puro no banco. Formato armazenado: "<iv>:<authTag>:<ciphertext>"
 * em hex, tudo numa string só (cabe direto numa coluna text existente).
 */
@Injectable()
export class SecretsService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const hexKey: string = config.get('SECRETS_ENCRYPTION_KEY', {
      infer: true,
    });
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('hex'),
      authTag.toString('hex'),
      ciphertext.toString('hex'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error('Formato de segredo criptografado inválido');
    }
    const decipher = createDecipheriv(
      ALGO,
      this.key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
