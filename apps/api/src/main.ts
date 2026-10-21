import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './channels/chat/redis-io.adapter';
import type { Env } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);
  app.use(
    (
      _request: { url?: string },
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=()',
      );
      response.setHeader(
        'Content-Security-Policy',
        _request.url?.startsWith('/docs')
          ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
          : "default-src 'none'; frame-ancestors 'none'",
      );
      if (config.get('CORS_ORIGIN', { infer: true }).startsWith('https://')) {
        response.setHeader('Strict-Transport-Security', 'max-age=31536000');
      }
      next();
    },
  );

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }),
    credentials: true,
  });

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('APTicket API')
        .setDescription(
          'Backend dos canais de e-mail, WhatsApp e chat do APTicket - tudo que precisa de ' +
            'segredos, processos contínuos ou WebSocket, fora do alcance do frontend.',
        )
        .setVersion('0.1.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'bearer',
        )
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  console.log(
    `[api] ouvindo em :${port} (docs: ${config.get('SWAGGER_ENABLED', { infer: true }) ? `/docs` : 'desabilitado'})`,
  );
}

void bootstrap();
