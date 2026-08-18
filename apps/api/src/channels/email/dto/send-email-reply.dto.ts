import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendEmailReplyDto {
  @ApiProperty() @IsUUID() ticketId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) content!: string;
}
