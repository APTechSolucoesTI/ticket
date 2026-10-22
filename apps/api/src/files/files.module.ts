import { Global, Module } from '@nestjs/common';
import { FileSecurityService } from './file-security.service';
import { FileUploadService } from './file-upload.service';
import {
  FilesController,
  InternalFileUploadGuard,
  UploadCapacityGuard,
} from './files.controller';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    FileSecurityService,
    FileUploadService,
    InternalFileUploadGuard,
    UploadCapacityGuard,
  ],
  exports: [FileUploadService, FileSecurityService],
})
export class FilesModule {}
