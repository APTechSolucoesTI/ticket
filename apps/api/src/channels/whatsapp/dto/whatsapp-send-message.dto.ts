import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class WhatsappSendMessageDto {
  @ApiProperty() @IsUUID() ticketId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) content!: string;
}

export class WhatsappSendMediaDto {
  @ApiProperty() @IsUUID() ticketId!: string;
  @ApiProperty() @IsUrl({ require_tld: false }) url!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) path!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) filename!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) mimetype!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10 * 1024 * 1024) size!: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;
}
