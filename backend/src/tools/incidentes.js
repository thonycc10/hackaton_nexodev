import { pool } from "../db.js";
import { MAX_FILAS, terminos, comodin, formatear } from "./util.js";
import { resolverAplicativo } from "./aplicaciones.js";

// Solo se consideran incidentes creados en los últimos DIAS_VENTANA días.
const DIAS_VENTANA = 90;
// Las evidencias se recortan para no gastar tokens del modelo.
const MAX_EVIDENCIAS = 1000;

const SEVERIDADES = ["Crítica", "Alta", "Media", "Baja"];
const TIPOS_INCIDENTE = [
  "error_http_5xx", "latencia_timeout", "memoria_bd", "cpu_bd", "conexiones_bd", "certificado_vencido",
  "autenticacion", "despliegue_fallido", "contrato_incompatible", "integracion_mainframe", "monitoreo",
];
const ESTADOS = ["Registrado", "En Procesado", "Terminado"];
const GRUPOS = ["Seguridad", "Control de Accesos", "AgileOPS", "Base de Datos", "Soporte ITSM", "Soporte Mainframe"];

// Devuelve el valor canónico de la lista sin distinguir mayúsculas, o lanza un error con los válidos.
function valorDe(lista, campo, valor) {
  const encontrado = typeof valor === "string" ? lista.find((v) => v.toLowerCase() === valor.trim().toLowerCase()) : undefined;
  if (!encontrado) throw new Error(`El campo '${campo}' debe ser uno de: ${lista.join(", ")}.`);
  return encontrado;
}

const hay = (v) => v !== undefined && v !== null;

function recortar(texto) {
  if (texto == null || texto.length <= MAX_EVIDENCIAS) return texto;
  return `${texto.slice(0, MAX_EVIDENCIAS)}…`;
}

function darFormato(fila) {
  const terminado = fila.estado === "Terminado";
  return {
    clave: fila.codigo_incidente,
    aplicativo: fila.aplicativo,
    api_id: fila.api_id,
    servicio: fila.servicio,
    endpoint: fila.endpoint,
    metodo_http: fila.metodo_http,
    ambiente: fila.ambiente,
    severidad: fila.severidad,
    tipo_incidente: fila.tipo_incidente,
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    evidencias: recortar(fila.evidencias),
    // La causa raíz y la solución solo son definitivas cuando el incidente está Terminado.
    causa_raiz: terminado ? fila.causa_raiz : null,
    solucion: terminado ? fila.solucion : null,
    estado: fila.estado,
    grupo_resolutor: fila.grupo_resolutor,
    url: fila.url,
    creado_en: fila.creado_en.toISOString(),
    resuelto_en: fila.resuelto_en ? fila.resuelto_en.toISOString() : null,
    similitud: Number(Number(fila.similitud).toFixed(4)),
  };
}

// Simula Jira (incidentes de producción): busca incidentes recientes parecidos a lo que describe el usuario.
// Solo los incidentes Terminado traen causa raíz y solución.
export async function buscarIncidentes(
  { consulta, aplicativo, severidad, tipo_incidente, estado, grupo_resolutor, api_id, servicio } = {},
) {
  const filtros = [];
  // Un incidente coincide si contiene cualquiera de las palabras (diccionario español, "or" entre palabras).
  const params = [terminos(consulta).join(" or "), DIAS_VENTANA];

  if (hay(aplicativo) && String(aplicativo).trim() !== "") {
    params.push(await resolverAplicativo(aplicativo));
    filtros.push(`i.codigo_aplicacion = $${params.length}`);
  }
  if (hay(severidad)) {
    params.push(valorDe(SEVERIDADES, "severidad", severidad));
    filtros.push(`i.severidad = $${params.length}`);
  }
  if (hay(tipo_incidente)) {
    params.push(valorDe(TIPOS_INCIDENTE, "tipo_incidente", tipo_incidente));
    filtros.push(`i.tipo_incidente = $${params.length}`);
  }
  if (hay(estado)) {
    params.push(valorDe(ESTADOS, "estado", estado));
    filtros.push(`i.estado = $${params.length}`);
  }
  if (hay(grupo_resolutor)) {
    params.push(valorDe(GRUPOS, "grupo_resolutor", grupo_resolutor));
    filtros.push(`i.grupo_resolutor = $${params.length}`);
  }
  if (hay(api_id)) {
    const id = typeof api_id === "string" && api_id.trim() !== "" ? Number(api_id) : api_id;
    if (!Number.isInteger(id) || id < 1) throw new Error("El campo 'api_id' debe ser un número entero positivo.");
    params.push(id);
    filtros.push(`i.api_id = $${params.length}`);
  }
  if (hay(servicio)) {
    if (typeof servicio !== "string") {
      throw new Error("El campo 'servicio' debe ser texto, por ejemplo 'Pagos de billetera'.");
    }
    if (servicio.trim() !== "") {
      params.push(comodin(servicio.trim()));
      filtros.push(`a.nombre_servicio ILIKE $${params.length}`);
    }
  }
  const filtrosSql = filtros.map((f) => ` AND ${f}`).join("");

  const { rows } = await pool.query(
    `WITH q AS (SELECT websearch_to_tsquery('spanish', $1) AS consulta)
     SELECT i.codigo_incidente, i.codigo_aplicacion AS aplicativo, i.api_id,
            a.nombre_servicio AS servicio, a.endpoint, a.metodo_http,
            i.ambiente, i.severidad, i.tipo_incidente, i.titulo, i.descripcion, i.evidencias,
            i.causa_raiz, i.solucion, i.estado, i.grupo_resolutor, i.url, i.creado_en, i.resuelto_en,
            ts_rank(i.busqueda, q.consulta) AS similitud,
            count(*) OVER () AS total
       FROM nexo_dev_bcp.jira_incidentes i
       JOIN nexo_dev_bcp.portal_apis a ON a.api_id = i.api_id, q
      WHERE i.busqueda @@ q.consulta
        AND i.creado_en >= now() - make_interval(days => $2)${filtrosSql}
      ORDER BY similitud DESC, i.creado_en DESC, i.codigo_incidente DESC
      LIMIT ${MAX_FILAS}`,
    params,
  );
  const { total, resultados } = formatear(rows);
  return { total, resultados: resultados.map(darFormato) };
}
