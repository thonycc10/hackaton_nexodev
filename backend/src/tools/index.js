import { consultarAplicativos } from "./aplicaciones.js";
import { buscarDocumentos } from "./confluence.js";
import { buscarComponentesGithub } from "./github.js";
import { buscarTicketsSimilares } from "./jira-tickets.js";
import { buscarIncidentes } from "./incidentes.js";
import { proponerTicket, crearTicket } from "./creacion.js";
import { consultarApis } from "./portal-apis.js";
import { consultarGuardia } from "./guardia.js";
import { consultarIndicadores } from "./indicadores.js";

// Tools de solo lectura sobre la base nexo_dev_bcp. `parameters` es un JSON Schema.
// Todas aceptan `aplicativo` como código (YAPE) o nombre completo (Billetera Digital).
const APLICATIVO = "Código o nombre completo de la aplicación: YAPE (Billetera Digital), MBBK (Mobile Banking) o TTIB (Transferencias Interbancarias).";

const funciones = [
  {
    name: "consultar_aplicativos",
    description:
      "Consulta las aplicaciones (simula la fuente de aplicaciones): código, nombre, descripción y responsables (PO, LT, tribe leader y TTL). Sin parámetros devuelve las tres aplicaciones.",
    parameters: {
      type: "object",
      properties: {
        aplicativo: { type: "string", description: `${APLICATIVO} Opcional.` },
      },
    },
  },
  {
    name: "buscar_documentos",
    description:
      "Busca en la documentación (simula Confluence): modelos operativos con los pasos para solicitar o configurar algo, lecciones aprendidas, reglas de negocio y consideraciones internas. Devuelve hasta 5 documentos con su contenido. tiene_diagrama indica que el documento tiene un diagrama que no se puede mostrar.",
    parameters: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Palabras clave a buscar, por ejemplo 'alta aplicativo consumidor'." },
        aplicativo: { type: "string", description: `${APLICATIVO} Opcional.` },
        tipo: {
          type: "string",
          enum: [
            "leccion_aprendida",
            "regla_negocio",
            "consideracion_interna",
            "lineamiento",
            "politica",
            "mejor_practica",
            "modelo_operativo",
            "diagrama_arquitectura",
            "diagrama_secuencia",
          ],
          description: "Filtra por tipo de documento (opcional).",
        },
        audiencia: {
          type: "string",
          enum: ["equipo_responsable", "otros_equipos", "ambos"],
          description: "Filtra por audiencia del documento (opcional).",
        },
        herramienta: { type: "string", description: "Herramienta o plataforma, por ejemplo 'API de pagos' (opcional)." },
      },
      required: ["consulta"],
    },
  },
  {
    name: "buscar_componentes_github",
    description:
      "Busca en los repositorios (simula GitHub): componentes de código, configuraciones de aprovisionamiento y contratos de cada aplicación. Devuelve hasta 5 resultados con el código fuente, recortado a 1000 caracteres.",
    parameters: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Palabras clave a buscar, por ejemplo 'configuración QA perfil'." },
        aplicativo: { type: "string", description: `${APLICATIVO} Opcional.` },
        tipo: {
          type: "string",
          enum: ["componente", "aprovisionamiento", "contrato"],
          description: "Filtra por tipo de elemento (opcional).",
        },
      },
      required: ["consulta"],
    },
  },
  {
    name: "buscar_tickets_similares",
    description:
      "Busca tickets recientes (últimos 90 días, simula Jira) parecidos a lo que el usuario describe. Los tickets son de tipo WO, OCD o ITSM y pueden estar en QA o en Producción. Devuelve hasta 5 ordenados por similitud, con su clave real, estado, grupo resolutor y enlace. Los tickets NO registran la solución ni evidencias. Úsala junto con buscar_incidentes cada vez que el usuario describe un problema o una necesidad.",
    parameters: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Palabras clave de lo que se describe, por ejemplo 'certificado pruebas'." },
        aplicativo: { type: "string", description: `${APLICATIVO} Opcional.` },
        estado: {
          type: "string",
          enum: ["Registrado", "En Procesado", "Terminado"],
          description: "Filtra por estado del ticket (opcional).",
        },
        tipo: {
          type: "string",
          enum: ["WO", "OCD", "ITSM"],
          description: "Tipo del ticket (opcional).",
        },
        grupo_resolutor: {
          type: "string",
          enum: ["Seguridad", "Control de Accesos", "AgileOPS", "Base de Datos", "Soporte ITSM", "Soporte Mainframe"],
          description: "Grupo que resuelve el ticket (opcional).",
        },
      },
      required: ["consulta"],
    },
  },
  {
    name: "buscar_incidentes",
    description:
      "Busca incidentes (INC) de los últimos 90 días (simula Jira), de QA o Producción, parecidos a un error o falla que describe el usuario: errores HTTP 5xx, latencia, memoria o CPU de base de datos, certificados vencidos, etc. Devuelve hasta 5 ordenados por similitud, con clave, severidad, tipo, servicio afectado, evidencias y estado. Solo los incidentes Terminado traen causa_raiz y solucion. Úsala junto con buscar_tickets_similares siempre que busques similares: cuando el usuario describe un problema, una necesidad, un error o una caída, o antes de proponer un ticket.",
    parameters: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Palabras clave del error, por ejemplo 'error 500 timeout' o 'memoria base de datos'." },
        aplicativo: { type: "string", description: `${APLICATIVO} Opcional.` },
        severidad: {
          type: "string",
          enum: ["Crítica", "Alta", "Media", "Baja"],
          description: "Severidad del incidente (opcional).",
        },
        tipo_incidente: {
          type: "string",
          enum: [
            "error_http_5xx",
            "latencia_timeout",
            "memoria_bd",
            "cpu_bd",
            "conexiones_bd",
            "certificado_vencido",
            "autenticacion",
            "despliegue_fallido",
            "contrato_incompatible",
            "integracion_mainframe",
            "monitoreo",
          ],
          description: "Tipo de incidente (opcional).",
        },
        estado: {
          type: "string",
          enum: ["Registrado", "En Procesado", "Terminado"],
          description: "Estado del incidente (opcional).",
        },
        grupo_resolutor: {
          type: "string",
          enum: ["Seguridad", "Control de Accesos", "AgileOPS", "Base de Datos", "Soporte ITSM", "Soporte Mainframe"],
          description: "Grupo que resuelve el incidente (opcional).",
        },
        api_id: { type: "integer", description: "Identificador de un servicio del portal de APIs (opcional)." },
        servicio: { type: "string", description: "Parte del nombre del servicio afectado, por ejemplo 'saldos' (opcional)." },
      },
      required: ["consulta"],
    },
  },
  {
    name: "consultar_apis",
    description:
      "Consulta el portal de APIs (simulado): servicios de cada aplicación con su endpoint y método HTTP. Devuelve hasta 5 servicios sin contrato. Para ver el contrato OpenAPI de un servicio concreto, vuelve a llamarla con su api_id.",
    parameters: {
      type: "object",
      properties: {
        aplicativo: { type: "string", description: `${APLICATIVO} Opcional.` },
        servicio: { type: "string", description: "Parte del nombre del servicio, por ejemplo 'saldos' (opcional)." },
        metodo: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "Método HTTP (opcional).",
        },
        api_id: { type: "integer", description: "Identificador de un servicio. Con él se incluye su contrato OpenAPI (opcional)." },
      },
    },
  },
  {
    name: "consultar_guardia",
    description:
      "Consulta el personal de soporte y guardia de una aplicación (simula Jira Ops Genie), con hasta tres personas de soporte por turno: Titular, Turno tarde y Turno noche.",
    parameters: {
      type: "object",
      properties: {
        aplicativo: { type: "string", description: APLICATIVO },
        turno: { type: "string", description: "Turno, por ejemplo 'Titular' o 'Turno tarde' (opcional)." },
      },
      required: ["aplicativo"],
    },
  },
  {
    name: "consultar_indicadores",
    description:
      "Consulta el estado de los pases y sus indicadores (simula CHAMA) por aplicación y corte. estado_pases puede ser NORMAL, ALERTA o FREEZE. Unidades: pases_30_dias es la cantidad de pases en 30 días, cfr_porcentaje y acce_porcentaje son porcentajes, y tmd_minutos son minutos.",
    parameters: {
      type: "object",
      properties: {
        aplicativo: { type: "string", description: `${APLICATIVO} Opcional.` },
        corte: {
          type: "string",
          enum: ["Actual", "Mes anterior", "Dos meses atrás"],
          description: "Corte del indicador (opcional).",
        },
      },
    },
  },
  {
    name: "proponer_ticket",
    description:
      "Prepara el borrador de un ticket o incidente nuevo y lo guarda en la sesión. NO lo crea: devuelve el borrador para que lo muestres al usuario como plantilla y esperes su confirmación. Si el usuario pide cambios, vuelve a llamarla con los datos corregidos. WO, OCD e ITSM son tickets; INC es un incidente y además necesita api_id, severidad y tipo_incidente.",
    parameters: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["WO", "OCD", "ITSM", "INC"],
          description: "Tipo que elige el usuario. Si no lo dijo, pregúntaselo.",
        },
        ambiente: {
          type: "string",
          enum: ["QA", "Producción"],
          description: "Ambiente del ticket, independiente del tipo. Si no lo dijo, pregúntaselo.",
        },
        titulo: { type: "string", description: "Título breve (máximo 200 caracteres)." },
        detalle_problema: { type: "string", description: "Detalle del problema o de la necesidad (máximo 4000 caracteres)." },
        aplicativo: { type: "string", description: APLICATIVO },
        grupo_resolutor: {
          type: "string",
          enum: ["Seguridad", "Control de Accesos", "AgileOPS", "Base de Datos", "Soporte ITSM", "Soporte Mainframe"],
          description: "Grupo que lo resolverá. Propónlo con base en tickets e incidentes similares; si no puedes inferirlo, pregúntalo al usuario.",
        },
        detalle_solucion: { type: "string", description: "Solución propuesta con base en incidentes o documentos similares (opcional, máximo 4000 caracteres)." },
        evidencias: { type: "string", description: "Evidencias como texto, por ejemplo logs o mensajes de error (opcional, máximo 4000 caracteres)." },
        api_id: { type: "integer", description: "Solo INC: identificador del servicio afectado (consultar_apis). Debe ser de la aplicación indicada." },
        severidad: {
          type: "string",
          enum: ["Crítica", "Alta", "Media", "Baja"],
          description: "Solo INC: severidad del incidente.",
        },
        tipo_incidente: {
          type: "string",
          enum: [
            "error_http_5xx",
            "latencia_timeout",
            "memoria_bd",
            "cpu_bd",
            "conexiones_bd",
            "certificado_vencido",
            "autenticacion",
            "despliegue_fallido",
            "contrato_incompatible",
            "integracion_mainframe",
            "monitoreo",
          ],
          description: "Solo INC: tipo de incidente.",
        },
      },
      required: ["tipo", "ambiente", "titulo", "detalle_problema", "aplicativo", "grupo_resolutor"],
    },
  },
  {
    name: "crear_ticket",
    description:
      "Crea el ticket o incidente del último borrador guardado con proponer_ticket. No recibe datos. Solo funciona si el usuario respondió confirmando en un mensaje posterior al borrador: nunca la llames en el mismo mensaje en que propusiste el borrador. Crea un ticket en jira_tickets (WO, OCD, ITSM) o un incidente en jira_incidentes (INC) y devuelve su clave: WO-XXXX, OCD-XXXX, ITSM-XXXX o INC-XXXX.",
    parameters: { type: "object", properties: {} },
  },
];

// Formato `function` de la API compatible con OpenAI.
export const definiciones = funciones.map((funcion) => ({ type: "function", function: funcion }));

const ejecutores = {
  consultar_aplicativos: consultarAplicativos,
  buscar_documentos: buscarDocumentos,
  buscar_componentes_github: buscarComponentesGithub,
  buscar_tickets_similares: buscarTicketsSimilares,
  buscar_incidentes: buscarIncidentes,
  proponer_ticket: proponerTicket,
  crear_ticket: crearTicket,
  consultar_apis: consultarApis,
  consultar_guardia: consultarGuardia,
  consultar_indicadores: consultarIndicadores,
};

// Ejecuta la tool pedida por el modelo. Lanza un error si el nombre no existe.
// `contexto` ({ sesion }) lo reciben las tools que necesitan el estado de la conversación.
export async function ejecutarTool(nombre, entrada, contexto = {}) {
  const ejecutor = ejecutores[nombre];
  if (!ejecutor) throw new Error(`Tool desconocida: ${nombre}`);
  return ejecutor(entrada ?? {}, contexto);
}
