import { pool } from "../db.js";
import { MAX_FILAS, terminos, formatear } from "./util.js";
import { resolverAplicativo } from "./aplicaciones.js";

// Solo se consideran tickets creados en los últimos DIAS_VENTANA días.
const DIAS_VENTANA = 90;

const ESTADOS = ["Registrado", "En Procesado", "Terminado"];
const TIPOS = ["WO", "OCD", "ITSM"];
const GRUPOS = ["Seguridad", "Control de Accesos", "AgileOPS", "Base de Datos", "Soporte ITSM", "Soporte Mainframe"];

// Devuelve el valor canónico de la lista sin distinguir mayúsculas, o lanza un error con los válidos.
function valorDe(lista, campo, valor) {
  const encontrado = typeof valor === "string" ? lista.find((v) => v.toLowerCase() === valor.trim().toLowerCase()) : undefined;
  if (!encontrado) throw new Error(`El campo '${campo}' debe ser uno de: ${lista.join(", ")}.`);
  return encontrado;
}

function darFormato(fila) {
  return {
    clave: fila.codigo_ticket,
    tipo: fila.tipo,
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    aplicativo: fila.aplicativo,
    ambiente: fila.ambiente,
    estado: fila.estado,
    grupo_resolutor: fila.grupo_resolutor,
    url: fila.url,
    creado_en: fila.creado_en.toISOString(),
    similitud: Number(Number(fila.similitud).toFixed(4)),
  };
}

// Simula Jira: busca tickets recientes (WO y OCD) parecidos a lo que describe el usuario.
// Los tickets no registran solución ni evidencias: solo título, descripción, estado y grupo resolutor.
export async function buscarTicketsSimilares({ consulta, aplicativo, estado, tipo, grupo_resolutor } = {}) {
  const filtros = [];
  const params = [];
  // Un ticket coincide si contiene cualquiera de las palabras. websearch_to_tsquery usa el
  // diccionario español (stemming y palabras vacías) y entiende "or" entre palabras.
  params.push(terminos(consulta).join(" or "), DIAS_VENTANA);

  if (aplicativo !== undefined && aplicativo !== null && String(aplicativo).trim() !== "") {
    params.push(await resolverAplicativo(aplicativo));
    filtros.push(`t.codigo_aplicacion = $${params.length}`);
  }
  if (estado !== undefined && estado !== null) {
    params.push(valorDe(ESTADOS, "estado", estado));
    filtros.push(`t.estado = $${params.length}`);
  }
  if (tipo !== undefined && tipo !== null) {
    params.push(valorDe(TIPOS, "tipo", tipo));
    filtros.push(`t.tipo = $${params.length}`);
  }
  if (grupo_resolutor !== undefined && grupo_resolutor !== null) {
    params.push(valorDe(GRUPOS, "grupo_resolutor", grupo_resolutor));
    filtros.push(`t.grupo_resolutor = $${params.length}`);
  }
  const filtrosSql = filtros.map((f) => ` AND ${f}`).join("");

  const { rows } = await pool.query(
    `WITH q AS (SELECT websearch_to_tsquery('spanish', $1) AS consulta)
     SELECT t.codigo_ticket, t.tipo, t.titulo, t.descripcion, t.codigo_aplicacion AS aplicativo,
            t.ambiente, t.estado, t.grupo_resolutor, t.url, t.creado_en,
            ts_rank(t.busqueda, q.consulta) AS similitud,
            count(*) OVER () AS total
       FROM nexo_dev_bcp.jira_tickets t, q
      WHERE t.busqueda @@ q.consulta
        AND t.creado_en >= now() - make_interval(days => $2)${filtrosSql}
      ORDER BY similitud DESC, t.creado_en DESC, t.codigo_ticket DESC
      LIMIT ${MAX_FILAS}`,
    params,
  );
  const { total, resultados } = formatear(rows);
  return { total, resultados: resultados.map(darFormato) };
}
