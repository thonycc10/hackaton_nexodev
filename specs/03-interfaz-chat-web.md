# SPEC 03 — Interfaz web de chat

> **Status:** Approved
> **Depends on:** SPEC 00, SPEC 02
> **Date:** 2026-11-13
> **Objective:** Construir una interfaz web de chat en HTML, CSS y JavaScript planos, servida por el backend existente, que permita conversar con el agente a través de `POST /api/chat`.

## Por qué existe esta spec

El README pide una interfaz web en HTML y JS, similar a Claude, como punto de entrada para las consultas. La SPEC 02 dejó el endpoint de chat listo y probado solo con `curl`. Esta spec le da una cara usable y fija cómo se manejan sesiones vencidas y errores en el navegador.

## Alcance

**Dentro:**

- Carpeta `frontend/` con `index.html`, `styles.css` y `app.js`, sin proceso de compilación.
- Servicio de `frontend/` desde el backend existente con `express.static`, en `http://localhost:3000/`.
- Una conversación por pantalla: área de mensajes, caja de texto y botón **Nueva conversación**.
- Envío con `Enter` y salto de línea con `Shift+Enter`.
- Estado "Pensando…" mientras se espera la respuesta, con la caja de texto y el botón de envío deshabilitados.
- Respuestas del asistente en Markdown, renderizadas con `marked` y saneadas con `DOMPurify`, copiadas a `frontend/vendor/`.
- Mensajes del usuario como texto literal, nunca como HTML ni Markdown.
- Pantalla de bienvenida con un saludo y 3 preguntas de ejemplo clicables.
- Errores del backend (400, 429, 502, 500 y red caída) en una burbuja de error con botón **Reintentar**.
- Restauración de la conversación al recargar, con `localStorage`, y aviso en el chat cuando la sesión del backend venció.
- Tema claro único.
- Comandos y estructura de `frontend/` en `CLAUDE.md`.

**Fuera de alcance (para otras specs):**

- Barra lateral con historial de varias conversaciones.
- Streaming de la respuesta (SSE) y cancelar una respuesta en curso.
- Tema oscuro, selector de tema y diseño optimizado para móviles.
- Endpoint para cerrar la sesión en el backend: **Nueva conversación** solo descarta la sesión en el navegador y el backend la expira sola.
- Búsqueda de tickets similares (SPEC 04) y creación de tickets desde el chat (SPEC 05).
- Autenticación de usuarios.
- Pruebas automáticas.
- Empaquetadores, frameworks de JavaScript y CDN.

## Modelo de datos

Esta spec no modifica el esquema de PostgreSQL ni el contrato de la API de la SPEC 02. Define el estado de la interfaz y lo que se guarda en el navegador.

```js
// localStorage["nexodev:chat:v1"] — se escribe como JSON
{
  sesionId: "uuid" | null,   // el último sesion_id devuelto por el backend
  mensajes: [
    { rol: "user" | "assistant" | "aviso", texto: "..." },
  ],
}
```

Convenciones:

- La clave lleva `:v1`. Si el formato cambia, se sube la versión y se ignora el contenido anterior.
- Solo se guardan los intercambios completados. Un mensaje cuyo envío falló no se guarda.
- Los errores y el estado "Pensando…" no se guardan.
- Todo acceso a `localStorage` va en `try/catch`. Si falla, la interfaz funciona igual sin restaurar.
- El texto del asistente se guarda como Markdown, sin sanear. El saneado ocurre al mostrarlo.
- Las preguntas de ejemplo son:
  1. "¿Cómo genero un ticket en producción?"
  2. "¿Quién es el equipo responsable de api-pagos?"
  3. "¿Hay una solución de código para el error 500 de api-personas?"

Estados de la pantalla:

| Estado        | Qué se ve                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------ |
| Vacío         | Saludo y 3 preguntas de ejemplo. La caja de texto está habilitada.                         |
| Conversación  | Burbujas de usuario y asistente. Se desplaza al último mensaje.                            |
| Enviando      | Burbuja "Pensando…". Caja de texto y botón de envío deshabilitados.                        |
| Error         | Burbuja de error con el texto del campo `error` y el botón **Reintentar**.                 |
| Sesión llena  | Burbuja de error del 429 con el texto del backend y la sugerencia de pulsar **Nueva conversación**. |

Comportamientos:

- **Reintentar** reenvía el mismo texto sin duplicar la burbuja del usuario.
- Si la respuesta trae un `sesion_id` distinto al guardado y el guardado no era `null`, se inserta un mensaje de tipo `aviso` antes de la respuesta: "La sesión anterior expiró: el asistente no recuerda los mensajes previos."
- **Nueva conversación** borra `nexodev:chat:v1`, vacía la pantalla y vuelve al estado Vacío.
- Si el backend no responde, el error dice que no se pudo conectar con el servidor.

## Plan de implementación

1. Crear `frontend/index.html` con un título y un contenedor vacío, y servir `frontend/` desde `backend/src/server.js` con `express.static`. Prueba: `http://localhost:3000/` muestra la página y `GET /api/salud` sigue devolviendo 200.
2. Crear `frontend/styles.css` y el layout en `index.html`: encabezado con el botón **Nueva conversación**, área de mensajes y formulario con caja de texto y botón. Prueba: la página se ve con el layout, sin funcionalidad.
3. Crear `frontend/app.js` con el envío a `POST /api/chat`, burbujas de usuario y asistente en texto, estado "Pensando…", `Enter` y `Shift+Enter`, y el `sesion_id` en memoria. Prueba: una pregunta real recibe respuesta y la segunda conserva el contexto.
4. Copiar `marked` y `DOMPurify` a `frontend/vendor/` y mostrar las respuestas del asistente como Markdown saneado. Prueba: una respuesta con negritas y listas se ve formateada, y el texto del usuario `<b>hola</b>` se ve literal.
5. Agregar la pantalla de bienvenida con las 3 preguntas de ejemplo clicables y el funcionamiento de **Nueva conversación**. Prueba: clic en un ejemplo envía la pregunta, y el botón vuelve a la bienvenida.
6. Agregar la burbuja de error con **Reintentar**, incluido el caso del 429. Prueba: con el backend detenido aparece el error de conexión y, al encenderlo y pulsar **Reintentar**, llega la respuesta.
7. Guardar y restaurar la conversación con `nexodev:chat:v1`, y mostrar el aviso de sesión vencida. Prueba: recargar conserva los mensajes, y reiniciar el backend antes de enviar otro mensaje inserta el aviso.
8. Agregar a `CLAUDE.md` la URL de la interfaz y la estructura de `frontend/`. Prueba: abrir la URL indicada en `CLAUDE.md` muestra la interfaz.

## Criterios de aceptación

- [ ] Con `npm start` en `backend/`, `http://localhost:3000/` muestra la interfaz de chat sin errores en la consola del navegador.
- [ ] `GET /api/salud` y `POST /api/chat` siguen funcionando igual que antes de la spec.
- [ ] Con la conversación vacía se ve el saludo y las 3 preguntas de ejemplo.
- [ ] Hacer clic en una pregunta de ejemplo la envía y muestra la respuesta del asistente.
- [ ] Mientras se espera la respuesta aparece "Pensando…" y la caja de texto y el botón de envío están deshabilitados.
- [ ] `Enter` envía el mensaje y `Shift+Enter` agrega un salto de línea.
- [ ] Un mensaje vacío o solo con espacios no se envía.
- [ ] Un segundo mensaje en la misma conversación recibe una respuesta que tiene en cuenta el primero.
- [ ] Una respuesta del asistente con negritas o listas se ve formateada.
- [ ] El mensaje de usuario `<b>hola</b>` se ve como ese texto literal, sin negrita.
- [ ] `frontend/app.js` pasa todo el HTML del asistente por `DOMPurify` antes de insertarlo.
- [ ] La interfaz no carga ningún archivo desde un dominio externo (revisable en la pestaña Red del navegador).
- [ ] Con el backend detenido, enviar un mensaje muestra una burbuja de error y el botón **Reintentar**.
- [ ] Al encender el backend y pulsar **Reintentar**, llega la respuesta y la burbuja del usuario no se duplica.
- [ ] Una sesión con 50 mensajes muestra el error del 429 con la sugerencia de pulsar **Nueva conversación**.
- [ ] Recargar la página restaura los mensajes de la conversación.
- [ ] Reiniciar el backend y enviar otro mensaje inserta el aviso "La sesión anterior expiró: el asistente no recuerda los mensajes previos." y conserva el historial visible.
- [ ] **Nueva conversación** vacía la pantalla, vuelve a la bienvenida y borra la clave `nexodev:chat:v1` de `localStorage`.
- [ ] Con `localStorage` bloqueado, la interfaz funciona sin restaurar la conversación.
- [ ] `CLAUDE.md` indica la URL de la interfaz y la estructura de `frontend/`.

## Decisiones

- **Sí:** `frontend/` servida por el mismo Express con `express.static`. Una sola URL, un solo proceso y sin CORS.
- **No:** servidor estático aparte. Exigiría CORS y dos procesos para un MVP.
- **Sí:** Markdown con `marked` y `DOMPurify`, copiados a `frontend/vendor/`. Gemini responde en Markdown y el saneado evita XSS. No depende de internet.
- **No:** CDN y texto plano. El CDN rompe la interfaz sin conexión y el texto plano muestra los asteriscos del Markdown.
- **Sí:** una conversación por pantalla con el botón **Nueva conversación**. El backend guarda cada sesión solo 30 minutos en memoria.
- **No:** barra lateral con historial. No se podrían retomar conversaciones viejas porque el backend las descarta.
- **Sí:** restaurar con `localStorage` bajo la clave versionada `nexodev:chat:v1`. Lo eligió el equipo, aunque pueda quedar desincronizado con el backend.
- **Sí:** aviso en el chat cuando el `sesion_id` cambia, conservando el historial visible. Evita que el usuario crea que el asistente recuerda lo anterior.
- **No:** borrar el historial en silencio ni continuar sin avisar. Ambos ocultan la pérdida de contexto.
- **Sí:** guardar solo los intercambios completados. Un envío fallido no deja un mensaje huérfano tras recargar.
- **Sí:** saludo y 3 preguntas de ejemplo clicables. Muestran qué se puede preguntar y coinciden con las pruebas de la SPEC 02.
- **Sí:** burbuja de error con **Reintentar**, usando el texto del campo `error` del backend.
- **Sí:** tema claro único. Evita el trabajo de un segundo tema en un MVP.
- **No:** endpoint de cierre de sesión. **Nueva conversación** no avisa al backend, y la sesión vieja expira sola.
- **Sí:** el texto del usuario se inserta con `textContent`. Nunca se interpreta como HTML ni Markdown.
- **Sí:** `Enter` envía y `Shift+Enter` salta de línea, como en Claude y en otros chats.
- **Sí:** verificación manual en el navegador. No hay pruebas automáticas en el MVP, igual que en la SPEC 02.

## Riesgos

| Riesgo                                                                      | Mitigación                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| XSS por HTML en la respuesta del modelo                                     | `DOMPurify` sobre todo el HTML del asistente y `textContent` para el texto del usuario          |
| El historial restaurado no coincide con la memoria del backend              | Aviso en el chat cuando el `sesion_id` cambia                                                   |
| `localStorage` desactivado o lleno                                          | `try/catch` en cada acceso. La interfaz sigue funcionando sin restaurar                         |
| Versiones de `marked` o `DOMPurify` con vulnerabilidades                    | Copiar versiones fijas a `frontend/vendor/` y anotar la versión en el nombre del archivo        |
| La cuota gratuita de Gemini se agota y todos los mensajes fallan            | La interfaz muestra el error del 502 y permite reintentar más tarde                             |
| Una respuesta larga del modelo bloquea la caja de texto por mucho tiempo    | Aceptado en el MVP. Cancelar la respuesta queda para otra spec                                  |
| Servir `frontend/` desde Express expone archivos no previstos               | `express.static` apunta solo a `frontend/` y no a la raíz del repositorio                       |

## Lo que **no** está en esta spec

- Barra lateral con historial de conversaciones.
- Streaming de respuestas y cancelar una respuesta en curso.
- Tema oscuro, selector de tema y diseño para móviles.
- Cerrar la sesión en el backend.
- Búsqueda de tickets similares y creación de tickets.
- Autenticación de usuarios.
- Pruebas automáticas, empaquetadores y frameworks de JavaScript.
