-- CreateEnum
CREATE TYPE "ServicioTipo" AS ENUM ('MATRICULA', 'TRASPASO', 'PRENDA_INSCRIPCION', 'PRENDA_LEVANTAMIENTO', 'PRENDA_MODIFICACION', 'DUPLICADO_LICENCIA_TRANSITO', 'DUPLICADO_PLACAS', 'CAMBIO_COLOR', 'CAMBIO_MOTOR', 'CAMBIO_SERVICIO', 'CANCELACION_MATRICULA', 'TRASLADO_CUENTA', 'OTRO');

-- CreateEnum
CREATE TYPE "ServicioEstado" AS ENUM ('RECIBIDO', 'EN_REVISION', 'PENDIENTE_DOCUMENTOS', 'PENDIENTE_PAGOS', 'RADICADO', 'EN_TRAMITE', 'LISTO_PARA_ENTREGA', 'ENTREGADO', 'CANCELADO');

-- AlterTable
ALTER TABLE "Tramite" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "estadoServicio" "ServicioEstado",
ADD COLUMN     "gestorNombre" TEXT,
ADD COLUMN     "gestorTelefono" TEXT,
ADD COLUMN     "radicadoAt" TIMESTAMP(3),
ADD COLUMN     "serviceData" JSONB,
ADD COLUMN     "tipoServicio" "ServicioTipo" NOT NULL DEFAULT 'MATRICULA';

-- CreateTable
CREATE TABLE "ServicioEstadoHist" (
    "id" TEXT NOT NULL,
    "tramiteId" TEXT NOT NULL,
    "fromEstadoServicio" "ServicioEstado",
    "toEstadoServicio" "ServicioEstado" NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "actionType" "ActionType" NOT NULL DEFAULT 'NORMAL',

    CONSTRAINT "ServicioEstadoHist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicioPago" (
    "id" TEXT NOT NULL,
    "tramiteId" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServicioPago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicioEstadoHist_tramiteId_changedAt_idx" ON "ServicioEstadoHist"("tramiteId", "changedAt");

-- CreateIndex
CREATE INDEX "ServicioPago_tramiteId_idx" ON "ServicioPago"("tramiteId");

-- CreateIndex
CREATE INDEX "Tramite_tipoServicio_idx" ON "Tramite"("tipoServicio");

-- CreateIndex
CREATE INDEX "Tramite_estadoServicio_idx" ON "Tramite"("estadoServicio");

-- AddForeignKey
ALTER TABLE "Tramite" ADD CONSTRAINT "Tramite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioEstadoHist" ADD CONSTRAINT "ServicioEstadoHist_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "Tramite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioEstadoHist" ADD CONSTRAINT "ServicioEstadoHist_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioPago" ADD CONSTRAINT "ServicioPago_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "Tramite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioPago" ADD CONSTRAINT "ServicioPago_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
