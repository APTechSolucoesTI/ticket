import { ConfigService } from '@nestjs/config';
import { SecretsService } from './secrets.service';
import type { Env } from '../config/env.validation';

function fakeConfig(key: string): ConfigService<Env, true> {
  return { get: () => key } as unknown as ConfigService<Env, true>;
}

describe('SecretsService', () => {
  const key = 'a'.repeat(64); // 32 bytes em hex
  const secrets = new SecretsService(fakeConfig(key));

  it('descriptografa exatamente o que criptografou', () => {
    const plaintext = 'senha-super-secreta-do-imap';
    const stored = secrets.encrypt(plaintext);
    expect(stored).not.toContain(plaintext);
    expect(secrets.decrypt(stored)).toBe(plaintext);
  });

  it('gera um ciphertext diferente a cada chamada (IV aleatório)', () => {
    const a = secrets.encrypt('mesmo texto');
    const b = secrets.encrypt('mesmo texto');
    expect(a).not.toBe(b);
  });

  it('trata valor legado (texto puro, salvo antes da criptografia existir) como está', () => {
    // Tenant com senha IMAP salva antes dessa feature - não é
    // "<iv>:<authTag>:<ciphertext>" em hex, então decrypt() não tenta
    // decifrar, só devolve como veio (ver comentário em decrypt()).
    const legacyPlaintext = 'senha-antiga-em-texto-puro';
    expect(secrets.decrypt(legacyPlaintext)).toBe(legacyPlaintext);

    const malformed = 'isso-nao-e-iv:authtag:ciphertext-valido';
    expect(secrets.decrypt(malformed)).toBe(malformed);
  });
});
