import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  Req,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { InternalServiceGuard as InternalFileUploadGuard } from '../auth/internal-service.guard';
import { FileUploadService } from './file-upload.service';
import { MAX_UPLOAD_BYTES } from './file-security.service';

export { InternalFileUploadGuard };

type UploadRequest = Request<
  Record<string, never>,
  unknown,
  { bucket?: unknown; path?: unknown }
>;

const multipart = FileInterceptor('file', {
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 2,
    fieldSize: 2048,
    parts: 3,
  },
});

@Injectable()
export class UploadCapacityGuard implements CanActivate {
  private active = 0;
  canActivate(context: ExecutionContext) {
    if (this.active >= 4)
      throw new ServiceUnavailableException(
        'Envio de arquivos ocupado. Tente novamente em instantes.',
      );
    const request = context.switchToHttp().getRequest<Request>();
    const response = context
      .switchToHttp()
      .getResponse<{ once(event: string, callback: () => void): void }>();
    this.active++;
    let released = false;
    const timer = setTimeout(() => request.destroy(), 45000);
    const release = () => {
      if (!released) {
        released = true;
        this.active--;
        clearTimeout(timer);
      }
    };
    response.once('finish', release);
    response.once('close', release);
    return true;
  }
}

@Controller('files')
export class FilesController {
  constructor(private readonly uploads: FileUploadService) {}

  @Post('upload')
  @UseGuards(UploadCapacityGuard)
  @UseInterceptors(multipart)
  async upload(
    @Req() request: UploadRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (
      !file ||
      typeof request.body?.bucket !== 'string' ||
      typeof request.body?.path !== 'string'
    )
      throw new BadRequestException('Envie um arquivo e seu destino.');
    await this.uploads.authorize(
      request.headers.authorization!,
      request.body.bucket,
      request.body.path,
    );
    return this.uploads.upload(
      request.body.bucket,
      request.body.path,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }

  // Trusted Node/Edge producers retain their domain checks. No browser token
  // or publishable key grants access to this path; the guard precedes Multer.
  @Post('internal-upload')
  @Public()
  @UseGuards(InternalFileUploadGuard, UploadCapacityGuard)
  @UseInterceptors(multipart)
  async internalUpload(
    @Req() request: UploadRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (
      !file ||
      typeof request.body?.bucket !== 'string' ||
      typeof request.body?.path !== 'string'
    )
      throw new BadRequestException('Envie um arquivo e seu destino.');
    return this.uploads.upload(
      request.body.bucket,
      request.body.path,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }
}
