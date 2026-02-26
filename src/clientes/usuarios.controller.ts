import { Body, Controller, Delete, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { ClientesService } from './clientes.service';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

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

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() dto: UpdateUsuarioDto) {
    return this.clientesService.updateUsuarioById(id, dto);
  }

  @Put(':id')
  async put(@Param('id') id: string, @Body() dto: UpdateUsuarioDto) {
    return this.clientesService.updateUsuarioById(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.clientesService.deleteUsuarioById(id);
  }

}
