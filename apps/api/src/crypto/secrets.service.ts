import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.validation';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // padrão recomendado pro GCM

/**
 * Criptografa senha IMAP/SMTP e token da uazapi antes de gravar no Postgres
 * - só a API tem `SECRETS_ENCRYPTION_KEY`, nunca chega no frontend nem fica
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
    const parts = stored.split(':');
    const [ivHex, authTagHex, ciphertextHex] = parts;
    if (
      parts.length !== 3 ||
      !ivHex ||
      !authTagHex ||
      !ciphertextHex ||
      !/^[0-9a-f]+$/i.test(ivHex) ||
      !/^[0-9a-f]+$/i.test(authTagHex) ||
      !/^[0-9a-f]+$/i.test(ciphertextHex)
    ) {
      // Valor pré-existente, salvo em texto puro antes dessa criptografia
      // entrar (dado de antes da migração) - trata como legado e devolve
      // como está. Assim que o tenant salvar de novo pela tela nova, vira
      // formato criptografado. Sem isso, decrypt() quebra dado antigo.
      return stored;
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
