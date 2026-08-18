import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './auth/public.decorator';

/** Usado pelo healthcheck do docker-compose — sem JWT, sem ficar no Swagger. */
@ApiExcludeController()
@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }
}
