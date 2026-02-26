#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function parseArgs(argv) {
  const args = {
    execute: false,
    summaryFile: String(process.env.CLIENTES_DEDUPE_SUMMARY_FILE ?? '').trim(),
    limitGroups: null,
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
    if (token === '--summary-file') {
      const next = argv[++i];
      if (!next) throw new Error('Missing value for --summary-file');
      args.summaryFile = next;
      continue;
    }
    if (token === '--limit-groups') {
      const next = Number(argv[++i]);
      if (!Number.isInteger(next) || next <= 0) {
        throw new Error('Invalid value for --limit-groups');
      }
      args.limitGroups = next;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`SGM client deduplication (accent/case/punctuation-safe)

Usage:
  node ops/dedupe-clientes.js [--dry-run] [--execute]
                              [--limit-groups N]
                              [--summary-file path.json]

Rules:
  - Groups by normalized client name (ignores accents, spaces, punctuation, case).
  - Uses cc/nit as safety guard:
    * if multiple different non-empty docs exist in the group, it is NOT auto-merged.
    * if docs are blank or equivalent (format differences only), it can be merged.
  - Reassigns tramites to one canonical client, then deletes duplicate clients.

Defaults:
  --dry-run (default)
`);
}

function ensureDatabaseUrl() {
  const value = String(process.env.DATABASE_URL ?? '').trim();
  if (!value) throw new Error('DATABASE_URL is required');
  return value;
}

function buildDefaultSummaryPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), 'logs', 'clientes-dedupe', `${stamp}.json`);
}

function trimOptional(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function normalizeDocKey(value) {
  const s = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return s.length > 0 ? s : null;
}

function normalizeNameKey(value) {
  const s = String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return s.length > 0 ? s : null;
}

function hasDiacritics(value) {
  return /[^\u0000-\u007F]/.test(String(value ?? ''));
}

function nonEmptyCount(cliente) {
  let score = 0;
  if (trimOptional(cliente.email)) score++;
  if (trimOptional(cliente.telefono)) score++;
  if (trimOptional(cliente.direccion)) score++;
  return score;
}

function pickBestDisplayName(group) {
  const candidates = group
    .map((c) => trimOptional(c.nombre))
    .filter(Boolean)
    .map((nombre) => ({ nombre }));

  if (candidates.length === 0) return '';

  candidates.sort((a, b) => {
    const aDi = hasDiacritics(a.nombre) ? 1 : 0;
    const bDi = hasDiacritics(b.nombre) ? 1 : 0;
    if (bDi !== aDi) return bDi - aDi;
    if (b.nombre.length !== a.nombre.length) return b.nombre.length - a.nombre.length;
    return a.nombre.localeCompare(b.nombre, 'es');
  });

  return candidates[0].nombre;
}

function compareCanonical(a, b) {
  const aDoc = normalizeDocKey(a.doc) ? 1 : 0;
  const bDoc = normalizeDocKey(b.doc) ? 1 : 0;
  if (bDoc !== aDoc) return bDoc - aDoc;

  const aTramites = Number(a.tramitesCount ?? 0);
  const bTramites = Number(b.tramitesCount ?? 0);
  if (bTramites !== aTramites) return bTramites - aTramites;

  const aContacts = nonEmptyCount(a);
  const bContacts = nonEmptyCount(b);
  if (bContacts !== aContacts) return bContacts - aContacts;

  const aDiacritics = hasDiacritics(a.nombre) ? 1 : 0;
  const bDiacritics = hasDiacritics(b.nombre) ? 1 : 0;
  if (bDiacritics !== aDiacritics) return bDiacritics - aDiacritics;

  const aNameLen = String(a.nombre ?? '').trim().length;
  const bNameLen = String(b.nombre ?? '').trim().length;
  if (bNameLen !== aNameLen) return bNameLen - aNameLen;

  return String(a.id).localeCompare(String(b.id));
}

function chooseDocToKeep(group) {
  const docs = group
    .map((c) => ({
      raw: trimOptional(c.doc),
      key: normalizeDocKey(c.doc),
    }))
    .filter((x) => x.key);

  if (docs.length === 0) return '';

  docs.sort((a, b) => {
    const aLen = (a.raw ?? '').length;
    const bLen = (b.raw ?? '').length;
    if (bLen !== aLen) return bLen - aLen; // preserve formatted version if available
    return (a.raw ?? '').localeCompare(b.raw ?? '');
  });

  return docs[0].raw ?? '';
}

function chooseFieldToKeep(group, field, canonicalValue) {
  const canonicalTrimmed = trimOptional(canonicalValue);
  if (canonicalTrimmed) return canonicalTrimmed;

  for (const c of group) {
    const v = trimOptional(c[field]);
    if (v) return v;
  }
  return null;
}

function buildMergePlan(group) {
  const sorted = [...group].sort(compareCanonical);
  const canonical = sorted[0];
  const duplicates = sorted.slice(1);

  const nonEmptyDocKeys = Array.from(
    new Set(
      group
        .map((c) => normalizeDocKey(c.doc))
        .filter((x) => !!x),
    ),
  );

  if (nonEmptyDocKeys.length > 1) {
    return {
      status: 'skip_doc_conflict',
      reason: 'Multiple different non-empty documents in same normalized-name group.',
      normalizedNameKey: normalizeNameKey(canonical.nombre),
      group,
      nonEmptyDocKeys,
    };
  }

  const desiredDoc = chooseDocToKeep(group);
  const desiredNombre = pickBestDisplayName(group);
  const desiredEmail = chooseFieldToKeep(group, 'email', canonical.email);
  const desiredTelefono = chooseFieldToKeep(group, 'telefono', canonical.telefono);
  const desiredDireccion = chooseFieldToKeep(group, 'direccion', canonical.direccion);

  const updateData = {};
  if ((trimOptional(canonical.doc) ?? '') !== (trimOptional(desiredDoc) ?? '')) updateData.doc = desiredDoc;
  if ((trimOptional(canonical.nombre) ?? '') !== (trimOptional(desiredNombre) ?? '')) updateData.nombre = desiredNombre;
  if ((trimOptional(canonical.email) ?? null) !== (desiredEmail ?? null)) updateData.email = desiredEmail;
  if ((trimOptional(canonical.telefono) ?? null) !== (desiredTelefono ?? null)) updateData.telefono = desiredTelefono;
  if ((trimOptional(canonical.direccion) ?? null) !== (desiredDireccion ?? null)) updateData.direccion = desiredDireccion;

  return {
    status: 'merge',
    normalizedNameKey: normalizeNameKey(canonical.nombre),
    canonical,
    duplicates,
    updateData,
    nonEmptyDocKeys,
    estimatedTramitesToRepoint: duplicates.reduce((acc, c) => acc + Number(c.tramitesCount ?? 0), 0),
  };
}

async function loadClientes(prisma) {
  const rows = await prisma.cliente.findMany({
    select: {
      id: true,
      nombre: true,
      doc: true,
      email: true,
      telefono: true,
      direccion: true,
      _count: { select: { tramites: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    doc: row.doc,
    email: row.email,
    telefono: row.telefono,
    direccion: row.direccion,
    tramitesCount: row._count.tramites,
  }));
}

function analyzeDuplicates(clientes, options = {}) {
  const groupsByName = new Map();

  for (const cliente of clientes) {
    const key = normalizeNameKey(cliente.nombre);
    if (!key) continue;
    const arr = groupsByName.get(key) ?? [];
    arr.push(cliente);
    groupsByName.set(key, arr);
  }

  let rawGroups = Array.from(groupsByName.entries())
    .map(([normalizedNameKey, group]) => ({ normalizedNameKey, group }))
    .filter((x) => x.group.length > 1)
    .sort((a, b) => b.group.length - a.group.length || a.normalizedNameKey.localeCompare(b.normalizedNameKey));

  if (Number.isInteger(options.limitGroups) && options.limitGroups > 0) {
    rawGroups = rawGroups.slice(0, options.limitGroups);
  }

  const plans = rawGroups.map(({ group }) => buildMergePlan(group));
  const mergePlans = plans.filter((p) => p.status === 'merge');
  const skippedDocConflict = plans.filter((p) => p.status === 'skip_doc_conflict');

  const totals = {
    totalClientesScanned: clientes.length,
    duplicateGroupsByNormalizedName: rawGroups.length,
    mergeableGroups: mergePlans.length,
    skippedDocConflictGroups: skippedDocConflict.length,
    duplicateClienteRowsToDeleteIfExecuted: mergePlans.reduce((acc, p) => acc + p.duplicates.length, 0),
    estimatedTramitesToRepoint: mergePlans.reduce((acc, p) => acc + p.estimatedTramitesToRepoint, 0),
  };

  return {
    totals,
    mergePlans,
    skippedDocConflict,
  };
}

function summarizePlanForReport(plan) {
  if (plan.status === 'skip_doc_conflict') {
    return {
      status: plan.status,
      reason: plan.reason,
      normalizedNameKey: plan.normalizedNameKey,
      nonEmptyDocKeys: plan.nonEmptyDocKeys,
      clients: plan.group.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        doc: trimOptional(c.doc),
        tramitesCount: c.tramitesCount,
      })),
    };
  }

  return {
    status: plan.status,
    normalizedNameKey: plan.normalizedNameKey,
    canonical: {
      id: plan.canonical.id,
      nombre: plan.canonical.nombre,
      doc: trimOptional(plan.canonical.doc),
      tramitesCount: plan.canonical.tramitesCount,
    },
    duplicates: plan.duplicates.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      doc: trimOptional(c.doc),
      tramitesCount: c.tramitesCount,
    })),
    updateData: plan.updateData,
    estimatedTramitesToRepoint: plan.estimatedTramitesToRepoint,
  };
}

async function executeMerges(prisma, mergePlans) {
  const result = {
    groupsMerged: 0,
    clientesDeleted: 0,
    tramitesRepointed: 0,
    canonicalUpdates: 0,
    details: [],
  };

  for (const plan of mergePlans) {
    const duplicateIds = plan.duplicates.map((c) => c.id);
    if (duplicateIds.length === 0) continue;

    const txResult = await prisma.$transaction(async (tx) => {
      let canonicalUpdated = 0;
      if (Object.keys(plan.updateData).length > 0) {
        await tx.cliente.update({
          where: { id: plan.canonical.id },
          data: plan.updateData,
        });
        canonicalUpdated = 1;
      }

      const repoint = await tx.tramite.updateMany({
        where: { clienteId: { in: duplicateIds } },
        data: { clienteId: plan.canonical.id },
      });

      const deleted = await tx.cliente.deleteMany({
        where: { id: { in: duplicateIds } },
      });

      return {
        canonicalUpdated,
        tramitesRepointed: repoint.count,
        clientesDeleted: deleted.count,
      };
    });

    result.groupsMerged += 1;
    result.canonicalUpdates += txResult.canonicalUpdated;
    result.tramitesRepointed += txResult.tramitesRepointed;
    result.clientesDeleted += txResult.clientesDeleted;
    result.details.push({
      canonicalId: plan.canonical.id,
      duplicateIds,
      ...txResult,
    });
  }

  return result;
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

    const summaryFile = path.resolve(args.summaryFile || buildDefaultSummaryPath());

    await prisma.$connect();

    const clientes = await loadClientes(prisma);
    const analysis = analyzeDuplicates(clientes, { limitGroups: args.limitGroups });

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.execute ? 'execute' : 'dry-run',
      rules: {
        grouping: 'normalized_name_exact',
        normalizedNameIgnores: ['accents', 'case', 'spaces', 'punctuation'],
        docConflictGuard: true,
      },
      totals: analysis.totals,
      preview: {
        mergeableGroupsSample: analysis.mergePlans.slice(0, 25).map(summarizePlanForReport),
        skippedDocConflictGroupsSample: analysis.skippedDocConflict.slice(0, 25).map(summarizePlanForReport),
      },
      executed: null,
    };

    if (args.execute) {
      report.executed = await executeMerges(prisma, analysis.mergePlans);
    }

    fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
    fs.writeFileSync(summaryFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(`[clientes-dedupe] mode=${report.mode}`);
    console.log(`[clientes-dedupe] clientes scanned=${report.totals.totalClientesScanned}`);
    console.log(
      `[clientes-dedupe] duplicate groups=${report.totals.duplicateGroupsByNormalizedName} (mergeable=${report.totals.mergeableGroups}, skipped_doc_conflict=${report.totals.skippedDocConflictGroups})`,
    );
    console.log(
      `[clientes-dedupe] potential deletes=${report.totals.duplicateClienteRowsToDeleteIfExecuted}, potential tramites repointed=${report.totals.estimatedTramitesToRepoint}`,
    );
    console.log(`[clientes-dedupe] summary file=${summaryFile}`);

    if (args.execute && report.executed) {
      console.log(`[clientes-dedupe] merged groups=${report.executed.groupsMerged}`);
      console.log(`[clientes-dedupe] canonical updates=${report.executed.canonicalUpdates}`);
      console.log(`[clientes-dedupe] tramites repointed=${report.executed.tramitesRepointed}`);
      console.log(`[clientes-dedupe] clientes deleted=${report.executed.clientesDeleted}`);
    } else {
      console.log('[clientes-dedupe] dry-run only; no rows modified');
    }
  } finally {
    if (prisma) {
      await prisma.$disconnect().catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error('[clientes-dedupe] failed');
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
