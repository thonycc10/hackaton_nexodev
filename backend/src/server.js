import { fileURLToPath } from "node:url";
import express from "express";
import { pool } from "./db.js";
import { obtenerOCrear, estaLlena, agregarMensaje } from "./sesiones.js";
import { responder, ErrorModelo } from "./agente.js";

const app = express();
app.use(express.json());

// Sirve solo la carpeta frontend/ (la interfaz web de la SPEC 03).
app.use(express.static(fileURLToPath(new URL("../../frontend", import.meta.url))));

app.get("/api/salud", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ estado: "ok", base_datos: "ok" });
  } catch (err) {
    console.error("Falla de base de datos:", err.message);
    res.status(503).json({ estado: "ok", base_datos: "error" });
  }
});

app.post("/api/chat", async (req, res) => {
  const { sesion_id: sesionId, mensaje } = req.body ?? {};

  if (typeof mensaje !== "string" || mensaje.trim() === "") {
    return res.status(400).json({ error: "El campo 'mensaje' es obligatorio y debe ser texto." });
  }

  const sesion = obtenerOCrear(sesionId);
  if (estaLlena(sesion)) {
    return res.status(429).json({ error: "La sesión alcanzó el máximo de mensajes. Inicia una nueva." });
  }

  const texto = mensaje.trim();
  sesion.turno += 1;
  let respuesta;
  try {
    respuesta = await responder(sesion, texto);
  } catch (err) {
    // Si el turno falla, un borrador propuesto en él no llegó al usuario: se descarta para que
    // un reintento no pueda crear un ticket que el usuario no vio.
    if (sesion.borrador?.turno === sesion.turno) sesion.borrador = null;
    throw err;
  }

  // El historial guarda solo el texto de cada turno, sin los resultados de las tools.
  agregarMensaje(sesion, "user", texto);
  agregarMensaje(sesion, "assistant", respuesta);

  res.json({ sesion_id: sesion.id, respuesta });
});

// Todos los errores salen como { error: "descripción corta" }.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "El cuerpo de la solicitud no es un JSON válido." });
  }
  if (err instanceof ErrorModelo) {
    return res.status(502).json({ error: err.message });
  }
  console.error("Error interno:", err);
  res.status(500).json({ error: "Error interno del servidor." });
});

const puerto = Number(process.env.PORT) || 3000;
app.listen(puerto, () => {
  console.log(`Backend escuchando en http://localhost:${puerto}`);
});
