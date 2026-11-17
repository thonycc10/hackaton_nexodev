# SPEC 02 — Backend base del agente con Gemini y tools de lectura

> **Status:** Approved
> **Depends on:** SPEC 00, SPEC 01
> **Date:** 2026-11-13
> **Objective:** Construir un backend Node.js con Express que exponga un endpoint de chat, mantenga el historial en memoria por sesión y use Gemini con tools de solo lectura sobre las tablas simuladas de PostgreSQL.

## Por qué existe esta spec

Resuelve la decisión pendiente de la SPEC 00: stack del backend (Node.js + Express) y proveedor del LLM (Gemini API, capa gratuita de Google AI Studio, por no contar con clave de Anthropic en esta prueba de concepto). Las specs 03, 04 y 05 se montan sobre el endpoint de chat, el orquestador y la capa de tools que se crean aquí.

## Alcance

**Dentro:**

- Carpeta `backend/` con una aplicación Node.js y Express que escucha en el puerto 3000 (variable `PORT`).
- Endpoint `POST /api/chat` con respuesta JSON completa, sin streaming.
- Endpoint `GET /api/salud` que confirma que el servicio y la base de datos responden.
- Historial de conversación en memoria, por sesión. El backend crea el identificador de sesión.
- Expiración de sesión a los 30 minutos sin actividad y máximo 50 mensajes por sesión.
- Orquestador que llama a Gemini con un ciclo de tool use, mediante el endpoint compatible con OpenAI de la Gemini API y el SDK `openai`. El modelo se define en `LLM_MODEL`.
- Tres tools de solo lectura: `buscar_documentos`, `consultar_aplicativos` y `buscar_soluciones_codigo`.
- Configuración con archivo `.env` fuera de git y `.env.example` versionado.
- Pruebas manuales con `curl` y comandos del backend en `CLAUDE.md`.

**Fuera de alcance (para otras specs):**

- Interfaz web (SPEC 03).
- Tool de tickets, búsqueda de tickets similares (SPEC 04) y creación de tickets (SPEC 05).
- Streaming con SSE.
- Persistencia del historial en PostgreSQL o en cualquier otro almacenamiento.
- Pruebas automáticas.
- Agente 2 de aprovisionamiento.
- Autenticación de usuarios, límite de tasa y despliegue.
- Otros proveedores de LLM. Si exponen un endpoint compatible con OpenAI, el cambio se reduce a las variables `LLM_*`.
- Tools que escriban en la base de datos.

## Modelo de datos

Esta spec no modifica el esquema de PostgreSQL de la SPEC 01. Define estructuras en memoria y el contrato del endpoint.

```js
// Sesión en memoria (Map indexado por sesion_id)
const sesion = {
  id: "uuid-v4",
  mensajes: [/* { role: "user" | "assistant", content } */],
  ultimaActividad: 0, // epoch en milisegundos
};
```

```jsonc
// POST /api/chat — solicitud
{ "sesion_id": "uuid-opcional", "mensaje": "¿Cómo genero un ticket en producción?" }

// 200 — respuesta
{ "sesion_id": "uuid", "respuesta": "texto del asistente" }

// Errores (todos con el mismo formato)
{ "error": "descripción corta" }
// 400: "mensaje" ausente, vacío o no es texto.
// 429: la sesión ya tiene 50 mensajes.
// 502: falla la llamada al modelo (clave inválida, cuota agotada o error del proveedor).
// 500: error interno.
```

```jsonc
// GET /api/salud — 200 si todo responde, 503 si falla la base
{ "estado": "ok", "base_datos": "ok" }
```

```js
// Tools de lectura (nombres y entradas)
buscar_documentos({ consulta: "string", tipo: "modelo_operativo | proyecto (opcional)" })
consultar_aplicativos({ nombre: "string (opcional)", tipo: "api | base_datos | aplicacion (opcional)" })
buscar_soluciones_codigo({ consulta: "string", aplicativo: "string (opcional)" })
// Cada tool devuelve como máximo 5 filas de su tabla.
```

Variables de entorno (`backend/.env.example`):

```
LLM_API_KEY=
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-3.5-flash-lite
PORT=3000
PGHOST=localhost
PGPORT=5432
PGUSER=
PGPASSWORD=
PGDATABASE=nexodev
```

Convenciones:

- Mensajes de error, prompt del sistema y respuestas del asistente en español.
- Consultas SQL parametrizadas, sin concatenar texto del usuario.
- Una sesión desconocida o expirada se descarta y se crea una nueva. La respuesta devuelve el nuevo `sesion_id`.
- El ciclo de tool use se corta tras 5 iteraciones por mensaje.
- Las tools se declaran en el formato `function` de la API compatible con OpenAI. Sus nombres y entradas son los de la sección anterior.
- La clave `LLM_API_KEY` se obtiene en Google AI Studio y no se versiona.

## Plan de implementación

1. Crear `backend/package.json` (Node 20.6 o superior, dependencias `express`, `pg` y `openai`), `backend/.env.example`, `.gitignore` con `node_modules/` y `.env`, y `backend/src/server.js` con `GET /api/salud` que responde `{ "estado": "ok" }`. Prueba: `npm start` y `curl localhost:3000/api/salud` devuelve 200.
2. Crear `backend/src/db.js` con un pool de `pg` configurado por variables de entorno y hacer que `/api/salud` ejecute `SELECT 1`. Prueba: con la base encendida devuelve `base_datos: "ok"`, y con credenciales erróneas devuelve 503.
3. Crear `backend/src/sesiones.js` con el almacén en memoria (creación, lectura, expiración a 30 minutos y límite de 50 mensajes) y `POST /api/chat` con validación y una respuesta fija que repite el mensaje. Prueba: el primer `curl` devuelve un `sesion_id`, el segundo con ese id conserva la sesión y un cuerpo sin `mensaje` devuelve 400.
4. Crear `backend/src/tools/` con las tres tools de lectura y sus definiciones en formato `function`. Prueba: `node` ejecuta cada tool con un ejemplo y muestra filas de las tablas semilla.
5. Crear `backend/src/agente.js` con el prompt del sistema y el ciclo de tool use con Gemini, y conectarlo a `POST /api/chat`. Prueba: `curl` con "¿Cómo genero un ticket en producción?" devuelve una respuesta basada en un documento semilla.
6. Mapear errores a los códigos 429, 502 y 500 y agregar a `CLAUDE.md` los comandos del backend (instalar, arrancar, probar con `curl`). Prueba: con una clave inválida el endpoint devuelve 502 y los comandos de `CLAUDE.md` funcionan al copiarlos.

## Criterios de aceptación

- [ ] `cd backend && npm install && npm start` arranca el servidor sin errores y escucha en el puerto 3000.
- [ ] `GET /api/salud` devuelve 200 con `{ "estado": "ok", "base_datos": "ok" }` con la base `nexodev` encendida.
- [ ] `GET /api/salud` devuelve 503 cuando las credenciales de PostgreSQL son incorrectas.
- [ ] `POST /api/chat` sin `sesion_id` devuelve 200 con un `sesion_id` en formato UUID y un campo `respuesta` de texto.
- [ ] Un segundo `POST /api/chat` con el mismo `sesion_id` devuelve el mismo `sesion_id`, y la respuesta tiene en cuenta el mensaje anterior.
- [ ] `POST /api/chat` con un `sesion_id` desconocido devuelve 200 con un `sesion_id` nuevo.
- [ ] `POST /api/chat` con `mensaje` vacío o ausente devuelve 400 con un campo `error`.
- [ ] Una sesión con 50 mensajes devuelve 429 en el siguiente envío.
- [ ] Una sesión sin actividad por más de 30 minutos se descarta. La prueba reduce el tiempo de expiración con una variable de entorno y confirma que el `sesion_id` cambia.
- [ ] La pregunta "¿Cómo genero un ticket en producción?" produce una respuesta que menciona `ambiente produccion` o el procedimiento del documento semilla correspondiente.
- [ ] La pregunta "¿Quién es el equipo responsable de api-pagos?" produce una respuesta que menciona "Equipo Pagos".
- [ ] La pregunta "¿Hay una solución de código para el error 500 de api-personas?" produce una respuesta que menciona una solución semilla de `api-personas`.
- [ ] Con `LLM_API_KEY` inválida, `POST /api/chat` devuelve 502 con un campo `error` y el servidor sigue respondiendo.
- [ ] Ninguna tool ejecuta `INSERT`, `UPDATE`, `DELETE` ni DDL (verificable leyendo `backend/src/tools/`).
- [ ] `backend/.env` no aparece en `git status` y `backend/.env.example` sí está versionable.
- [ ] `CLAUDE.md` contiene los comandos del backend y funcionan al copiarlos.

## Decisiones

- **Sí:** Node.js con Express. Es el mismo lenguaje que la interfaz HTML + JS y reduce el número de ecosistemas del MVP.
- **No:** Python con FastAPI y Java con Spring Boot. Agregan un segundo lenguaje o más peso del necesario para el MVP.
- **Sí:** Gemini API (capa gratuita de Google AI Studio) mediante su endpoint compatible con OpenAI y el SDK `openai`. El equipo no tiene clave de Anthropic y el MVP es una prueba de concepto. Gemini ofrece tool use, que encaja con una tool por fuente de datos (SPEC 00).
- **Sí:** proveedor, URL y modelo configurables con `LLM_API_KEY`, `LLM_BASE_URL` y `LLM_MODEL`. Cambiar de proveedor con endpoint compatible con OpenAI no toca el código.
- **No:** Claude API. Era la decisión anterior de esta spec y se descartó porque no hay clave disponible. Se puede retomar con un cliente propio de Anthropic.
- **No:** Ollama local, Groq y OpenRouter. Se evaluaron como alternativas gratuitas. Se eligió Gemini por su calidad de tool use sin instalar nada.
- **No:** Azure OpenAI y un modo sin LLM. El MVP necesita razonamiento sobre los datos.
- **Sí:** modelo `gemini-3.5-flash-lite`. El equipo pidió inicialmente `gemini-2.5-flash-lite`, pero la API responde 404 ("no longer available to new users") y recomienda este modelo. Se probó con las tres preguntas de los criterios de aceptación y respondió bien. Es una variante Flash-Lite, que según reportes de usuarios tiene más cuota gratuita diaria que Flash.
- **No:** `gemini-2.5-flash-lite`. No está disponible para cuentas nuevas aunque aparezca en la lista de modelos.
- **Pendiente:** cuota gratuita real de `gemini-3.5-flash-lite`. Los límites de la capa gratuita cambian y no se verificaron. Se revisan en Google AI Studio si aparece un error de cuota.
- **Sí:** respuesta JSON completa. Es más simple de implementar y de probar con `curl`. El streaming SSE queda para otra spec.
- **Sí:** historial en memoria por sesión, con identificador creado por el backend. Evita tablas nuevas. La interfaz solo guarda el `sesion_id`.
- **No:** historial enviado por el cliente y tabla en PostgreSQL. El equipo prefirió el estado en el backend y no modificar el esquema de la SPEC 01.
- **Sí:** expiración a 30 minutos y máximo 50 mensajes. La memoria del proceso no crece sin límite.
- **Sí:** tres tools de lectura (documentos, aplicativos y soluciones de código). Respeta la tabla de responsabilidades de la SPEC 00. Las tools de tickets son de las SPEC 04 y 05.
- **Sí:** `backend/` en el puerto 3000. Separa el backend de `db/` y de la interfaz de la SPEC 03.
- **Sí:** `.env` fuera de git y `.env.example` versionado. Protege la clave del LLM y las credenciales de PostgreSQL.
- **Sí:** carga del `.env` con `node --env-file=.env`. Evita agregar la dependencia `dotenv`.
- **Sí:** búsqueda en documentos y soluciones con `ILIKE` sobre texto y título. La SPEC 01 dejó fuera el full-text de esas tablas.
- **No:** pruebas automáticas. El equipo eligió pruebas manuales con `curl` para el MVP. Se pueden agregar en otra spec.

## Riesgos

| Riesgo                                                          | Mitigación                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| La SPEC 01 no está completamente implementada (falta su paso 7) | Verificar que `nexodev` tenga las cuatro tablas con datos antes del paso 4           |
| Falta `psql` local y PostgreSQL corre en Docker                 | El backend usa el puerto 5432 de `localhost`. No depende de `psql`                   |
| Node menor a 20.6 no soporta `--env-file`                       | Declarar `engines` en `package.json` y verificar con `node -v` en el paso 1          |
| Las sesiones se pierden al reiniciar el backend                 | Aceptado para el MVP. La interfaz recibe un `sesion_id` nuevo y empieza de cero      |
| El LLM inventa datos que no están en las tablas                 | El prompt del sistema pide responder solo con lo que devuelven las tools             |
| La capa gratuita de Gemini limita las solicitudes por día y cada mensaje usa varias llamadas al modelo | Elegir un modelo con más cuota, limitar a 5 rondas de tools por mensaje y devolver 502 con un mensaje claro al agotarse la cuota |
| El endpoint compatible con OpenAI de Gemini soporta solo parte de las funciones y puede fallar en tool calls de varios turnos | Probar el ciclo de tools en el paso 5. Si falla, cambiar de modelo o de proveedor con las variables `LLM_*` |
| Los datos enviados a una capa gratuita pueden usarse para mejorar los productos del proveedor | El MVP usa solo datos simulados. No conectar datos reales sin revisar los términos |
| Gasto de cuota sin límites de uso                               | Máximo 50 mensajes por sesión y 5 rondas de tools por mensaje                        |
| Una pregunta del usuario manipula las consultas SQL             | Consultas parametrizadas y tools de solo lectura                                     |

## Lo que **no** está en esta spec

- Interfaz web.
- Tool de tickets, tickets similares y creación de tickets.
- Streaming SSE.
- Persistencia del historial.
- Pruebas automáticas.
- Agente 2 de aprovisionamiento.
- Autenticación, límite de tasa y despliegue.
- Tools que escriban en la base de datos.
