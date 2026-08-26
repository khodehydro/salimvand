import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { UsersService } from './users.service';

type AuthRequest = Request & { user?: { id: string } };
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get() list() { return this.users.list(); }
  @Post() create(@Body() body: { name?: string; username?: string; password?: string; role?: string; mobile?: string }, @Req() request: AuthRequest) { return this.users.create(body, request.user?.id ?? '', request.ip); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: { name?: string; role?: string; mobile?: string; password?: string; isActive?: boolean }, @Req() request: AuthRequest) { return this.users.update(id, body, request.user?.id ?? '', request.ip); }
}
