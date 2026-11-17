import pg from "pg";

// Lee PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE del entorno.
export const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });

// Evita que un error de una conexión inactiva tumbe el proceso.
pool.on("error", (err) => {
  console.error("Error en el pool de PostgreSQL:", err.message);
});
