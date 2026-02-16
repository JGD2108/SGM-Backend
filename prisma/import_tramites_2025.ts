import "dotenv/config";
import path from "node:path";
import crypto from "node:crypto";
import * as XLSX from "xlsx";
import {
  PrismaClient,
  Prisma,
  TramiteEstado,
  ChecklistStatus,
  PaymentTipo,
  MedioPago,
  ConsecStatus,
} from "@prisma/client";

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL no está definido en .env");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });


function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(s: string) {
  return stripAccents(String(s ?? ""))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

// ✅ Opción 2: aliases por "contiene" (esto arregla ALEMANA..., MASSY..., CLIENTES VARIOS, etc)
const CONCESIONARIO_CONTAINS_ALIASES: Array<{ contains: string; code: string }> = [
  { contains: "AUTOTROPICAL", code: "AUTOTROPICAL" },
  { contains: "MOTOCOSTA", code: "MOTOCOSTA" },
  { contains: "JUANAUTOS", code: "JUANAUTOS" },

  // Excel puede traer "ALEMANA AUTOMOTRIZ – Mercedez Benz" u otras variaciones
  { contains: "ALEMANA_AUTOMOTRIZ", code: "ALEMANA_AUTOMOTRIZ" },

  // Excel trae "MASSY MOTORS"
  { contains: "MASSY_MOTORS", code: "MASSY_MOTORS" },

  // Excel trae "CLIENTES VARIOS"
  { contains: "CLIENTES_VARIOS", code: "CLIENTES_VARIOS" },

  { contains: "DAVIVIENDA", code: "DAVIVIENDA" },
  { contains: "AUTOSTAR", code: "AUTOSTAR" },
];

function detectConcesionarioCodeFromText(text: string): string | null {
  const k = normalizeKey(text);
  for (const a of CONCESIONARIO_CONTAINS_ALIASES) {
    if (k.includes(a.contains)) return a.code;
  }
  return null;
}

function isDateLike(x: any): x is Date {
  return x instanceof Date && !Number.isNaN(x.getTime());
}

function looksLikePlaca(x: any): boolean {
  if (!x) return false;
  const s = String(x).trim().toUpperCase();
  // placas típicas: ABC123, ABC12D, etc (simple)
  return /^[A-Z]{3}\d{2,3}[A-Z]?$/.test(s);
}

function normalizePlaca(x: any): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim().toUpperCase();
  if (!s) return null;
  return s;
}

function parseMoneyToNumber(x: any): number | null {
  if (x === undefined) return null;
  if (x === null) return 0;

  if (typeof x === "number") return Number.isFinite(x) ? x : NaN;

  const s = String(x).replace(/,/g, "").trim();
  if (!s) return 0;

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function moneyToInt(x: any): number {
  const n = parseMoneyToNumber(x);
  if (n === null) return 0;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function moneyToDecimal(x: any): Prisma.Decimal | null {
  const n = parseMoneyToNumber(x);
  if (n === null) return null;
  if (!Number.isFinite(n)) return null;
  // ✅ Decimal(14,2)
  return new Prisma.Decimal(n.toFixed(2));
}

// Puedes mejorar este mapeo si tu BD tiene nombres exactos.
// Para MVP: si llega abreviatura, la convertimos; si no, Title Case.
const CITY_ABBR: Record<string, string> = {
  BQ: "Barranquilla",
  BAQ: "Barranquilla",
  BARRANQUILLA: "Barranquilla",

  CGENA: "Cartagena",
  CARTAGENA: "Cartagena",

  SANTAMARTA: "Santa Marta",
  "SANTA_MARTA": "Santa Marta",
  "STA_MARTA": "Santa Marta",
  SM: "Santa Marta",

  VD: "Valledupar",
  VDUPAR: "Valledupar",
  VALLEDUPAR: "Valledupar",

  RIOHACHA: "Riohacha",
  RH: "Riohacha",

  MONTERIA: "Monteria",
  MT: "Monteria",

  SINCELEJO: "Sincelejo",

  SOLEDAD: "Soledad",
  MALAMBO: "Malambo",
  GALAPA: "Galapa",
  "PUERTO_COLOMBIA": "Puerto Colombia",
};

function titleCaseCity(s: string) {
  return s
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeCity(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  const k = normalizeKey(String(raw));
  if (!k) return null;

  if (CITY_ABBR[k]) return CITY_ABBR[k];

  // fallback: convierte underscores a espacios y Title Case
  const pretty = k.replace(/_/g, " ");
  return titleCaseCity(pretty);
}

// ✅ Heurística que ya usabas: si “ciudad” parece placa y “placa” parece ciudad → swap
function maybeSwapCityAndPlaca(ciudadRaw: any, placaRaw: any) {
  const ciudadLooksPlaca = looksLikePlaca(ciudadRaw);
  const placaLooksCity = !!normalizeCity(placaRaw);

  if (ciudadLooksPlaca && placaLooksCity) {
    return { ciudadRaw: placaRaw, placaRaw: ciudadRaw, swapped: true };
  }
  return { ciudadRaw, placaRaw, swapped: false };
}

function stableClientDocFromName(name: string) {
  const k = normalizeKey(name);
  const h = crypto.createHash("sha1").update(k).digest("hex").slice(0, 12);
  return `IMP-${h}`;
}

// ✅ igual al backend: reserva menor libre
function findSmallestMissing(sortedUsed: number[]): number {
  let expected = 1;
  for (const n of sortedUsed) {
    if (n === expected) expected++;
    else if (n > expected) break;
  }
  return expected;
}

async function reserveNextConsecutivo(tx: Prisma.TransactionClient, concesionarioId: string, year: number) {
  const used = await tx.consecutivoReserva.findMany({
    where: { concesionarioId, year, status: "RESERVADO" },
    select: { consecutivo: true },
    orderBy: { consecutivo: "asc" },
  });

  const next = findSmallestMissing(used.map((u) => u.consecutivo));

  const reserva = await tx.consecutivoReserva.create({
    data: {
      concesionarioId,
      year,
      consecutivo: next,
      status: "RESERVADO",
      reservedAt: new Date(),
    },
  });

  return reserva;
}

async function main() {
  const excelPath =
    process.argv[2] ?? path.resolve(process.cwd(), "TRAMITES 2025.xlsx");
  const userEmail = process.argv[3] ?? "rtramite@hotmail.com";

  console.log("=== IMPORT EXCEL 2025 (Opción 2: normalización + aliases) ===");
  console.log("Archivo:", excelPath);
  console.log("Usuario:", userEmail);

  const user = await prisma.user.findUnique({ where: { email: userEmail } });
  if (!user) {
    throw new Error(`No existe el usuario ${userEmail} en BD. Crea/seed primero.`);
  }

  // Cache concesionarios por code
  const conces = await prisma.concesionario.findMany();
  const concesByCode = new Map(conces.map((c) => [c.code, c]));

  const wb = XLSX.readFile(excelPath, { cellDates: true });
  const sheet = wb.Sheets["TRAMITES POR MES"];
  if (!sheet) throw new Error(`No existe hoja "TRAMITES POR MES". Hojas: ${wb.SheetNames.join(", ")}`);

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  let currentConcesionarioCode: string | null = null;

  let detectedDateRows = 0;
  let created = 0;
  let skipped = 0;
  let swappedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const joined = r
      .map((x) => (x === null || x === undefined ? "" : String(x)))
      .join(" ")
      .trim();

    // 1) detectar secciones
    if (/INFORME\s+DE\s+TRAMITES\s+REALIZADOS/i.test(joined)) {
      const code = detectConcesionarioCodeFromText(joined);
      if (!code) {
        console.warn(`[WARN] No pude detectar concesionario en título: "${joined}"`);
        currentConcesionarioCode = null;
      } else {
        currentConcesionarioCode = code;
      }
      continue;
    }

    // 2) filas con fecha (col 1 suele ser FECHA)
    const fecha = r?.[1];
    if (!isDateLike(fecha)) continue;

    detectedDateRows++;

    if (!currentConcesionarioCode) {
      console.warn(`[WARN] Fila ${i + 1}: tiene fecha pero no hay concesionario activo. Saltada.`);
      skipped++;
      continue;
    }

    const concesionario = concesByCode.get(currentConcesionarioCode);
    if (!concesionario) {
      console.warn(
        `[WARN] Concesionario code "${currentConcesionarioCode}" no existe en BD. Fila ${i + 1} saltada.`,
      );
      skipped++;
      continue;
    }

    // columnas típicas según tu Excel (por lo que vimos):
    // [?, FECHA, #, CIUDAD, PLACA, CLIENTE, ESTADO, HONORARIOS, VALOR]
    let ciudadRaw = r?.[3];
    let placaRaw = r?.[4];
    const clienteNombreRaw = r?.[5];
    const estadoRaw = r?.[6];
    const honorariosRaw = r?.[7];
    const valorRaw = r?.[8];

    const swap = maybeSwapCityAndPlaca(ciudadRaw, placaRaw);
    ciudadRaw = swap.ciudadRaw;
    placaRaw = swap.placaRaw;
    if (swap.swapped) swappedCount++;

    const ciudadName = normalizeCity(ciudadRaw);
    if (!ciudadName) {
      console.warn(`[WARN] Fila ${i + 1}: ciudad inválida ("${ciudadRaw}"). Saltada.`);
      skipped++;
      continue;
    }

    const placa = normalizePlaca(placaRaw);

    const clienteNombre = String(clienteNombreRaw ?? "").trim();
    if (!clienteNombre) {
      console.warn(`[WARN] Fila ${i + 1}: cliente vacío. Saltada.`);
      skipped++;
      continue;
    }

    // Estado: este Excel parece venir "ENTREGADO" (o typo "ENTREGAOD")
    const estadoTxt = normalizeKey(String(estadoRaw ?? ""));
    let estadoActual: TramiteEstado = TramiteEstado.FINALIZADO_ENTREGADO;
    if (estadoTxt.includes("CANCEL")) estadoActual = TramiteEstado.CANCELADO;

    const honorariosDec = moneyToDecimal(honorariosRaw); // Decimal?
    const valorInt = moneyToInt(valorRaw);

    const year = fecha.getFullYear();

    // ✅ clave de dedupe: si hay placa, usamos (year + concesionario + placa)
    // así rerun no duplica y además ahora sí importará Massy/Clientes Varios.
    const already =
      placa
        ? await prisma.tramite.findFirst({
            where: {
              year,
              concesionarioId: concesionario.id,
              placa,
            },
            select: { id: true },
          })
        : null;

    if (already) {
      skipped++;
      continue;
    }

    // ✅ transacción por fila: reserva consecutivo + crea tramite + historial + payment
    await prisma.$transaction(async (tx) => {
      const ciudad = await tx.ciudad.upsert({
        where: { name: ciudadName },
        create: { name: ciudadName },
        update: {},
      });

      const clienteDoc = stableClientDocFromName(clienteNombre);
      const cliente = await tx.cliente.upsert({
        where: { id: (await (async () => {
          const existing = await tx.cliente.findFirst({
            where: { doc: clienteDoc },
            select: { id: true },
          });
          return existing?.id ?? "___NO___";
        })())},
        create: { doc: clienteDoc, nombre: clienteNombre },
        update: { nombre: clienteNombre },
      }).catch(async () => {
        // fallback (si el upsert por id inventado falla)
        const existing = await tx.cliente.findFirst({ where: { doc: clienteDoc } });
        if (existing) {
          return tx.cliente.update({
            where: { id: existing.id },
            data: { nombre: clienteNombre },
          });
        }
        return tx.cliente.create({ data: { doc: clienteDoc, nombre: clienteNombre } });
      });

      // reserva consecutivo para evitar colisiones futuras
      const reserva = await reserveNextConsecutivo(tx, concesionario.id, year);

      const tramite = await tx.tramite.create({
        data: {
          year,
          concesionarioId: concesionario.id,
          concesionarioCodeSnapshot: concesionario.code,
          consecutivo: reserva.consecutivo,
          ciudadId: ciudad.id,
          clienteId: cliente.id,
          placa: placa, // si prefieres NULL siempre, cámbialo a null
          estadoActual,
          honorariosValor: honorariosDec ?? undefined,
          createdAt: fecha,
          updatedAt: fecha,
          finalizedAt: estadoActual === "FINALIZADO_ENTREGADO" ? fecha : null,
          canceledAt: estadoActual === "CANCELADO" ? fecha : null,
        },
      });

      await tx.consecutivoReserva.update({
        where: { id: reserva.id },
        data: { tramiteId: tramite.id, status: ConsecStatus.RESERVADO },
      });

      await tx.tramiteEstadoHist.create({
        data: {
          tramiteId: tramite.id,
          fromEstado: null,
          toEstado: estadoActual,
          changedById: user.id,
          changedAt: fecha,
          notes: "Importado desde Excel 2025.",
          actionType: "NORMAL",
        },
      });

      // 1 payment OTRO con el total (porque en Excel ya está sumado)
      if (valorInt > 0) {
        await tx.payment.create({
          data: {
            tramiteId: tramite.id,
            tipo: PaymentTipo.OTRO,
            valor: valorInt,
            fecha: fecha,
            medioPago: MedioPago.OTRO,
            notes: "TOTAL (Excel 2025)",
            createdById: user.id,
            createdAt: fecha,
          },
        });
      }
    });

    created++;
  }

  console.log("=== RESULTADO ===");
  console.log("Filas con fecha detectadas:", detectedDateRows);
  console.log("Creados:", created);
  console.log("Saltados (ya existían / inválidos):", skipped);
  console.log("Correcciones swap ciudad/placa:", swappedCount);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
