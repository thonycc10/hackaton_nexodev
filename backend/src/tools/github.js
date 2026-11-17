import { pool } from "../db.js";
import { MAX_FILAS, construirBusqueda, formatear } from "./util.js";
import { resolverAplicativo } from "./aplicaciones.js";

const TIPOS = ["componente", "aprovisionamiento", "contrato"];

// El código fuente se recorta para no gastar tokens del modelo.
const MAX_CODIGO = 1000;

function recortar(texto) {
  if (texto === null || texto.length <= MAX_CODIGO) return texto;
  return `${texto.slice(0, MAX_CODIGO)}…`;
}

// Simula GitHub: componentes, configuraciones de aprovisionamiento y contratos de cada aplicación.
export async function buscarComponentesGithub({ consulta, aplicativo, tipo } = {}) {
  if (tipo !== undefined && !TIPOS.includes(tipo)) {
    throw new Error(`El campo 'tipo' debe ser uno de: ${TIPOS.join(", ")}.`);
  }

  const { params, donde, puntaje } = construirBusqueda(consulta, [
    "g.nombre_componente",
    "g.codigo_componente",
    "g.codigo_fuente",
  ]);
  const filtros = [];
  if (aplicativo !== undefined && aplicativo !== null && String(aplicativo).trim() !== "") {
    params.push(await resolverAplicativo(aplicativo));
    filtros.push(`g.codigo_aplicacion = $${params.length}`);
  }
  if (tipo) {
    params.push(tipo);
    filtros.push(`g.tipo = $${params.length}`);
  }
  const filtrosSql = filtros.map((f) => ` AND ${f}`).join("");

  const { rows } = await pool.query(
    `SELECT g.nombre_componente, g.codigo_aplicacion AS aplicativo, g.tipo, g.codigo_componente,
            g.codigo_fuente, (${puntaje}) AS puntaje, count(*) OVER () AS total
       FROM nexo_dev_bcp.github g
      WHERE (${donde})${filtrosSql}
      ORDER BY puntaje DESC, g.codigo_aplicacion, g.tipo, g.codigo_componente
      LIMIT ${MAX_FILAS}`,
    params,
  );
  const { total, resultados } = formatear(rows);
  return {
    total,
    resultados: resultados.map((fila) => ({ ...fila, codigo_fuente: recortar(fila.codigo_fuente) })),
  };
}
