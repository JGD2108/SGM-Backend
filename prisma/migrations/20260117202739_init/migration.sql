-- CreateEnum
CREATE TYPE "TramiteEstado" AS ENUM ('FACTURA_RECIBIDA', 'PREASIGNACION_SOLICITADA', 'PLACA_ASIGNADA', 'PLACA_ENVIADA_CONCESIONARIO', 'DOCS_FISICOS_PENDIENTES', 'DOCS_FISICOS_COMPLETOS', 'ENVIADO_GESTOR_TRANSITO', 'TIMBRE_PAGADO', 'DERECHOS_PAGADOS', 'FINALIZADO_ENTREGADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('NORMAL', 'REABRIR', 'CANCELAR', 'FINALIZAR');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('PENDIENTE', 'RECIBIDO');

-- CreateEnum
CREATE TYPE "ConsecStatus" AS ENUM ('RESERVADO', 'LIBERADO');

-- CreateEnum
CREATE TYPE "PaymentTipo" AS ENUM ('TIMBRE', 'DERECHOS', 'OTRO');

-- CreateEnum
CREATE TYPE "MedioPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CONSIGNACION', 'OTRO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concesionario" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Concesionario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ciudad" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Ciudad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "doc" TEXT NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tramite" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "concesionarioId" TEXT NOT NULL,
    "concesionarioCodeSnapshot" TEXT NOT NULL,
    "concesionarioAnteriorId" TEXT,
    "consecutivo" INTEGER NOT NULL,
    "consecutivoAnterior" INTEGER,
    "ciudadId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "placa" TEXT,
    "estadoActual" "TramiteEstado" NOT NULL DEFAULT 'FACTURA_RECIBIDA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "Tramite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TramiteEstadoHist" (
    "id" TEXT NOT NULL,
    "tramiteId" TEXT NOT NULL,
    "fromEstado" "TramiteEstado",
    "toEstado" "TramiteEstado" NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "actionType" "ActionType" NOT NULL DEFAULT 'NORMAL',

    CONSTRAINT "TramiteEstadoHist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TramiteDocument" (
    "id" TEXT NOT NULL,
    "tramiteId" TEXT NOT NULL,
    "documentTypeId" TEXT,
    "docKey" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'PENDIENTE',
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "TramiteDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TramiteFile" (
    "id" TEXT NOT NULL,
    "tramiteId" TEXT NOT NULL,
    "documentTypeId" TEXT,
    "docKey" TEXT NOT NULL,
    "filenameOriginal" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TramiteFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tramiteId" TEXT NOT NULL,
    "tipo" "PaymentTipo" NOT NULL,
    "valor" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "medioPago" "MedioPago" NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "numeroGuia" TEXT NOT NULL,
    "transportadora" TEXT NOT NULL,
    "costo" INTEGER NOT NULL,
    "fechaEnvio" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentTramite" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "tramiteId" TEXT NOT NULL,

    CONSTRAINT "ShipmentTramite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsecutivoReserva" (
    "id" TEXT NOT NULL,
    "concesionarioId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "consecutivo" INTEGER NOT NULL,
    "tramiteId" TEXT,
    "status" "ConsecStatus" NOT NULL DEFAULT 'RESERVADO',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "ConsecutivoReserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "fromEstado" "TramiteEstado" NOT NULL,
    "toEstado" "TramiteEstado" NOT NULL,
    "thresholdDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Concesionario_code_key" ON "Concesionario"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Ciudad_name_key" ON "Ciudad"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_key_key" ON "DocumentType"("key");

-- CreateIndex
CREATE INDEX "Cliente_doc_idx" ON "Cliente"("doc");

-- CreateIndex
CREATE INDEX "Tramite_year_idx" ON "Tramite"("year");

-- CreateIndex
CREATE INDEX "Tramite_concesionarioId_year_idx" ON "Tramite"("concesionarioId", "year");

-- CreateIndex
CREATE INDEX "Tramite_estadoActual_idx" ON "Tramite"("estadoActual");

-- CreateIndex
CREATE INDEX "TramiteEstadoHist_tramiteId_changedAt_idx" ON "TramiteEstadoHist"("tramiteId", "changedAt");

-- CreateIndex
CREATE INDEX "TramiteDocument_tramiteId_idx" ON "TramiteDocument"("tramiteId");

-- CreateIndex
CREATE UNIQUE INDEX "TramiteDocument_tramiteId_docKey_key" ON "TramiteDocument"("tramiteId", "docKey");

-- CreateIndex
CREATE INDEX "TramiteFile_tramiteId_docKey_idx" ON "TramiteFile"("tramiteId", "docKey");

-- CreateIndex
CREATE UNIQUE INDEX "TramiteFile_tramiteId_docKey_version_key" ON "TramiteFile"("tramiteId", "docKey", "version");

-- CreateIndex
CREATE INDEX "Payment_tramiteId_tipo_idx" ON "Payment"("tramiteId", "tipo");

-- CreateIndex
CREATE INDEX "Shipment_numeroGuia_idx" ON "Shipment"("numeroGuia");

-- CreateIndex
CREATE INDEX "ShipmentTramite_tramiteId_idx" ON "ShipmentTramite"("tramiteId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentTramite_shipmentId_tramiteId_key" ON "ShipmentTramite"("shipmentId", "tramiteId");

-- CreateIndex
CREATE INDEX "ConsecutivoReserva_concesionarioId_year_status_idx" ON "ConsecutivoReserva"("concesionarioId", "year", "status");

-- CreateIndex
CREATE INDEX "ConsecutivoReserva_tramiteId_idx" ON "ConsecutivoReserva"("tramiteId");

-- CreateIndex
CREATE INDEX "AlertRule_isActive_idx" ON "AlertRule"("isActive");

-- AddForeignKey
ALTER TABLE "Tramite" ADD CONSTRAINT "Tramite_concesionarioId_fkey" FOREIGN KEY ("concesionarioId") REFERENCES "Concesionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tramite" ADD CONSTRAINT "Tramite_concesionarioAnteriorId_fkey" FOREIGN KEY ("concesionarioAnteriorId") REFERENCES "Concesionario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tramite" ADD CONSTRAINT "Tramite_ciudadId_fkey" FOREIGN KEY ("ciudadId") REFERENCES "Ciudad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tramite" ADD CONSTRAINT "Tramite_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramiteEstadoHist" ADD CONSTRAINT "TramiteEstadoHist_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "Tramite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramiteEstadoHist" ADD CONSTRAINT "TramiteEstadoHist_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramiteDocument" ADD CONSTRAINT "TramiteDocument_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "Tramite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramiteDocument" ADD CONSTRAINT "TramiteDocument_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramiteFile" ADD CONSTRAINT "TramiteFile_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "Tramite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramiteFile" ADD CONSTRAINT "TramiteFile_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TramiteFile" ADD CONSTRAINT "TramiteFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "Tramite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTramite" ADD CONSTRAINT "ShipmentTramite_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTramite" ADD CONSTRAINT "ShipmentTramite_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "Tramite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsecutivoReserva" ADD CONSTRAINT "ConsecutivoReserva_concesionarioId_fkey" FOREIGN KEY ("concesionarioId") REFERENCES "Concesionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsecutivoReserva" ADD CONSTRAINT "ConsecutivoReserva_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "Tramite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
