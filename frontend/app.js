const URL_CHAT = "/api/chat";

const $mensajes = document.getElementById("mensajes");
const $formulario = document.getElementById("formulario");
const $entrada = document.getElementById("entrada");
const $enviar = document.getElementById("enviar");
const $nuevaConversacion = document.getElementById("nueva-conversacion");

const PREGUNTAS_EJEMPLO = [
  "¿Cómo genero un ticket en producción?",
  "¿Quién es el equipo responsable de api-pagos?",
  "¿Hay una solución de código para el error 500 de api-personas?",
];

// Conversación guardada en el navegador. Se sube la versión de la clave si cambia el formato.
const CLAVE_ALMACEN = "nexodev:chat:v1";
const ROLES = ["user", "assistant", "aviso"];
const AVISO_SESION_VENCIDA = "La sesión anterior expiró: el asistente no recuerda los mensajes previos.";

let sesionId = null;
let enviando = false;
let historial = []; // [{ rol, texto }]: lo que se muestra y se guarda. Solo intercambios completados.

// Todo acceso a localStorage va en try/catch: puede estar bloqueado, lleno o con datos dañados.
function guardarAlmacen() {
  try {
    localStorage.setItem(CLAVE_ALMACEN, JSON.stringify({ sesionId, mensajes: historial }));
  } catch {
    // Sin almacenamiento la interfaz funciona igual, sin restaurar al recargar.
  }
}

function borrarAlmacen() {
  try {
    localStorage.removeItem(CLAVE_ALMACEN);
  } catch {
    // Se ignora: no hay nada que borrar.
  }
}

function leerAlmacen() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_ALMACEN));
    const valido =
      datos &&
      (datos.sesionId === null || typeof datos.sesionId === "string") &&
      Array.isArray(datos.mensajes) &&
      datos.mensajes.every((m) => m && ROLES.includes(m.rol) && typeof m.texto === "string");
    return valido ? datos : null;
  } catch {
    return null;
  }
}

function desplazarAlFinal() {
  $mensajes.scrollTop = $mensajes.scrollHeight;
}

// Agrega una burbuja. El texto se inserta con textContent: nunca se interpreta como HTML.
function agregarBurbuja(clase, texto) {
  const burbuja = document.createElement("div");
  burbuja.className = `mensaje ${clase}`;
  burbuja.textContent = texto;
  $mensajes.append(burbuja);
  desplazarAlFinal();
  return burbuja;
}

// Los enlaces de las respuestas se abren en otra pestaña y sin acceso a esta ventana.
DOMPurify.addHook("afterSanitizeAttributes", (nodo) => {
  if (nodo.tagName === "A" && nodo.hasAttribute("href")) {
    nodo.setAttribute("target", "_blank");
    nodo.setAttribute("rel", "noopener noreferrer");
  }
});

// Convierte el Markdown del asistente en HTML y lo sanea siempre con DOMPurify antes de insertarlo.
function renderizarMarkdown(texto) {
  return DOMPurify.sanitize(marked.parse(texto, { async: false }));
}

function mostrarAsistente(texto) {
  const burbuja = document.createElement("div");
  burbuja.className = "mensaje asistente";
  burbuja.innerHTML = renderizarMarkdown(texto);
  $mensajes.append(burbuja);
  desplazarAlFinal();
}

// Saludo y preguntas de ejemplo. Desaparece al enviar el primer mensaje.
function mostrarBienvenida() {
  const bienvenida = document.createElement("div");
  bienvenida.className = "bienvenida";

  const titulo = document.createElement("h2");
  titulo.textContent = "¿En qué puedo ayudarte?";
  const descripcion = document.createElement("p");
  descripcion.textContent = "Consulta cómo generar tickets, equipos responsables y soluciones aplicadas. Prueba con una de estas preguntas:";

  const ejemplos = document.createElement("div");
  ejemplos.className = "ejemplos";
  for (const pregunta of PREGUNTAS_EJEMPLO) {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "ejemplo";
    boton.textContent = pregunta;
    boton.addEventListener("click", () => {
      if (!enviando) enviarMensaje(pregunta);
    });
    ejemplos.append(boton);
  }

  bienvenida.append(titulo, descripcion, ejemplos);
  $mensajes.append(bienvenida);
}

// Vuelve a mostrar la conversación guardada. Devuelve false si no hay nada que restaurar.
function restaurarConversacion() {
  const guardada = leerAlmacen();
  if (!guardada || guardada.mensajes.length === 0) return false;

  sesionId = guardada.sesionId;
  historial = guardada.mensajes;
  for (const { rol, texto } of historial) {
    if (rol === "user") agregarBurbuja("usuario", texto);
    else if (rol === "assistant") mostrarAsistente(texto);
    else agregarBurbuja("aviso", texto);
  }
  return true;
}

function nuevaConversacion() {
  if (enviando) return;
  sesionId = null;
  historial = [];
  borrarAlmacen();
  $mensajes.replaceChildren();
  $entrada.value = "";
  ajustarAltoEntrada();
  mostrarBienvenida();
  $entrada.focus();
}

function fijarEnviando(valor) {
  enviando = valor;
  $entrada.disabled = valor;
  $enviar.disabled = valor;
  $nuevaConversacion.disabled = valor; // Evita vaciar la pantalla con una respuesta en camino.
  if (!valor) $entrada.focus();
}

function ajustarAltoEntrada() {
  $entrada.style.height = "auto";
  $entrada.style.height = `${Math.min($entrada.scrollHeight, 180)}px`;
}

// Burbuja de error con el botón Reintentar, que repite la misma consulta sin duplicar la burbuja del usuario.
function mostrarError(texto, reintentar) {
  const burbuja = document.createElement("div");
  burbuja.className = "mensaje error";

  const parrafo = document.createElement("p");
  parrafo.textContent = texto;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "boton-secundario";
  boton.textContent = "Reintentar";
  boton.addEventListener("click", () => {
    if (enviando) return;
    reintentar();
  });

  burbuja.append(parrafo, boton);
  $mensajes.append(burbuja);
  desplazarAlFinal();
}

// Pide la respuesta del agente para un mensaje que ya está en pantalla.
async function pedirRespuesta(texto) {
  $mensajes.querySelectorAll(".mensaje.error").forEach((burbuja) => burbuja.remove());
  const pensando = agregarBurbuja("pensando", "Pensando…");
  fijarEnviando(true);

  try {
    const respuesta = await fetch(URL_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sesion_id: sesionId ?? undefined, mensaje: texto }),
    });
    const datos = await respuesta.json().catch(() => ({}));
    pensando.remove();

    if (!respuesta.ok) {
      let aviso = datos.error || `Error ${respuesta.status} del servidor.`;
      if (respuesta.status === 429) aviso += " Pulsa «Nueva conversación» para empezar de cero.";
      mostrarError(aviso, () => pedirRespuesta(texto));
      return;
    }
    // Un sesion_id distinto al guardado significa que el backend descartó la sesión anterior.
    const sesionVencida = sesionId !== null && datos.sesion_id !== sesionId;
    sesionId = datos.sesion_id;

    historial.push({ rol: "user", texto });
    if (sesionVencida) {
      agregarBurbuja("aviso", AVISO_SESION_VENCIDA);
      historial.push({ rol: "aviso", texto: AVISO_SESION_VENCIDA });
    }
    mostrarAsistente(datos.respuesta);
    historial.push({ rol: "assistant", texto: datos.respuesta });
    guardarAlmacen();
  } catch {
    pensando.remove();
    mostrarError("No se pudo conectar con el servidor.", () => pedirRespuesta(texto));
  } finally {
    fijarEnviando(false);
  }
}

function enviarMensaje(texto) {
  $mensajes.querySelector(".bienvenida")?.remove();
  agregarBurbuja("usuario", texto);
  return pedirRespuesta(texto);
}

$formulario.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const texto = $entrada.value.trim();
  if (!texto || enviando) return;
  $entrada.value = "";
  ajustarAltoEntrada();
  enviarMensaje(texto);
});

// Enter envía y Shift+Enter agrega un salto de línea.
$entrada.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
    evento.preventDefault();
    $formulario.requestSubmit();
  }
});

$entrada.addEventListener("input", ajustarAltoEntrada);
$nuevaConversacion.addEventListener("click", nuevaConversacion);

if (!restaurarConversacion()) mostrarBienvenida();
$entrada.focus();
