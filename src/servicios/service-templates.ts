import { ServicioTipo } from '@prisma/client';

export type FieldType = 'text' | 'number' | 'date' | 'textarea' | 'select';

export type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

export type ServiceTemplate = {
  tipo: ServicioTipo;
  nombre: string;
  descripcion?: string;
  campos: TemplateField[];
};

export function getServiceTemplates(): ServiceTemplate[] {
  return [
    {
      tipo: ServicioTipo.TRASPASO,
      nombre: 'Traspaso',
      descripcion: 'Traspaso de propiedad (manual).',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true, placeholder: 'ABC123' },
        { key: 'vin', label: 'VIN', type: 'text', placeholder: 'Opcional' },
        { key: 'compradorNombre', label: 'Comprador - Nombre', type: 'text', required: true },
        { key: 'compradorDoc', label: 'Comprador - Documento', type: 'text', required: true },
        { key: 'vendedorNombre', label: 'Vendedor - Nombre', type: 'text' },
        { key: 'vendedorDoc', label: 'Vendedor - Documento', type: 'text' },
        { key: 'valor', label: 'Valor (si aplica)', type: 'number' },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.PRENDA_INSCRIPCION,
      nombre: 'Prenda - Inscripción',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        { key: 'entidadFinanciera', label: 'Entidad financiera', type: 'text' },
        { key: 'numeroObligacion', label: 'No. obligación/contrato', type: 'text' },
        { key: 'valor', label: 'Valor (si aplica)', type: 'number' },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.PRENDA_LEVANTAMIENTO,
      nombre: 'Prenda - Levantamiento',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        { key: 'entidadFinanciera', label: 'Entidad financiera', type: 'text' },
        { key: 'numeroObligacion', label: 'No. obligación/contrato', type: 'text' },
        { key: 'fechaCarta', label: 'Fecha carta/soporte', type: 'date' },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.PRENDA_MODIFICACION,
      nombre: 'Prenda - Modificación',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        { key: 'entidadFinanciera', label: 'Entidad financiera', type: 'text' },
        { key: 'detalleCambio', label: 'Detalle del cambio', type: 'textarea', required: true },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.DUPLICADO_LICENCIA_TRANSITO,
      nombre: 'Duplicado licencia de tránsito',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        {
          key: 'motivo',
          label: 'Motivo',
          type: 'select',
          options: ['PERDIDA', 'HURTO', 'DETERIORO', 'OTRO'],
          required: true,
        },
        { key: 'numeroDenuncia', label: 'No. denuncia (si aplica)', type: 'text' },
        { key: 'fechaDenuncia', label: 'Fecha denuncia (si aplica)', type: 'date' },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.DUPLICADO_PLACAS,
      nombre: 'Duplicado de placas',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        { key: 'tipo', label: '¿Qué placas?', type: 'select', options: ['DELANTERA', 'TRASERA', 'AMBAS'], required: true },
        { key: 'motivo', label: 'Motivo', type: 'select', options: ['PERDIDA', 'HURTO', 'DETERIORO', 'OTRO'], required: true },
        { key: 'numeroDenuncia', label: 'No. denuncia (si aplica)', type: 'text' },
        { key: 'fechaDenuncia', label: 'Fecha denuncia (si aplica)', type: 'date' },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.CAMBIO_COLOR,
      nombre: 'Cambio de color',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        { key: 'colorAnterior', label: 'Color anterior', type: 'text' },
        { key: 'colorNuevo', label: 'Color nuevo', type: 'text', required: true },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.CAMBIO_MOTOR,
      nombre: 'Cambio de motor',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        { key: 'motorAnterior', label: 'No. motor anterior', type: 'text' },
        { key: 'motorNuevo', label: 'No. motor nuevo', type: 'text', required: true },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.CAMBIO_SERVICIO,
      nombre: 'Cambio de servicio',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        {
          key: 'servicioAnterior',
          label: 'Servicio anterior',
          type: 'select',
          options: ['PARTICULAR', 'PUBLICO', 'OFICIAL', 'DIPLOMATICO', 'OTRO'],
        },
        {
          key: 'servicioNuevo',
          label: 'Servicio nuevo',
          type: 'select',
          options: ['PARTICULAR', 'PUBLICO', 'OFICIAL', 'DIPLOMATICO', 'OTRO'],
          required: true,
        },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.CANCELACION_MATRICULA,
      nombre: 'Cancelación de matrícula',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        { key: 'motivo', label: 'Motivo', type: 'textarea', required: true },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.TRASLADO_CUENTA,
      nombre: 'Traslado de cuenta',
      campos: [
        { key: 'placa', label: 'Placa', type: 'text', required: true },
        { key: 'organismoOrigen', label: 'Organismo origen', type: 'text' },
        { key: 'organismoDestino', label: 'Organismo destino', type: 'text', required: true },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    },

    {
      tipo: ServicioTipo.OTRO,
      nombre: 'Otro',
      campos: [
        { key: 'nombreServicio', label: 'Nombre del servicio', type: 'text', required: true },
        { key: 'detalle', label: 'Detalle', type: 'textarea', required: true },
      ],
    },
  ];
}
