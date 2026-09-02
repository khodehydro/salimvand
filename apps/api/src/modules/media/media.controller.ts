import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MediaService } from './media.service';

@Controller('media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class MediaController {
  constructor(private readonly media: MediaService) {}
  @Get() list() {
    return this.media.list();
  }
  /** Site-wide assets (store logo / favicon) referenced from store.profile. */
  @Post('settings/:kind/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadSiteAsset(
    @Param('kind') kind: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    return this.media.uploadSiteAsset(kind, file);
  }
  /** Remove a site asset file (logo / favicon) from uploads/site. */
  @Delete('site/:name')
  removeSiteAsset(@Param('name') name: string) {
    return this.media.removeSiteAsset(name);
  }
  @Post('products/:productId/upload') @UseInterceptors(FileInterceptor('file')) upload(
    @Param('productId') productId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string },
    @Body('alt') alt?: string,
  ) {
    return this.media.upload(productId, file, alt);
  }
  @Post('products/:productId/url') fromUrl(
    @Param('productId') productId: string,
    @Body() body: { url?: string; alt?: string },
  ) {
    return this.media.addFromUrl(productId, body.url ?? '', body.alt);
  }
  @Post('products/:productId/select') select(
    @Param('productId') productId: string,
    @Body() body: { imageId?: string; alt?: string },
  ) {
    return this.media.selectExisting(productId, body.imageId ?? '', body.alt);
  }
  @Patch('products/:productId/:imageId/primary') primary(
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.media.makePrimary(productId, imageId);
  }
  @Delete('products/:productId/:imageId') remove(
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.media.remove(productId, imageId);
  }
}
