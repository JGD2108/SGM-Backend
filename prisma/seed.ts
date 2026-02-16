import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });


async function main() {
  // 1) Admin user
  const adminEmail = process.env.ADMIN_EMAIL!;
  const adminPassword = process.env.ADMIN_PASSWORD!;
  const adminName = process.env.ADMIN_NAME ?? 'Admin';

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: adminName, passwordHash, isActive: true },
    create: { name: adminName, email: adminEmail, passwordHash, isActive: true },
  });

  // 2) Concesionarios
  const concesionarios = [
    { code: 'AUTOTROPICAL', name: 'Autotropical - Toyota' },
    { code: 'MOTOCOSTA', name: 'Motocosta - Renault' },
    { code: 'JUANAUTOS', name: 'Juanautos - Renault' },
    { code: 'ALEMANA_AUTOMOTRIZ', name: 'Alemana Automotriz - Mercedes Benz' },
    { code: 'MASSY_MOTORS', name: 'Massy Motors - Jeep Volvo Peugeot Fiat Dodge RAM' },
    { code: 'DAVIVIENDA', name: 'Davivienda - Multimarcas' },
    { code: 'CLIENTES_VARIOS', name: 'Clientes Varios - Multimarcas' },
    { code: 'AUTOSTAR', name: 'Autostar - Multimarcas' },
  ];

  for (const c of concesionarios) {
    await prisma.concesionario.upsert({
      where: { code: c.code },
      update: { name: c.name },
      create: c,
    });
  }

  // 3) Ciudades (lista base)
  const ciudades = [
    'Barranquilla','Cartagena','Santa Marta','Sabanagrande','Baranoa','Puerto Colombia',
    'Sabanalarga','Galapa','Soledad','Malambo','Valledupar','Riohacha','Monteria',
    'Sincelejo','Turbaco','Plato','Medellin','Cali'
  ];

  for (const name of ciudades) {
    await prisma.ciudad.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 4) Document Types (keys ESTABLES para el Front)
  const docTypes = [
    { key: 'FACTURA', name: 'Factura', required: true },
    { key: 'EVIDENCIA_PLACA', name: 'Evidencia placa', required: false },
    { key: 'DOC_FISICO', name: 'Documento físico', required: false },
    { key: 'RECIBO_TIMBRE', name: 'Recibo timbre', required: false },
    { key: 'RECIBO_DERECHOS', name: 'Recibo derechos', required: false },
    { key: 'OTRO', name: 'Otro', required: false },
  ];

  for (const d of docTypes) {
    await prisma.documentType.upsert({
      where: { key: d.key },
      update: { name: d.name, required: d.required, isActive: true },
      create: { ...d, isActive: true },
    });
  }

  // 5) Alert rules (ejemplo MVP)
  const rules = [
    {
      name: 'Placa asignada -> Docs físicos completos',
      fromEstado: 'PLACA_ASIGNADA',
      toEstado: 'DOCS_FISICOS_COMPLETOS',
      thresholdDays: 5,
    },
    {
      name: 'Enviado a gestor -> Finalizado',
      fromEstado: 'ENVIADO_GESTOR_TRANSITO',
      toEstado: 'FINALIZADO_ENTREGADO',
      thresholdDays: 7,
    },
  ] as const;

  for (const r of rules) {
    await prisma.alertRule.upsert({
      where: { name: r.name },
      update: { ...r, isActive: true },
      create: { ...r, isActive: true },
    });
  }

  console.log('Seed listo: admin + catálogos.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
