import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.validation';
import { SupabaseModule } from './supabase/supabase.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { QueueModule } from './queue/queue.module';
import { EmailModule } from './channels/email/email.module';
import { WhatsappModule } from './channels/whatsapp/whatsapp.module';
import { ChatModule } from './channels/chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    SupabaseModule,
    CryptoModule,
    QueueModule,
    AuthModule,
    EmailModule,
    WhatsappModule,
    ChatModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
