import { PaymentTipo, ServicioTipo } from '@prisma/client';
import { getServiceTemplates } from '../servicios/service-templates';

export type CuentaCobroConceptKey =
  | 'IMPUESTO_TIMBRE'
  | 'IMPUESTO_TRANSITO'
  | 'MATRICULA'
  | 'SERVICIO_PRINCIPAL'
  | 'ENVIO_1'
  | 'ENVIO_2'
  | 'PAGO_MULTAS';

export type CuentaCobroConceptDef = {
  key: CuentaCobroConceptKey;
  conceptoId: string;
  label: string;
  has4x1000: boolean;
  label4x1000: string;
  paymentTipo: PaymentTipo;
  // Coordenadas de la plantilla CUENTA.pdf (referencia "top" en puntos de PDF)
  baseRowTop: number;
  fourByTop?: number;
  yearTop?: number;
  valueTop?: number;
  value4xTop?: number;
};

export const CUENTA_COBRO_CONCEPTS: CuentaCobroConceptDef[] = [
  {
    key: 'IMPUESTO_TIMBRE',
    conceptoId: 'impuesto_timbre',
    label: 'Impuesto de Timbre',
    has4x1000: true,
    label4x1000: '4*1000 Timbre',
    paymentTipo: 'TIMBRE',
    baseRowTop: 258.1,
    fourByTop: 275.6,
    yearTop: 258.1,
    valueTop: 258.1,
    value4xTop: 275.6,
  },
  {
    key: 'IMPUESTO_TRANSITO',
    conceptoId: 'impuesto_transito',
    label: 'Impuesto de transito',
    has4x1000: true,
    label4x1000: '4*1000',
    paymentTipo: 'DERECHOS',
    baseRowTop: 293.0,
    fourByTop: 310.4,
    yearTop: 293.0,
    valueTop: 293.0,
    value4xTop: 310.4,
  },
  {
    key: 'MATRICULA',
    conceptoId: 'matricula',
    label: 'Matricula',
    has4x1000: true,
    label4x1000: '4*1000',
    paymentTipo: 'DERECHOS',
    baseRowTop: 327.8,
    fourByTop: 345.2,
    yearTop: 327.8,
    valueTop: 327.8,
    value4xTop: 345.2,
  },
  {
    key: 'SERVICIO_PRINCIPAL',
    conceptoId: 'servicio',
    label: 'Traspaso', // en PDF se reemplaza dinámicamente con el servicio real
    has4x1000: true,
    label4x1000: '4*1000',
    paymentTipo: 'DERECHOS',
    baseRowTop: 362.6,
    fourByTop: 380.0,
    yearTop: 362.6,
    valueTop: 362.6,
    value4xTop: 380.0,
  },
  {
    key: 'ENVIO_1',
    conceptoId: 'envio_1',
    label: 'Envio',
    has4x1000: true,
    label4x1000: '4*1000',
    paymentTipo: 'OTRO',
    baseRowTop: 397.4,
    fourByTop: 414.8,
    yearTop: undefined,
    valueTop: 397.4,
    value4xTop: 414.8,
  },
  {
    key: 'ENVIO_2',
    conceptoId: 'envio_2',
    label: 'Envio',
    has4x1000: false,
    label4x1000: '',
    paymentTipo: 'OTRO',
    baseRowTop: 432.2,
    yearTop: undefined,
    valueTop: 432.2,
  },
  {
    key: 'PAGO_MULTAS',
    conceptoId: 'pago_multas',
    label: 'pago de multas',
    has4x1000: false,
    label4x1000: '',
    paymentTipo: 'OTRO',
    baseRowTop: 467.0,
    yearTop: undefined,
    valueTop: 467.0,
  },
];

export const CUENTA_COBRO_CONCEPT_MAP = new Map(CUENTA_COBRO_CONCEPTS.map((c) => [c.key, c] as const));
export const CUENTA_COBRO_CONCEPT_FRONTEND_MAP = new Map(CUENTA_COBRO_CONCEPTS.map((c) => [c.conceptoId, c] as const));

export function findCuentaCobroConcept(key: string | null | undefined): CuentaCobroConceptDef | undefined {
  if (!key) return undefined;
  return CUENTA_COBRO_CONCEPT_MAP.get(String(key).trim().toUpperCase() as CuentaCobroConceptKey);
}

export function findCuentaCobroConceptById(conceptoId: string | null | undefined): CuentaCobroConceptDef | undefined {
  if (!conceptoId) return undefined;
  return CUENTA_COBRO_CONCEPT_FRONTEND_MAP.get(String(conceptoId).trim().toLowerCase());
}

const SERVICE_NAME_BY_TIPO = new Map(getServiceTemplates().map((t) => [t.tipo, t.nombre] as const));
SERVICE_NAME_BY_TIPO.set(ServicioTipo.MATRICULA, 'Matricula');

export function resolveCuentaCobroServiceName(
  tipoServicio: ServicioTipo | null | undefined,
  serviceData?: unknown,
): string {
  if (!tipoServicio) return 'Traspaso';

  if (tipoServicio === ServicioTipo.OTRO && serviceData && typeof serviceData === 'object') {
    const nombreServicio = (serviceData as Record<string, unknown>).nombreServicio;
    if (typeof nombreServicio === 'string' && nombreServicio.trim()) {
      return nombreServicio.trim();
    }
  }

  return SERVICE_NAME_BY_TIPO.get(tipoServicio) ?? String(tipoServicio);
}

export const CUENTA_COBRO_PDF_COORDS = {
  headerRightX: 488,
  topServiceValue: 173.0, // fila "Servicio por tramite"
  topTotalCuentaCobroValue: 190.7, // fila "TOTAL CUENTA DE COBRO"
  tableConceptCellX: 50,
  tableConceptCellWidth: 184,
  tableYearCellX: 236,
  tableYearCellWidth: 122,
  tableValueRightX: 505,
  totals: {
    totalReembolsar: 484.4,
    masTotalCuentaCobro: 502.9,
    totalCancelar: 519.5,
    menosAbono: 537.3,
    saldoPendiente: 555.1,
  },
} as const;


