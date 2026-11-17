import { pool } from "../db.js";
import { MAX_FILAS, formatear } from "./util.js";
import { resolverAplicativo } from "./aplicaciones.js";

// Simula Jira Ops Genie: personal de soporte y guardia de una aplicación, por turno.
export async function consultarGuardia({ aplicativo, turno } = {}) {
  if (turno !== undefined && turno !== null && typeof turno !== "string") {
    throw new Error("El campo 'turno' debe ser texto, por ejemplo 'Titular' o 'Turno tarde'.");
  }
  const params = [await resolverAplicativo(aplicativo)];
  let filtroTurno = "";
  if (turno?.trim()) {
    params.push(turno.trim());
    filtroTurno = " AND lower(turno) = lower($2)";
  }
  const { rows } = await pool.query(
    `SELECT codigo_aplicacion AS aplicativo, turno, soporte_1, soporte_2, soporte_3,
            count(*) OVER () AS total
       FROM nexo_dev_bcp.jira_ops_genie
      WHERE codigo_aplicacion = $1${filtroTurno}
      ORDER BY (turno = 'Titular') DESC, turno
      LIMIT ${MAX_FILAS}`,
    params,
  );
  return formatear(rows);
}
