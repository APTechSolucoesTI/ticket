import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EmailReplyAttachmentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) path!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) type!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(10 * 1024 * 1024) size!: number;
}

export class SendEmailReplyDto {
  @ApiProperty() @IsUUID() ticketId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) content!: string;
  @ApiProperty({ type: [EmailReplyAttachmentDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmailReplyAttachmentDto)
  attachments?: EmailReplyAttachmentDto[];
}
