import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { UsuariosController } from './usuarios.controller';

@Module({
  controllers: [ClientesController, UsuariosController],
  providers: [ClientesService],
})
export class ClientesModule {}
