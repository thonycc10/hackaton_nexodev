import { randomUUID } from "node:crypto";

// Expiración por inactividad. SESION_TTL_SEGUNDOS permite acortarla para probar.
const TTL_MS = (Number(process.env.SESION_TTL_SEGUNDOS) || 30 * 60) * 1000;
export const MAX_MENSAJES = 50;

const sesiones = new Map();

function descartarExpiradas() {
  const ahora = Date.now();
  for (const [id, sesion] of sesiones) {
    if (ahora - sesion.ultimaActividad > TTL_MS) sesiones.delete(id);
  }
}

// Devuelve la sesión indicada si existe y no expiró. Si no, crea una nueva.
export function obtenerOCrear(sesionId) {
  descartarExpiradas();
  const existente = typeof sesionId === "string" ? sesiones.get(sesionId) : undefined;
  if (existente) {
    existente.ultimaActividad = Date.now();
    return existente;
  }
  const nueva = {
    id: randomUUID(),
    mensajes: [],
    ultimaActividad: Date.now(),
    turno: 0, // Sube en 1 con cada mensaje del usuario. Las rondas de tools de un mensaje comparten turno.
    borrador: null, // Borrador de ticket propuesto, pendiente de confirmación del usuario.
    ticketsCreados: 0, // Tickets creados desde esta sesión.
  };
  sesiones.set(nueva.id, nueva);
  return nueva;
}

export function estaLlena(sesion) {
  return sesion.mensajes.length >= MAX_MENSAJES;
}

export function agregarMensaje(sesion, role, content) {
  sesion.mensajes.push({ role, content });
  sesion.ultimaActividad = Date.now();
}
