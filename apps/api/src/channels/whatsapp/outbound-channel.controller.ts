import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import type { AuthContext } from '../../auth/supabase-auth.guard';
import { UpsertOutboundChannelDto } from './dto/upsert-outbound-channel.dto';
import { OutboundChannelService } from './outbound-channel.service';

@ApiTags('whatsapp-outbound')
@ApiBearerAuth()
@Controller('channels/whatsapp/outbound')
export class OutboundChannelController {
  constructor(private readonly channels: OutboundChannelService) {}

  @Get()
  @RequirePermission('canais', 'view')
  list(@CurrentUser() auth: AuthContext) {
    return this.channels.list(auth.tenantId);
  }

  @Post()
  @RequirePermission('canais', 'edit')
  @ApiOperation({ summary: 'Cria um canal WhatsApp exclusivamente de saída' })
  create(
    @CurrentUser() auth: AuthContext,
    @Body() body: UpsertOutboundChannelDto,
  ) {
    return this.channels.upsert(auth.tenantId, null, body);
  }

  @Patch(':id')
  @RequirePermission('canais', 'edit')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpsertOutboundChannelDto,
  ) {
    return this.channels.upsert(auth.tenantId, id, body);
  }

  @Get(':id/status')
  @RequirePermission('canais', 'view')
  status(
    @CurrentUser() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.channels.status(auth.tenantId, id);
  }

  @Get(':id/qrcode')
  @RequirePermission('canais', 'edit')
  qrcode(
    @CurrentUser() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.channels.qrcode(auth.tenantId, id);
  }

  @Post(':id/disconnect')
  @RequirePermission('canais', 'edit')
  disconnect(
    @CurrentUser() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.channels.disconnect(auth.tenantId, id);
  }
}
