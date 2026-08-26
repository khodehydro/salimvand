import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('public/meta')
  meta() { return this.catalog.meta(); }

  @Get('public/products')
  products(@Query('q') q?: string, @Query('categoryId') categoryId?: string, @Query('vehicleModelId') vehicleModelId?: string, @Query('vehicleTrimId') vehicleTrimId?: string, @Query('brandId') brandId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('inStock') inStock?: string) {
    return this.catalog.listPublicProducts({ q, categoryId, vehicleModelId, vehicleTrimId, brandId, page: Number(page ?? 1), pageSize: Number(pageSize ?? 24), inStock: inStock === 'true' });
  }

  @Get('public/products/:slug')
  product(@Param('slug') slug: string) { return this.catalog.getPublicProduct(slug); }

  @Get('public/sitemap')
  sitemap() { return this.catalog.sitemap(); }

  @Get('public/filters')
  filters() { return this.catalog.listFilters(); }
}
