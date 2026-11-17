# SPEC 05 — Creación de tickets desde el agente

> **Status:** Approved
> **Depends on:** SPEC 01, SPEC 02, SPEC 04
> **Date:** 2026-11-13
> **Objective:** Permitir que el agente cree un ticket en la tabla `tickets` a partir de una conversación, presentando antes una plantilla preliminar que el usuario debe revisar y confirmar con un mensaje.

## Por qué existe esta spec

Es el Agente 1 del README: conversar con el usuario para registrar un problema como ticket con detalle del problema, equipo, evidencias, aplicativo, ambiente y solución. Es la primera función del agente que escribe en la base de datos, por eso la confirmación del usuario la exige el código del backend y no solo el prompt.

## Alcance

**Dentro:**

- Dos tools nuevas en `backend/src/tools/tickets.js`, registradas en `backend/src/tools/index.js`:
  - `proponer_ticket`: valida los datos, guarda un borrador en la sesión y devuelve el borrador. No escribe en la base.
  - `crear_ticket`: inserta en `tickets` el borrador guardado. No recibe datos del modelo.
- Confirmación exigida por código: `crear_ticket` solo funciona si el usuario envió un mensaje después de que se guardó el borrador.
- Máximo 3 tickets creados por sesión.
- El agente extrae del mensaje del usuario lo que ya contó y pregunta solo lo que falta.
- El agente presenta el ticket como una plantilla preliminar en Markdown, con los 6 campos y el título, para que el usuario la revise.
- El detalle de la solución lo propone el agente con base en tickets y soluciones de código similares, ya redactado en la plantilla.
- El equipo responsable se toma del aplicativo en el portal (`apis_proyectos.equipo_responsable`).
- Las evidencias son opcionales.
- El ticket nace con estado `abierto` y se identifica con la clave `NEXO-<id>` de la SPEC 04.
- Cambios en `backend/src/sesiones.js`, `backend/src/server.js` y `backend/src/agente.js` para dar a las tools acceso a la sesión.
- Actualización de `CLAUDE.md`.

**Fuera de alcance (para otras specs):**

- Botón de confirmación en la interfaz y cualquier cambio de `frontend/` o del contrato de `POST /api/chat`.
- Editar, cerrar o borrar tickets existentes.
- Agente 2 de aprovisionamiento.
- Integración con Jira real.
- Detección de tickets duplicados, más allá de mostrar los similares de la SPEC 04.
- Autenticación y autoría del ticket (quién lo creó).
- Adjuntar archivos como evidencias: las evidencias son texto.
- Pruebas automáticas.

## Modelo de datos

Esta spec no modifica el esquema de PostgreSQL: inserta filas en la tabla `tickets` de la SPEC 01. Extiende la sesión en memoria de la SPEC 02 y define el contrato de las dos tools.

```js
// Sesión en memoria: se agregan tres campos a la estructura de la SPEC 02
const sesion = {
  id: "uuid-v4",
  mensajes: [/* { role, content } */],
  ultimaActividad: 0,
  turno: 0,             // se incrementa en 1 con cada mensaje del usuario
  borrador: null,       // { titulo, detalle_problema, equipo_responsable, aplicativo_id, aplicativo,
                        //   ambiente, evidencias, detalle_solucion, turno } | null
  ticketsCreados: 0,    // tickets creados en esta sesión
};
```

```js
// proponer_ticket: guarda el borrador y lo devuelve. No escribe en la base.
proponer_ticket({
  titulo: "string",                 // obligatorio, máximo 200 caracteres
  detalle_problema: "string",       // obligatorio, máximo 4000 caracteres
  aplicativo: "string",             // obligatorio: nombre exacto de apis_proyectos, sin distinguir mayúsculas
  ambiente: "certificacion | produccion",   // obligatorio
  detalle_solucion: "string (opcional)",    // máximo 4000 caracteres
  evidencias: "string (opcional)",          // máximo 4000 caracteres
})
// Devuelve el borrador con el equipo responsable ya resuelto:
{ borrador: { titulo, detalle_problema, equipo_responsable, aplicativo, ambiente,
              evidencias, detalle_solucion, estado: "abierto" } }

// crear_ticket: sin entrada. Inserta el borrador guardado.
crear_ticket()
// Devuelve el ticket creado, con el mismo formato que buscar_tickets_similares:
{ ticket: { clave: "NEXO-105", titulo, detalle_problema, equipo_responsable, aplicativo,
            ambiente, estado: "abierto", detalle_solucion, evidencias, creado_en, similitud: null } }
```

Reglas de las tools (todas lanzan un error en español que vuelve al modelo como resultado de la tool):

- `proponer_ticket` rechaza campos obligatorios ausentes o vacíos, textos más largos que el máximo, un `ambiente` fuera del enum y un `aplicativo` que no existe en `apis_proyectos`.
- `proponer_ticket` reemplaza cualquier borrador anterior de la sesión. El borrador guarda el `turno` en que se propuso.
- `crear_ticket` rechaza la creación si:
  - la sesión no tiene borrador;
  - `sesion.turno` no es mayor que `borrador.turno` (el usuario no ha enviado un mensaje después de la propuesta);
  - la sesión ya creó 3 tickets.
- `crear_ticket` inserta con estado `abierto`, usa `evidencias` y `detalle_solucion` en `NULL` cuando no hay, borra el borrador antes de insertar y lo restaura si el `INSERT` falla.
- El insert va parametrizado y es la única escritura en la base de todo el backend.
- La clave `NEXO-<id>` se calcula al leer, igual que en la SPEC 04.

Convenciones:

- Todo mensaje del usuario incrementa `sesion.turno` antes de llamar al agente. Las rondas de tools de un mismo mensaje comparten el mismo `turno`.
- Las tools reciben la sesión como contexto: `ejecutarTool(nombre, entrada, { sesion })`.
- El borrador vive solo en memoria y desaparece con la sesión.
- Plantilla preliminar que presenta el agente (Markdown):
  1. Título "Borrador de ticket".
  2. Los 7 datos: título, aplicativo, ambiente, equipo responsable, detalle del problema, evidencias y detalle de la solución. Una evidencia vacía se muestra como "Sin evidencias".
  3. Una pregunta final para confirmar la creación o pedir cambios.
- El agente muestra en la plantilla exactamente los datos que devolvió `proponer_ticket`.
- Si el usuario pide cambios, el agente vuelve a llamar a `proponer_ticket` y muestra la plantilla nueva. Hace falta otro mensaje del usuario para confirmar.

## Plan de implementación

1. Agregar `turno`, `borrador` y `ticketsCreados` a la sesión en `backend/src/sesiones.js`. En `backend/src/server.js` incrementar `turno` con cada mensaje y pasar la sesión a `responder`. En `backend/src/agente.js` pasar `{ sesion }` a `ejecutarTool`, y en `backend/src/tools/index.js` aceptar el contexto. Prueba: un script de `node` comprueba que `turno` sube con cada mensaje, y el chat sigue respondiendo igual que antes.
2. Crear `proponer_ticket` en `backend/src/tools/tickets.js` y registrarla en `backend/src/tools/index.js`. Prueba: un script de `node` con una sesión simulada comprueba el borrador, el equipo tomado del portal y cada rechazo de validación, y que `tickets` no cambia.
3. Crear `crear_ticket` en `backend/src/tools/tickets.js` y registrarla. Prueba: el script comprueba el rechazo sin borrador y en el mismo turno, la creación en un turno posterior con la fila correcta en la base, el rechazo del cuarto ticket de la sesión y que se borren los tickets de prueba.
4. Actualizar el prompt del sistema en `backend/src/agente.js` con el flujo de creación: extraer datos, preguntar lo que falta, proponer la solución con base en similares, presentar la plantilla y crear solo tras la confirmación del usuario. Prueba: un script con `POST /api/chat` recorre el flujo completo contra Gemini y comprueba que la fila se crea solo después del segundo mensaje.
5. Actualizar `CLAUDE.md` con las tools de creación y la regla de confirmación por turno. Prueba: `CLAUDE.md` ya no dice que la creación de tickets está pendiente.

## Criterios de aceptación

- [ ] `definiciones` contiene `proponer_ticket` y `crear_ticket`, además de las cuatro tools anteriores.
- [ ] Una sesión nueva tiene `turno` 0, `borrador` nulo y `ticketsCreados` 0, y `turno` sube en 1 con cada mensaje del usuario.
- [ ] `proponer_ticket` con datos válidos devuelve el borrador con `equipo_responsable` igual al del aplicativo en `apis_proyectos`, y no inserta ninguna fila en `tickets`.
- [ ] `proponer_ticket` lanza un error con título vacío, `detalle_problema` vacío, `ambiente` `desarrollo`, aplicativo inexistente y textos que superan el máximo.
- [ ] Proponer un segundo borrador reemplaza al primero.
- [ ] `crear_ticket` lanza un error si no hay borrador.
- [ ] `crear_ticket` lanza un error si se llama en el mismo turno en que se propuso el borrador, y no inserta ninguna fila.
- [ ] `crear_ticket` en un turno posterior inserta exactamente una fila en `tickets` con `estado` `abierto`, el equipo del portal y los datos del borrador, y devuelve su clave `NEXO-<id>` con un `id` que existe en la tabla.
- [ ] Tras crear, el borrador de la sesión es nulo, y llamar de nuevo a `crear_ticket` lanza un error.
- [ ] Una sesión que ya creó 3 tickets rechaza un cuarto y `tickets` no cambia.
- [ ] El borrador de una sesión no es visible desde otra sesión.
- [ ] Un ticket creado sin `evidencias` ni `detalle_solucion` queda con `NULL` en ambas columnas.
- [ ] Si el `INSERT` falla, el borrador se restaura y la tool lanza un error.
- [ ] El ticket creado aparece en `buscar_tickets_similares` con la misma clave.
- [ ] `INSERT` solo aparece en `crear_ticket`: ninguna otra tool de `backend/src/tools/` escribe en la base (verificable leyendo el código).
- [ ] En el chat, al describir un problema y pedir un ticket, el agente presenta una plantilla con título, aplicativo, ambiente, equipo, detalle del problema, evidencias y solución, y `tickets` sigue con el mismo número de filas.
- [ ] Al responder "sí, créalo" en un mensaje posterior, se inserta una fila cuyos datos coinciden con la plantilla, y la respuesta menciona su clave `NEXO-<id>`.
- [ ] Si en un solo mensaje el usuario da todos los datos y pide crear el ticket, el agente solo presenta la plantilla y `tickets` no cambia hasta el mensaje siguiente.
- [ ] El esquema de PostgreSQL, `POST /api/chat` y `frontend/` no cambian respecto a la SPEC 04.
- [ ] `CLAUDE.md` describe las tools de creación, la regla de confirmación por turno y el límite de 3 tickets por sesión.

## Decisiones

- **Sí:** el agente extrae los datos que el usuario ya dio y pregunta solo lo que falta. Evita 6 preguntas fijas cuando el usuario ya contó el problema.
- **No:** preguntar campo por campo en orden fijo. Es más predecible, pero tedioso.
- **Sí:** presentar el ticket como plantilla preliminar que el usuario revisa. Es lo que pidió el equipo y da un punto claro de confirmación.
- **Sí:** la solución la propone el agente con base en tickets y soluciones similares. Es el sentido del README ("generar un ticket basado en errores similares").
- **No:** que la escriba el usuario o que quede vacía. Se pierde el valor de reutilizar soluciones previas.
- **Sí:** dos tools, `proponer_ticket` y `crear_ticket`, con la confirmación exigida por el backend (un mensaje del usuario entre ambas). No depende de que el modelo obedezca el prompt, y es una escritura en la base.
- **No:** confirmación solo por prompt, y botón de confirmación en la interfaz. Lo primero es menos seguro, y lo segundo exige cambiar `POST /api/chat` y `frontend/`, fuera de esta spec.
- **Sí:** `crear_ticket` no recibe datos del modelo: crea exactamente el borrador que se propuso. Así lo creado coincide con lo que el usuario vio.
- **Sí:** el equipo responsable sale del aplicativo en el portal. Evita equipos inventados y una pregunta más.
- **Sí:** evidencias opcionales. Lo eligió el equipo. Una evidencia ausente queda como `NULL` y la plantilla la muestra como "Sin evidencias".
- **Sí:** máximo 3 tickets por sesión. Protege la tabla de un ciclo descontrolado del modelo o de un uso abusivo.
- **Sí:** estado inicial `abierto`. Es el valor por defecto de la tabla y el estado natural de un ticket recién registrado.
- **Sí:** `detalle_solucion` y `evidencias` opcionales en las tools, con la regla del prompt de proponer siempre una solución. Si no hay base para proponerla, el ticket nace sin ella.
- **Sí:** límites de longitud (200 y 4000 caracteres). Evitan filas enormes y gasto de tokens al leerlas después.
- **Sí:** reutilizar la clave `NEXO-<id>` de la SPEC 04, calculada al leer.
- **Sí:** el borrador se borra antes de insertar y se restaura si el `INSERT` falla. Una segunda solicitud simultánea de la misma sesión no duplica el ticket.
- **No:** autoría del ticket ni autenticación. Es un MVP sin usuarios.
- **Sí:** verificación manual con scripts de `node` y `POST /api/chat`, igual que en las specs anteriores.

## Riesgos

| Riesgo                                                                                       | Mitigación                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| El modelo llama a `proponer_ticket` y `crear_ticket` en el mismo mensaje                     | El backend rechaza `crear_ticket` si no hubo un mensaje del usuario después del borrador                     |
| El usuario responde algo que no es una confirmación y el modelo crea el ticket igual          | Aceptado en el MVP: el código exige un mensaje, no su contenido. El prompt pide una confirmación explícita   |
| La plantilla que muestra el modelo difiere del borrador guardado                             | El prompt exige mostrar exactamente los datos de `proponer_ticket`, y un criterio compara plantilla y fila   |
| El borrador se pierde si la sesión expira (30 minutos) o el backend se reinicia              | Aceptado. El agente vuelve a proponer el borrador si el usuario confirma y no hay uno guardado              |
| Tickets creados por pruebas llenan la tabla y avanzan la secuencia del `id`                  | Los scripts de prueba borran sus tickets. Recargar `db/seed.sql` limpia todo                                 |
| Recargar `db/seed.sql` borra los tickets creados desde el chat                                | Documentado en `CLAUDE.md`                                                                                   |
| Cualquiera con acceso a la URL puede crear tickets                                           | Aceptado en el MVP. El límite de 3 por sesión acota el daño. La autenticación queda para otra spec          |
| Cada ticket creado exige varias llamadas al modelo y la cuota gratuita de Gemini es limitada | Mantener el límite de 5 rondas de tools por mensaje y devolver el 502 con mensaje claro al agotarse la cuota |
| Dos solicitudes simultáneas de la misma sesión crean dos tickets                             | El borrador se borra antes de insertar: la segunda solicitud no encuentra borrador                           |

## Lo que **no** está en esta spec

- Botón de confirmación u otro cambio en la interfaz web o en `POST /api/chat`.
- Editar, cerrar o borrar tickets existentes.
- Agente 2 de aprovisionamiento.
- Integración con Jira real.
- Detección de duplicados más allá de los similares de la SPEC 04.
- Autenticación y autoría de los tickets.
- Evidencias como archivos adjuntos.
- Pruebas automáticas.
