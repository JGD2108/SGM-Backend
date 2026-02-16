import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { ShipmentsService } from './shipments.service';

@ApiTags('Shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tramites/:tramiteId/shipments')
export class TramiteShipmentsController {
  constructor(private readonly service: ShipmentsService) {}

  @Get()
  async list(@Param('tramiteId') tramiteId: string) {
    return this.service.list(tramiteId);
  }
}
