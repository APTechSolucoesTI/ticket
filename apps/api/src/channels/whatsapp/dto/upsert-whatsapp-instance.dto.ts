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
  @ApiProperty() @IsString() @MinLength(1) token!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instanceName?: string;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
