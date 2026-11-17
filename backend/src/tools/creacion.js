import { resolverAplicativo } from "./aplicaciones.js";
import { pool } from "../db.js";

// Creación de tickets e incidentes (SPEC 08 y SPEC 09).
// proponer_ticket guarda un borrador en la sesión. crear_ticket lo inserta, solo si el usuario
// envió un mensaje después de la propuesta. Es la única escritura en la base de todo el backend.
// WO, OCD e ITSM van a nexo_dev_bcp.jira_tickets e INC va a nexo_dev_bcp.jira_incidentes.

// Longitudes máximas de los campos de un ticket nuevo.
const MAX_TITULO = 200;
const MAX_TEXTO = 4000;

// Tickets que una sesión puede crear. Protege la tabla de un ciclo descontrolado del modelo.
const MAX_TICKETS_POR_SESION = 3;

// El tipo y el ambiente son independientes: cualquier tipo puede crearse en cualquier ambiente.
const TIPOS = ["WO", "OCD", "ITSM", "INC"];
const AMBIENTES = ["QA", "Producción"];
const GRUPOS = ["Seguridad", "Control de Accesos", "AgileOPS", "Base de Datos", "Soporte ITSM", "Soporte Mainframe"];
// Solo para INC: la tabla jira_incidentes exige severidad y tipo de incidente.
const SEVERIDADES = ["Crítica", "Alta", "Media", "Baja"];
const TIPOS_INCIDENTE = [
  "error_http_5xx", "latencia_timeout", "memoria_bd", "cpu_bd", "conexiones_bd", "certificado_vencido",
  "autenticacion", "despliegue_fallido", "contrato_incompatible", "integracion_mainframe", "monitoreo",
];

// Devuelve el valor canónico de la lista sin distinguir mayúsculas, o lanza un error con los válidos.
function valorDe(lista, campo, valor) {
  const encontrado = typeof valor === "string" ? lista.find((v) => v.toLowerCase() === valor.trim().toLowerCase()) : undefined;
  if (!encontrado) throw new Error(`El campo '${campo}' debe ser uno de: ${lista.join(", ")}.`);
  return encontrado;
}

// La descripción reúne el problema, las evidencias y la solución propuesta, porque jira_tickets no
// tiene columnas separadas para ellos. jira_incidentes sí tiene una columna de evidencias, así que
// la descripción de un INC solo lleva el problema y la solución propuesta.
export function armarDescripcion({ tipo, detalle_problema, evidencias, detalle_solucion }) {
  const solucion = `Solución propuesta:\n${detalle_solucion ?? "Sin solución propuesta"}`;
  if (tipo === "INC") return `Problema:\n${detalle_problema}\n\n${solucion}`;
  return `Problema:\n${detalle_problema}\n\nEvidencias:\n${evidencias ?? "Sin evidencias"}\n\n${solucion}`;
}

// Código = prefijo del tipo + correlativo de 4 dígitos (WO-0001, OCD-0001, ITSM-0001, INC-0001).
// Cada prefijo tiene su propio correlativo. Solo cuentan los códigos de exactamente 4 dígitos:
// los entregados (WO-0000001101, OCD-01103, INC-100048) tienen otro ancho y no entran.
const MAX_CORRELATIVO = 9999;

// Dónde se guarda cada tipo: WO, OCD e ITSM en jira_tickets e INC en jira_incidentes.
const DESTINO = {
  WO: { tabla: "nexo_dev_bcp.jira_tickets", columna: "codigo_ticket" },
  OCD: { tabla: "nexo_dev_bcp.jira_tickets", columna: "codigo_ticket" },
  ITSM: { tabla: "nexo_dev_bcp.jira_tickets", columna: "codigo_ticket" },
  INC: { tabla: "nexo_dev_bcp.jira_incidentes", columna: "codigo_incidente" },
};

// Mismo formato que buscar_tickets_similares (y los campos de incidente cuando es un INC).
// Un ticket recién creado no tiene similitud.
function darFormato(fila, extra = {}) {
  return {
    clave: fila.clave,
    tipo: fila.tipo,
    ambiente: fila.ambiente,
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    aplicativo: fila.aplicativo,
    estado: fila.estado,
    grupo_resolutor: fila.grupo_resolutor,
    url: fila.url,
    creado_en: fila.creado_en.toISOString(),
    similitud: null,
    ...extra,
  };
}

// Texto obligatorio: sin espacios sobrantes y con un máximo de caracteres.
function textoObligatorio(valor, campo, max) {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(`El campo '${campo}' es obligatorio y debe ser texto.`);
  }
  if (valor.trim().length > max) throw new Error(`El campo '${campo}' supera el máximo de ${max} caracteres.`);
  return valor.trim();
}

// Texto opcional: ausente o en blanco queda como null.
function textoOpcional(valor, campo, max) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "string") throw new Error(`El campo '${campo}' debe ser texto.`);
  if (valor.trim() === "") return null;
  if (valor.trim().length > max) throw new Error(`El campo '${campo}' supera el máximo de ${max} caracteres.`);
  return valor.trim();
}

const hay = (v) => v !== undefined && v !== null;

// Prepara el borrador de un ticket o incidente nuevo y lo guarda en la sesión. No escribe en la base:
// se crea con crear_ticket, cuando el usuario lo confirma en un mensaje posterior.
export async function proponerTicket(
  {
    tipo, ambiente, titulo, detalle_problema, aplicativo, grupo_resolutor, detalle_solucion, evidencias,
    api_id, severidad, tipo_incidente,
  } = {},
  { sesion } = {},
) {
  if (!sesion) throw new Error("No hay una sesión activa donde guardar el borrador.");

  const tipoValido = valorDe(TIPOS, "tipo", tipo);
  const ambienteValido = valorDe(AMBIENTES, "ambiente", ambiente);
  const datos = {
    titulo: textoObligatorio(titulo, "titulo", MAX_TITULO),
    detalle_problema: textoObligatorio(detalle_problema, "detalle_problema", MAX_TEXTO),
    detalle_solucion: textoOpcional(detalle_solucion, "detalle_solucion", MAX_TEXTO),
    evidencias: textoOpcional(evidencias, "evidencias", MAX_TEXTO),
  };
  textoObligatorio(aplicativo, "aplicativo", MAX_TITULO);
  const grupo = valorDe(GRUPOS, "grupo_resolutor", grupo_resolutor);
  // Lanza un error con las aplicaciones válidas si no existe en cvt.
  const codigoAplicacion = await resolverAplicativo(aplicativo);

  // Los campos de incidente solo se aceptan con INC, y con INC son obligatorios.
  const extra = {};
  if (tipoValido === "INC") {
    if (!hay(api_id)) throw new Error("Un incidente (INC) necesita 'api_id': el servicio afectado. Búscalo con consultar_apis.");
    const id = typeof api_id === "string" && api_id.trim() !== "" ? Number(api_id) : api_id;
    if (!Number.isInteger(id) || id < 1) throw new Error("El campo 'api_id' debe ser un número entero positivo.");
    const { rows } = await pool.query(
      "SELECT codigo_aplicacion, nombre_servicio FROM nexo_dev_bcp.portal_apis WHERE api_id = $1",
      [id],
    );
    if (rows.length === 0) throw new Error(`El servicio con api_id ${id} no existe. Búscalo con consultar_apis.`);
    if (rows[0].codigo_aplicacion !== codigoAplicacion) {
      throw new Error(`El servicio con api_id ${id} pertenece a ${rows[0].codigo_aplicacion}, no a ${codigoAplicacion}.`);
    }
    extra.api_id = id;
    extra.servicio = rows[0].nombre_servicio;
    extra.severidad = valorDe(SEVERIDADES, "severidad", severidad);
    extra.tipo_incidente = valorDe(TIPOS_INCIDENTE, "tipo_incidente", tipo_incidente);
  } else if (hay(api_id) || hay(severidad) || hay(tipo_incidente)) {
    throw new Error("Los campos 'api_id', 'severidad' y 'tipo_incidente' solo se usan con el tipo INC.");
  }

  const descripcion = armarDescripcion({ tipo: tipoValido, ...datos });

  // Un borrador nuevo reemplaza al anterior. Guarda el turno en que se propuso.
  sesion.borrador = {
    ...datos,
    ...extra,
    aplicativo: codigoAplicacion,
    ambiente: ambienteValido,
    tipo: tipoValido,
    grupo_resolutor: grupo,
    descripcion,
    turno: sesion.turno,
  };

  return {
    borrador: {
      tipo: tipoValido,
      ambiente: ambienteValido,
      titulo: datos.titulo,
      aplicativo: codigoAplicacion,
      grupo_resolutor: grupo,
      estado: "Registrado",
      descripcion,
      ...extra,
      ...(tipoValido === "INC" ? { evidencias: datos.evidencias } : {}),
    },
  };
}

// Crea el ticket o incidente del borrador guardado en la sesión. No recibe datos del modelo: crea
// exactamente lo que se propuso. Solo funciona si el usuario envió un mensaje después de la propuesta.
export async function crearTicket(_entrada, { sesion } = {}) {
  if (!sesion) throw new Error("No hay una sesión activa.");

  const borrador = sesion.borrador;
  if (!borrador) {
    throw new Error("No hay un borrador de ticket. Usa proponer_ticket y muestra la plantilla al usuario.");
  }
  if (sesion.turno <= borrador.turno) {
    throw new Error(
      "El usuario aún no confirmó el borrador. Muestra la plantilla y espera su respuesta en un mensaje posterior antes de crear el ticket.",
    );
  }
  if (sesion.ticketsCreados >= MAX_TICKETS_POR_SESION) {
    throw new Error(`Se alcanzó el máximo de ${MAX_TICKETS_POR_SESION} tickets por sesión. Explícaselo al usuario.`);
  }

  const { tabla, columna } = DESTINO[borrador.tipo];
  const prefijo = `${borrador.tipo}-`;

  // El borrador se consume antes de insertar: una segunda solicitud de la misma sesión no lo encuentra.
  sesion.borrador = null;
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    // Serializa la generación del código de cada tipo entre sesiones: se libera al terminar la transacción.
    await cliente.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`nexo_dev_bcp.codigo.${prefijo}`]);
    // WO, OCD e ITSM comparten tabla: el prefijo del código separa su correlativo.
    const { rows: maximo } = await cliente.query(
      `SELECT coalesce(max(substr(${columna}, $2::int)::int), 0) AS maximo
         FROM ${tabla}
        WHERE ${columna} ~ ('^' || $1 || '-[0-9]{4}$')`,
      [borrador.tipo, prefijo.length + 1],
    );
    const correlativo = maximo[0].maximo + 1;
    if (correlativo > MAX_CORRELATIVO) {
      throw new Error(`Se agotaron los códigos ${prefijo}XXXX (máximo ${MAX_CORRELATIVO}).`);
    }
    const codigo = `${prefijo}${String(correlativo).padStart(4, "0")}`;

    let ticket;
    // jira_incidentes no tiene valor por defecto en creado_en: se indica now() de forma explícita.
    if (borrador.tipo === "INC") {
      const { rows } = await cliente.query(
        `INSERT INTO nexo_dev_bcp.jira_incidentes
                (codigo_incidente, codigo_aplicacion, api_id, ambiente, severidad, tipo_incidente, titulo,
                 descripcion, evidencias, grupo_resolutor, estado, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Registrado', now())
         RETURNING codigo_incidente AS clave, codigo_aplicacion AS aplicativo, ambiente, titulo, descripcion,
                   grupo_resolutor, estado, url, creado_en`,
        [
          codigo, borrador.aplicativo, borrador.api_id, borrador.ambiente, borrador.severidad,
          borrador.tipo_incidente, borrador.titulo, borrador.descripcion, borrador.evidencias, borrador.grupo_resolutor,
        ],
      );
      ticket = darFormato(
        { ...rows[0], tipo: "INC" },
        { api_id: borrador.api_id, servicio: borrador.servicio, severidad: borrador.severidad, tipo_incidente: borrador.tipo_incidente },
      );
    } else {
      const { rows } = await cliente.query(
        `INSERT INTO nexo_dev_bcp.jira_tickets
                (codigo_ticket, codigo_aplicacion, tipo, ambiente, url, titulo, descripcion, grupo_resolutor, estado)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, 'Registrado')
         RETURNING codigo_ticket AS clave, codigo_aplicacion AS aplicativo, tipo, ambiente, titulo, descripcion,
                   grupo_resolutor, estado, url, creado_en`,
        [codigo, borrador.aplicativo, borrador.tipo, borrador.ambiente, borrador.titulo, borrador.descripcion, borrador.grupo_resolutor],
      );
      ticket = darFormato(rows[0]);
    }
    await cliente.query("COMMIT");
    sesion.ticketsCreados += 1;
    return { ticket };
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    sesion.borrador = borrador; // Si el INSERT falla, el borrador se conserva.
    throw err;
  } finally {
    cliente.release();
  }
}
