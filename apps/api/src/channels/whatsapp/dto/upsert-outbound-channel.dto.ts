import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpsertOutboundChannelDto {
  @ApiProperty({ example: 'Financeiro' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  baseUrl!: string;

  @ApiPropertyOptional({
    description: 'Obrigatório somente no primeiro cadastro',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  token?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  instanceName?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
