import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { LinkShipmentDto } from './dto/link-shipment.dto';

@ApiTags('Shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly service: ShipmentsService) {}

  // ✅ GET /shipments?tramiteId=...
  @Get()
  async list(@Query('tramiteId') tramiteId?: string) {
    return this.service.list(tramiteId);
  }

  @Post()
  async create(@Body() dto: CreateShipmentDto) {
    return this.service.create(dto);
  }

  // ✅ POST /shipments/:id/tramites  { tramiteId, action: ADD|REMOVE }
  @Post(':id/tramites')
  async link(@Param('id') id: string, @Body() dto: LinkShipmentDto) {
    return this.service.link(id, dto);
  }
}
