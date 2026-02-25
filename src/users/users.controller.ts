import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller(['users', 'usuarios'])
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  async list(@Query('q') q?: string) {
    return this.service.list(q);
  }
}
