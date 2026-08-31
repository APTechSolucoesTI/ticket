import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

export class UpsertWhatsappInstanceDto {
  @ApiProperty() @IsUrl({ require_tld: false }) baseUrl!: string;

  // Nunca é lido de volta em claro (fica criptografado) - omitir mantém o
  // token já salvo.
  @ApiPropertyOptional({ description: 'Omitir mantém o token já salvo' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  token?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() instanceName?: string;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
