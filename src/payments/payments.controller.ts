import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppError } from '../common/errors/app-error';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
// ✅ cumple el contrato del Front: /tramites/:id/payments
@Controller('tramites/:tramiteId/payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  async list(@Param('tramiteId') tramiteId: string) {
    return this.service.list(tramiteId);
  }

  @Post()
  async create(@Param('tramiteId') tramiteId: string, @Body() dto: CreatePaymentDto, @Req() req: any) {
    const userId = req?.user?.sub ?? req?.user?.id;
    if (!userId) throw new AppError('UNAUTHORIZED', 'No autenticado.', {}, 401);
    return this.service.create(tramiteId, dto, userId);
  }
}
