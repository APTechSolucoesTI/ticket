import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

// Conta de e-mail é 1:1 com o tenant (colunas email_imap_*/email_smtp_* em
// apticket.tenants) - não existe hoje uma tabela separada de "múltiplas
// contas por tenant" no domínio real do APTicket, então o CRUD do contrato
// original (`/channels/email/accounts`) opera sobre essa linha única,
// endereçada pelo próprio tenantId do usuário autenticado.
export class UpsertEmailAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() inboxAddress?: string;

  @ApiProperty() @IsString() @MinLength(1) imapHost!: string;
  @ApiProperty({ default: 993 }) @IsInt() @Min(1) @Max(65535) imapPort!: number;
  @ApiProperty() @IsString() @MinLength(1) imapUser!: string;

  // Texto puro só chega até aqui - o service criptografa (AES-256-GCM) antes
  // de gravar. Nunca é lido de volta em claro pela API de listagem, então a
  // tela não tem como reexibir a senha salva - omitir mantém a atual.
  @ApiPropertyOptional({ description: 'Omitir mantém a senha já salva' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  imapPassword?: string;

  @ApiProperty({ default: true }) @IsBoolean() imapSecure!: boolean;

  @ApiProperty() @IsString() @MinLength(1) smtpHost!: string;
  @ApiProperty({ default: 587 }) @IsInt() @Min(1) @Max(65535) smtpPort!: number;
  @ApiProperty({ default: false }) @IsBoolean() smtpSecure!: boolean;

  @ApiProperty({ minimum: 1, maximum: 60, default: 5 })
  @IsInt()
  @Min(1)
  @Max(60)
  pollIntervalMinutes!: number;

  @ApiPropertyOptional({ default: true }) @IsBoolean() enabled!: boolean;
}
