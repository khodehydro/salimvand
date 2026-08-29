import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CustomersService } from './customers.service';
import { CustomerDto, CustomerPaymentDto, UpdateCustomerDto } from './customers.dto';

type AuthRequest = Request & { user?: { id: string } };
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'accountant')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get() list(@Query('search') search?: string) {
    return this.customers.list(search);
  }
  @Get('debtors') debtors() {
    return this.customers.debtors();
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.customers.get(id);
  }
  @Get(':id/vehicles') vehicles(@Param('id') id: string) {
    return this.customers.vehicles(id);
  }
  @Roles('seller')
  @Post(':id/vehicles')
  addVehicle(
    @Param('id') id: string,
    @Body()
    body: { trimId?: string; plate?: string; chassis?: string; year?: number; notes?: string },
    @Req() request: AuthRequest,
  ) {
    return this.customers.addVehicle(id, body, request.user?.id);
  }
  @Roles('seller')
  @Delete(':id/vehicles/:vehicleId')
  removeVehicle(
    @Param('id') id: string,
    @Param('vehicleId') vehicleId: string,
    @Req() request: AuthRequest,
  ) {
    return this.customers.removeVehicle(id, vehicleId, request.user?.id);
  }
  @Roles('seller')
  @Post()
  create(@Body() body: CustomerDto, @Req() request: AuthRequest) {
    return this.customers.create(body, request.user?.id, request.ip);
  }
  @Roles('seller')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateCustomerDto, @Req() request: AuthRequest) {
    return this.customers.update(id, body, request.user?.id, request.ip);
  }
  @Post(':id/payments') payment(
    @Param('id') id: string,
    @Body() body: CustomerPaymentDto,
    @Req() request: AuthRequest,
  ) {
    return this.customers.payment(id, body, request.user?.id ?? '', request.ip);
  }
}
