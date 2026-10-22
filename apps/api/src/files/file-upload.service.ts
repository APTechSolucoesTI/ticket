import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@apticket/shared-types/database';
import { createHash } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { FileSecurityService } from './file-security.service';
import type { Env } from '../config/env.validation';

@Injectable()
export class FileUploadService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly security: FileSecurityService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async authorize(token: string, bucket: string, path: string) {
    // Explicit user JWT: this RPC runs with the user's RLS context even though
    // the private API holds the gateway key. The write uses service role only
    // after authorization, byte validation and the antivirus verdict.
    const userClient = createClient<Database, 'apticket'>(
      this.config.get('SUPABASE_URL', { infer: true }),
      this.config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }),
      {
        db: { schema: 'apticket' },
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: token } },
      },
    );
    const { data, error } = await userClient.rpc('can_upload_apticket_object', {
      _bucket: bucket,
      _path: path,
    });
    if (error || data !== true)
      throw new ForbiddenException('Sem permissão para enviar este arquivo.');
  }

  async upload(
    bucket: string,
    path: string,
    bytes: Buffer,
    filename: string,
    declaredMime: string,
  ) {
    if (
      typeof path !== 'string' ||
      path.length > 1024 ||
      !/^[a-f0-9-]{36}\/[^/]/i.test(path) ||
      /(^|\/)[.][.]?(\/|$)|[%?#\\]/.test(path) ||
      path.includes('//') ||
      [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    ) {
      throw new BadRequestException('Caminho de arquivo inválido.');
    }
    const mime = await this.security.validate(
      bucket,
      bytes,
      filename,
      declaredMime,
    );
    const { data: permit, error: permitError } = await this.supabase.client.rpc(
      'create_scanned_upload_permit',
      {
        _bucket: bucket,
        _path: path,
        _byte_length: bytes.byteLength,
        _sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    );
    if (permitError || !permit)
      throw new ServiceUnavailableException(
        'Não foi possível autorizar o armazenamento do arquivo verificado.',
      );
    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType: mime,
        upsert: false,
        metadata: { scan_id: permit },
      });
    if (error) {
      await this.supabase.client.rpc('revoke_scanned_upload_permit', {
        _id: permit,
      });
      throw new ServiceUnavailableException(
        'Não foi possível armazenar o arquivo verificado.',
      );
    }
    return data;
  }
}
