import { pool } from "../db.js";
import { MAX_FILAS, formatear } from "./util.js";
import { resolverAplicativo } from "./aplicaciones.js";

const CORTES = ["Actual", "Mes anterior", "Dos meses atrás"];

// Simula CHAMA: estado e indicadores de pases por aplicación y corte.
// Unidades (según la cabecera del archivo): pases en 30 días, CFR y ACCE en %, TMD en minutos.
export async function consultarIndicadores({ aplicativo, corte } = {}) {
  const params = [];
  const filtros = [];

  if (aplicativo !== undefined && aplicativo !== null && String(aplicativo).trim() !== "") {
    params.push(await resolverAplicativo(aplicativo));
    filtros.push(`codigo_aplicacion = $${params.length}`);
  }
  if (corte !== undefined && corte !== null) {
    const valido = CORTES.find((c) => typeof corte === "string" && c.toLowerCase() === corte.trim().toLowerCase());
    if (!valido) throw new Error(`El campo 'corte' debe ser uno de: ${CORTES.join(", ")}.`);
    params.push(valido);
    filtros.push(`corte = $${params.length}`);
  }
  const donde = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT codigo_aplicacion AS aplicativo, corte, estado_pases,
            indicador_pases AS pases_30_dias, indicador_cfr AS cfr_porcentaje,
            indicador_tmd AS tmd_minutos, indicador_acce AS acce_porcentaje,
            count(*) OVER () AS total
       FROM nexo_dev_bcp.chama
       ${donde}
      ORDER BY codigo_aplicacion, array_position($${params.length + 1}::text[], corte)
      LIMIT ${MAX_FILAS}`,
    [...params, CORTES],
  );
  return formatear(rows);
}
