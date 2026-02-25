#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function parseArgs(argv) {
  const envBeforeYear = Number(process.env.CLEANUP_BEFORE_YEAR ?? new Date().getFullYear());
  const args = {
    execute: false,
    beforeYear: Number.isInteger(envBeforeYear) && envBeforeYear >= 2000 ? envBeforeYear : new Date().getFullYear(),
    deleteOrphanClients: String(process.env.CLEANUP_DELETE_ORPHAN_CLIENTS ?? 'false').toLowerCase() === 'true',
    summaryFile: String(process.env.CLEANUP_SUMMARY_FILE ?? '').trim(),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--execute') {
      args.execute = true;
      continue;
    }
    if (token === '--dry-run') {
      args.execute = false;
      continue;
    }
    if (token === '--delete-orphan-clients') {
      args.deleteOrphanClients = true;
      continue;
    }
    if (token === '--keep-orphan-clients') {
      args.deleteOrphanClients = false;
      continue;
    }
    if (token === '--before-year') {
      const next = argv[++i];
      const year = Number(next);
      if (!Number.isInteger(year) || year < 2000) {
        throw new Error(`Invalid value for --before-year: ${next ?? '(missing)'}`);
      }
      args.beforeYear = year;
      continue;
    }
    if (token === '--summary-file') {
      const next = argv[++i];
      if (!next) throw new Error('Missing value for --summary-file');
      args.summaryFile = next;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`SGM yearly cleanup (preserves users by design)

Usage:
  node ops/yearly-cleanup.js [--dry-run] [--execute] [--before-year YYYY]
                             [--summary-file path.json]
                             [--delete-orphan-clients]

Defaults:
  --dry-run                  (default mode)
  --before-year <currentYear>
  orphan clients are preserved

Examples:
  node ops/yearly-cleanup.js --dry-run --before-year 2026
  node ops/yearly-cleanup.js --execute --before-year 2026
`);
}

function ensureDatabaseUrl() {
  const value = String(process.env.DATABASE_URL ?? '').trim();
  if (!value) throw new Error('DATABASE_URL is required');
  return value;
}

function buildDefaultSummaryPath(beforeYear) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), 'logs', 'yearly-cleanup', `before-${beforeYear}-${stamp}.json`);
}

async function collectPreview(prisma, beforeYear, cutoffDate) {
  const [
    oldTramites,
    oldReservas,
    oldPayments,
    oldFiles,
    oldChecklist,
    oldEstadoHist,
    oldServicioPagos,
    oldServicioEstadoHist,
    oldShipmentLinks,
    oldOrphanShipments,
    oldTramiteYears,
    groupedServices,
    orphanClientes,
  ] = await Promise.all([
    prisma.tramite.count({ where: { year: { lt: beforeYear } } }),
    prisma.consecutivoReserva.count({ where: { year: { lt: beforeYear } } }),
    prisma.payment.count({ where: { tramite: { year: { lt: beforeYear } } } }),
    prisma.tramiteFile.count({ where: { tramite: { year: { lt: beforeYear } } } }),
    prisma.tramiteDocument.count({ where: { tramite: { year: { lt: beforeYear } } } }),
    prisma.tramiteEstadoHist.count({ where: { tramite: { year: { lt: beforeYear } } } }),
    prisma.servicioPago.count({ where: { tramite: { year: { lt: beforeYear } } } }),
    prisma.servicioEstadoHist.count({ where: { tramite: { year: { lt: beforeYear } } } }),
    prisma.shipmentTramite.count({ where: { tramite: { year: { lt: beforeYear } } } }),
    prisma.shipment.count({
      where: {
        fechaEnvio: { lt: cutoffDate },
        links: { none: {} },
      },
    }),
    prisma.tramite.findMany({
      where: { year: { lt: beforeYear } },
      select: { year: true },
      distinct: ['year'],
      orderBy: { year: 'asc' },
    }),
    prisma.tramite.groupBy({
      by: ['year', 'tipoServicio', 'concesionarioCodeSnapshot'],
      where: { year: { lt: beforeYear } },
      _count: { _all: true },
    }),
    prisma.cliente.count({ where: { tramites: { none: {} } } }),
  ]);

  return {
    cutoff: {
      beforeYear,
      cutoffDateIso: cutoffDate.toISOString(),
    },
    counts: {
      tramites: oldTramites,
      consecutivoReservas: oldReservas,
      payments: oldPayments,
      tramiteFiles: oldFiles,
      tramiteChecklist: oldChecklist,
      tramiteEstadoHist: oldEstadoHist,
      servicioPagos: oldServicioPagos,
      servicioEstadoHist: oldServicioEstadoHist,
      shipmentLinks: oldShipmentLinks,
      orphanShipmentsOlderThanCutoff: oldOrphanShipments,
      orphanClientesCurrentDb: orphanClientes,
    },
    yearsDetected: oldTramiteYears.map((x) => x.year),
    serviceSummary: groupedServices
      .map((row) => ({
        year: row.year,
        tipoServicio: row.tipoServicio,
        concesionarioCode: row.concesionarioCodeSnapshot,
        count: row._count._all,
      }))
      .sort((a, b) => a.year - b.year || a.tipoServicio.localeCompare(b.tipoServicio) || a.concesionarioCode.localeCompare(b.concesionarioCode)),
  };
}

async function executeCleanup(prisma, beforeYear, cutoffDate, options) {
  const deleted = {
    byYear: [],
    consecutivoReservas: 0,
    orphanShipmentsOlderThanCutoff: 0,
    orphanClientes: 0,
  };

  const reservasResult = await prisma.consecutivoReserva.deleteMany({
    where: { year: { lt: beforeYear } },
  });
  deleted.consecutivoReservas = reservasResult.count;

  const years = await prisma.tramite.findMany({
    where: { year: { lt: beforeYear } },
    select: { year: true },
    distinct: ['year'],
    orderBy: { year: 'asc' },
  });

  for (const { year } of years) {
    const tramitesResult = await prisma.tramite.deleteMany({ where: { year } });

    deleted.byYear.push({
      year,
      tramites: tramitesResult.count,
    });
  }

  const orphanShipmentsResult = await prisma.shipment.deleteMany({
    where: {
      fechaEnvio: { lt: cutoffDate },
      links: { none: {} },
    },
  });
  deleted.orphanShipmentsOlderThanCutoff = orphanShipmentsResult.count;

  if (options.deleteOrphanClients) {
    const orphanClientesResult = await prisma.cliente.deleteMany({
      where: { tramites: { none: {} } },
    });
    deleted.orphanClientes = orphanClientesResult.count;
  }

  return deleted;
}

async function main() {
  let prisma;
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }

    const connectionString = ensureDatabaseUrl();
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });

    const cutoffDate = new Date(Date.UTC(args.beforeYear, 0, 1, 0, 0, 0, 0));
    const summaryFile = path.resolve(args.summaryFile || buildDefaultSummaryPath(args.beforeYear));

    await prisma.$connect();

    const preview = await collectPreview(prisma, args.beforeYear, cutoffDate);
    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.execute ? 'execute' : 'dry-run',
      preserved: {
        users: true,
        orphanClients: !args.deleteOrphanClients,
      },
      preview,
      deleted: null,
    };

    if (args.execute) {
      report.deleted = await executeCleanup(prisma, args.beforeYear, cutoffDate, args);
    }

    fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
    fs.writeFileSync(summaryFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(`[yearly-cleanup] mode=${report.mode}`);
    console.log(`[yearly-cleanup] beforeYear=${args.beforeYear}`);
    console.log(`[yearly-cleanup] users preserved=true`);
    console.log(`[yearly-cleanup] orphan clients preserved=${!args.deleteOrphanClients}`);
    console.log(`[yearly-cleanup] old tramites found=${preview.counts.tramites}`);
    console.log(`[yearly-cleanup] summary file=${summaryFile}`);
    if (args.execute && report.deleted) {
      const deletedTramites = report.deleted.byYear.reduce((acc, row) => acc + row.tramites, 0);
      console.log(`[yearly-cleanup] deleted tramites=${deletedTramites}`);
      console.log(`[yearly-cleanup] deleted orphan shipments=${report.deleted.orphanShipmentsOlderThanCutoff}`);
      if (args.deleteOrphanClients) {
        console.log(`[yearly-cleanup] deleted orphan clientes=${report.deleted.orphanClientes}`);
      }
    } else {
      console.log('[yearly-cleanup] dry-run only; no rows deleted');
    }
  } finally {
    if (prisma) {
      await prisma.$disconnect().catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error('[yearly-cleanup] failed');
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
