import { pool } from "../db.js";
import { MAX_FILAS, formatear } from "./util.js";

// Resuelve el código de una aplicación a partir de su código (YAPE) o de su nombre completo
// (Billetera Digital), sin distinguir mayúsculas. Lanza un error si no existe en cvt.
export async function resolverAplicativo(valor) {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error("El campo 'aplicativo' debe ser texto: el código o el nombre de la aplicación.");
  }
  const { rows } = await pool.query(
    `SELECT codigo_aplicacion
       FROM nexo_dev_bcp.cvt
      WHERE lower(codigo_aplicacion) = lower($1) OR lower(nombre_aplicacion) = lower($1)`,
    [valor.trim()],
  );
  if (rows.length === 0) {
    const { rows: validas } = await pool.query(
      "SELECT codigo_aplicacion, nombre_aplicacion FROM nexo_dev_bcp.cvt ORDER BY codigo_aplicacion",
    );
    const lista = validas.map((a) => `${a.codigo_aplicacion} (${a.nombre_aplicacion})`).join(", ");
    throw new Error(`La aplicación '${valor.trim()}' no existe. Las aplicaciones válidas son: ${lista}.`);
  }
  return rows[0].codigo_aplicacion;
}

// Simula la fuente de aplicaciones (cvt): nombre, descripción y responsables de cada aplicación.
export async function consultarAplicativos({ aplicativo } = {}) {
  const params = [];
  let filtro = "";
  if (aplicativo !== undefined && aplicativo !== null && String(aplicativo).trim() !== "") {
    params.push(await resolverAplicativo(aplicativo));
    filtro = "WHERE codigo_aplicacion = $1";
  }
  const { rows } = await pool.query(
    `SELECT codigo_aplicacion, nombre_aplicacion, descripcion, po, lt, tribe_leader, ttl,
            count(*) OVER () AS total
       FROM nexo_dev_bcp.cvt
       ${filtro}
      ORDER BY codigo_aplicacion
      LIMIT ${MAX_FILAS}`,
    params,
  );
  return formatear(rows);
}
