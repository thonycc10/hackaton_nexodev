// Utilidades compartidas por las tools de lectura.
export const MAX_FILAS = 5;

// Separa la consulta en palabras de al menos 3 caracteres (máximo 6, sin repetir).
export function terminos(consulta) {
  const texto = typeof consulta === "string" ? consulta.trim() : "";
  if (!texto) throw new Error("El campo 'consulta' es obligatorio y debe ser texto.");
  const palabras = texto.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((p) => p.length >= 3);
  return [...new Set(palabras.length ? palabras : [texto.toLowerCase()])].slice(0, 6);
}

// Escapa los comodines de LIKE para que el texto del usuario se trate como literal.
export const comodin = (texto) => `%${texto.replace(/[\\%_]/g, "\\$&")}%`;

// Arma la búsqueda por palabras con ILIKE. `columnas` son constantes del código.
// Devuelve parámetros, condición WHERE (cualquier palabra) y puntaje (palabras que coinciden).
export function construirBusqueda(consulta, columnas) {
  const params = terminos(consulta).map(comodin);
  const coincide = params.map(
    (_, i) => "(" + columnas.map((c) => `${c} ILIKE $${i + 1}`).join(" OR ") + ")",
  );
  return {
    params,
    donde: coincide.join(" OR "),
    puntaje: coincide.map((c) => `CASE WHEN ${c} THEN 1 ELSE 0 END`).join(" + "),
  };
}

// Convierte las filas en { total, resultados } y quita las columnas auxiliares.
export function formatear(filas) {
  return {
    total: Number(filas[0]?.total ?? 0),
    resultados: filas.map(({ total, puntaje, ...resto }) => resto),
  };
}
