import { pool } from "../db.js";
import { MAX_FILAS, comodin, construirBusqueda, formatear } from "./util.js";
import { resolverAplicativo } from "./aplicaciones.js";

const TIPOS = [
  "leccion_aprendida",
  "regla_negocio",
  "consideracion_interna",
  "lineamiento",
  "politica",
  "mejor_practica",
  "modelo_operativo",
  "diagrama_arquitectura",
  "diagrama_secuencia",
];
const AUDIENCIAS = ["equipo_responsable", "otros_equipos", "ambos"];

// Simula Confluence: modelos operativos, lecciones aprendidas, reglas de negocio y diagramas.
// Nunca devuelve los bytes de imagen_png: solo indica con tiene_diagrama si el documento tiene uno.
export async function buscarDocumentos({ consulta, aplicativo, tipo, audiencia, herramienta } = {}) {
  if (tipo !== undefined && !TIPOS.includes(tipo)) {
    throw new Error(`El campo 'tipo' debe ser uno de: ${TIPOS.join(", ")}.`);
  }
  if (audiencia !== undefined && !AUDIENCIAS.includes(audiencia)) {
    throw new Error(`El campo 'audiencia' debe ser uno de: ${AUDIENCIAS.join(", ")}.`);
  }
  if (herramienta !== undefined && typeof herramienta !== "string") {
    throw new Error("El campo 'herramienta' debe ser texto, por ejemplo 'API de pagos'.");
  }

  const { params, donde, puntaje } = construirBusqueda(consulta, ["d.titulo", "d.contenido"]);
  const filtros = [];
  if (aplicativo !== undefined && aplicativo !== null && String(aplicativo).trim() !== "") {
    params.push(await resolverAplicativo(aplicativo));
    filtros.push(`d.codigo_aplicacion = $${params.length}`);
  }
  if (tipo) {
    params.push(tipo);
    filtros.push(`d.tipo = $${params.length}`);
  }
  if (audiencia) {
    params.push(audiencia);
    filtros.push(`d.audiencia = $${params.length}`);
  }
  if (herramienta?.trim()) {
    params.push(comodin(herramienta.trim()));
    filtros.push(`d.herramienta_plataforma ILIKE $${params.length}`);
  }
  const filtrosSql = filtros.map((f) => ` AND ${f}`).join("");

  const { rows } = await pool.query(
    `SELECT d.documento_id, d.codigo_aplicacion AS aplicativo, d.tipo, d.audiencia, d.titulo,
            d.contenido, d.herramienta_plataforma, d.url_origen,
            (d.imagen_png IS NOT NULL) AS tiene_diagrama,
            (${puntaje}) AS puntaje, count(*) OVER () AS total
       FROM nexo_dev_bcp.jira_confluence d
      WHERE (${donde})${filtrosSql}
      ORDER BY puntaje DESC, d.documento_id
      LIMIT ${MAX_FILAS}`,
    params,
  );
  return formatear(rows);
}
