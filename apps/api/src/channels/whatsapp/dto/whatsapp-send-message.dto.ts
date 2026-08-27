import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
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

export class WhatsappSendContactDto {
  @ApiProperty() @IsUUID() ticketId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(30) phone!: string;
}

export class WhatsappSendLocationDto {
  @ApiProperty() @IsUUID() ticketId!: string;
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}

export class WhatsappSendStickerDto {
  @ApiProperty() @IsUUID() ticketId!: string;
  @ApiProperty() @IsUrl({ require_tld: false }) url!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) path!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) filename!: string;
}

export class WhatsappCallDto {
  @ApiProperty() @IsUUID() ticketId!: string;
  @ApiProperty({ required: false, minimum: 1, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  duration?: number;
}
