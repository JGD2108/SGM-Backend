ALTER TABLE "Tramite"
ADD COLUMN "cuentaCobroAbono" DECIMAL(14,2),
ADD COLUMN "cuentaCobroFecha" TIMESTAMP(3),
ADD COLUMN "cuentaCobroServiceId" TEXT,
ADD COLUMN "cuentaCobroClienteNombre" TEXT,
ADD COLUMN "cuentaCobroClienteDoc" TEXT,
ADD COLUMN "cuentaCobroPlaca" TEXT,
ADD COLUMN "cuentaCobroCiudad" TEXT,
ADD COLUMN "cuentaCobroConcesionario" TEXT;
