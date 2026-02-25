import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { ClientesService } from './clientes.service';

@ApiTags('Clientes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get()
  async list(@Query('q') q?: string) {
    return this.clientesService.listForUsuariosTab(q);
  }
}
