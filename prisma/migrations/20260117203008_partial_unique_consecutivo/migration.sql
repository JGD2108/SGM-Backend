CREATE UNIQUE INDEX IF NOT EXISTS "uniq_consec_reservado"
ON "ConsecutivoReserva" ("concesionarioId", "year", "consecutivo")
WHERE "status" = 'RESERVADO';
