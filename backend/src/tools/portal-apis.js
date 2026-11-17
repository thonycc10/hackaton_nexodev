import { pool } from "../db.js";
import { MAX_FILAS, comodin, formatear } from "./util.js";
import { resolverAplicativo } from "./aplicaciones.js";

const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// Simula el Portal de APIs: servicios de cada aplicación con su endpoint y método.
// Sin api_id devuelve solo un resumen. Con api_id incluye además el contrato OpenAPI de ese servicio,
// para no gastar tokens del modelo con contratos que nadie pidió.
export async function consultarApis({ aplicativo, servicio, metodo, api_id } = {}) {
  if (servicio !== undefined && servicio !== null && typeof servicio !== "string") {
    throw new Error("El campo 'servicio' debe ser texto, por ejemplo 'Pagos de billetera'.");
  }
  let metodoNormalizado;
  if (metodo !== undefined && metodo !== null) {
    metodoNormalizado = typeof metodo === "string" ? metodo.trim().toUpperCase() : "";
    if (!METODOS.includes(metodoNormalizado)) {
      throw new Error(`El campo 'metodo' debe ser uno de: ${METODOS.join(", ")}.`);
    }
  }
  let id;
  if (api_id !== undefined && api_id !== null) {
    id = typeof api_id === "string" && api_id.trim() !== "" ? Number(api_id) : api_id;
    if (!Number.isInteger(id) || id < 1) throw new Error("El campo 'api_id' debe ser un número entero positivo.");
  }

  const params = [];
  const filtros = [];
  if (aplicativo !== undefined && aplicativo !== null && String(aplicativo).trim() !== "") {
    params.push(await resolverAplicativo(aplicativo));
    filtros.push(`codigo_aplicacion = $${params.length}`);
  }
  if (servicio?.trim()) {
    params.push(comodin(servicio.trim()));
    filtros.push(`nombre_servicio ILIKE $${params.length}`);
  }
  if (metodoNormalizado) {
    params.push(metodoNormalizado);
    filtros.push(`upper(metodo_http) = $${params.length}`);
  }
  if (id !== undefined) {
    params.push(id);
    filtros.push(`api_id = $${params.length}`);
  }
  const donde = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
  const columnaContrato = id !== undefined ? ", contrato" : "";

  const { rows } = await pool.query(
    `SELECT api_id, codigo_aplicacion AS aplicativo, nombre_servicio, endpoint, metodo_http${columnaContrato},
            count(*) OVER () AS total
       FROM nexo_dev_bcp.portal_apis
       ${donde}
      ORDER BY codigo_aplicacion, api_id
      LIMIT ${MAX_FILAS}`,
    params,
  );
  return formatear(rows);
}
