# SPEC 08 — Creación de tickets sobre jira_tickets

> **Status:** Approved
> **Depends on:** SPEC 02, SPEC 05, SPEC 06, SPEC 07
> **Date:** 2026-11-13
> **Objective:** Reactivar la creación de tickets del agente, reconstruida sobre `nexo_dev_bcp.jira_tickets`, con plantilla preliminar, confirmación exigida por el backend y códigos nuevos `ITMS-XXXX`.

## Por qué existe esta spec

La SPEC 05 creaba tickets en la tabla `public.tickets` de la base `nexodev`, que ya no existe para el backend. La SPEC 06 desregistró `proponer_ticket` y `crear_ticket` y dejó su código inactivo en `backend/src/tools/creacion.js`. Esta spec no reemplaza a la SPEC 05: la mantiene como historial y adapta su diseño a la estructura de `jira_tickets`, que cambia varias cosas:

- La clave `codigo_ticket` es texto y no tiene secuencia. Los tickets nuevos usan el formato `ITMS-XXXX`.
- `tipo` es `WO` (solicitud en QA) u `OCD` (cambio en Producción), y `ambiente` es `QA` o `Producción`.
- `grupo_resolutor` es obligatorio y solo admite 6 grupos.
- No hay columnas de solución ni de evidencias: todo va en `descripcion`.
- El estado inicial es `Registrado`.

Lo que se conserva de la SPEC 05: el borrador en la sesión, la confirmación por turno exigida por código, el límite por sesión y la regla de que `server.js` descarta un borrador propuesto en un turno que terminó en error.

## Alcance

**Dentro:**

- Reescritura de `backend/src/tools/creacion.js` sobre `nexo_dev_bcp.jira_tickets` y su registro en `backend/src/tools/index.js`:
  - `proponer_ticket`: valida los datos, guarda un borrador en la sesión y lo devuelve. No escribe en la base.
  - `crear_ticket`: inserta en `jira_tickets` el borrador guardado. No recibe datos del modelo.
- Confirmación exigida por código: `crear_ticket` solo funciona si el usuario envió un mensaje después de que se guardó el borrador.
- Máximo 3 tickets creados por sesión.
- Generación del `codigo_ticket` en el formato `ITMS-XXXX` dentro de la misma transacción del `INSERT`.
- `tipo` derivado del ambiente: `QA` → `WO`, `Producción` → `OCD`.
- `grupo_resolutor` propuesto por el agente con base en tickets e incidentes similares y confirmado por el usuario en la plantilla.
- Problema, evidencias y solución propuesta se arman como secciones de `descripcion`.
- El agente extrae lo que el usuario ya contó, pregunta solo lo que falta, y presenta una plantilla preliminar en Markdown.
- Prompt del sistema en `backend/src/agente.js`: el flujo de creación reemplaza a "no puedes crear tickets".
- Actualización de `CLAUDE.md`.

**Fuera de alcance (para otras specs):**

- Crear incidentes en `jira_incidentes` (el ticket es siempre una fila de `jira_tickets`).
- Botón de confirmación en la interfaz y cualquier cambio de `frontend/` o del contrato de `POST /api/chat`.
- Editar, cerrar o borrar tickets.
- Agente 2 de aprovisionamiento.
- Integración con Jira real.
- Detección de duplicados, más allá de mostrar los tickets similares.
- Autenticación y autoría del ticket.
- Adjuntar archivos como evidencias: son texto.
- Modificar `db/nexo_dev_bcp_postgresql.sql` o agregar columnas a `jira_tickets`.
- Cambios en `sesiones.js` (los campos `turno`, `borrador` y `ticketsCreados` ya existen) y en el flujo de `server.js`.
- Pruebas automáticas.

## Modelo de datos

No cambia el esquema. Se insertan filas en `nexo_dev_bcp.jira_tickets`, cuyas columnas son: `codigo_ticket` (PK, texto), `codigo_aplicacion`, `tipo` (`WO` | `OCD`), `ambiente`, `url`, `titulo`, `descripcion`, `grupo_resolutor`, `estado` (`Registrado` | `En Procesado` | `Terminado`), `creado_en` (por defecto `now()`) y `busqueda` (generada).

Cómo se llena cada columna al crear:

| Columna | Valor |
| --- | --- |
| `codigo_ticket` | `ITMS-` + correlativo de 4 dígitos (`ITMS-0001`) |
| `codigo_aplicacion` | código resuelto con `resolverAplicativo` |
| `tipo` | `WO` si el ambiente es `QA`, `OCD` si es `Producción` |
| `ambiente` | `QA` o `Producción` |
| `url` | `NULL` |
| `titulo` | título del borrador |
| `descripcion` | texto armado con las tres secciones (abajo) |
| `grupo_resolutor` | uno de los 6 grupos |
| `estado` | `Registrado` |
| `creado_en` | por defecto (`now()`), así entra en la ventana de 90 días de las búsquedas |

Formato de `descripcion`:

```
Problema:
<detalle_problema>

Evidencias:
<evidencias, o "Sin evidencias">

Solución propuesta:
<detalle_solucion, o "Sin solución propuesta">
```

Sesión en memoria (los tres campos ya existen desde la SPEC 05):

```js
const sesion = {
  // ...
  turno: 0,            // +1 con cada mensaje del usuario
  borrador: null,      // { titulo, detalle_problema, aplicativo, ambiente, tipo, grupo_resolutor,
                       //   evidencias, detalle_solucion, descripcion, turno } | null
  ticketsCreados: 0,
};
```

Contrato de las tools:

```js
// proponer_ticket: guarda el borrador y lo devuelve. No escribe en la base.
proponer_ticket({
  titulo: "string",                     // obligatorio, máximo 200 caracteres
  detalle_problema: "string",           // obligatorio, máximo 4000
  aplicativo: "string",                 // obligatorio: código o nombre, sin distinguir mayúsculas
  ambiente: "QA | Producción",          // obligatorio
  grupo_resolutor: "Seguridad | Control de Accesos | AgileOPS | Base de Datos | Soporte ITSM | Soporte Mainframe", // obligatorio
  detalle_solucion: "string (opcional)", // máximo 4000
  evidencias: "string (opcional)",       // máximo 4000
})
// -> { borrador: { titulo, aplicativo, ambiente, tipo, grupo_resolutor, estado: "Registrado", descripcion } }

// crear_ticket: sin entrada. Inserta el borrador guardado.
crear_ticket()
// -> { ticket: { clave: "ITMS-0001", tipo, titulo, descripcion, aplicativo, ambiente, estado: "Registrado",
//                grupo_resolutor, url: null, creado_en, similitud: null } }   // mismo formato que buscar_tickets_similares
```

Reglas de las tools (los errores salen en español y vuelven al modelo como resultado de la tool):

- `proponer_ticket` rechaza campos obligatorios ausentes o vacíos, textos más largos que el máximo, un `ambiente` o `grupo_resolutor` fuera de sus valores y un `aplicativo` que no existe en `cvt`.
- `proponer_ticket` reemplaza cualquier borrador anterior de la sesión y guarda el `turno` en que se propuso.
- `crear_ticket` rechaza la creación si la sesión no tiene borrador, si `sesion.turno` no es mayor que `borrador.turno`, o si la sesión ya creó 3 tickets.
- `crear_ticket` borra el borrador antes de insertar y lo restaura si el `INSERT` falla.
- Generación del código, dentro de una transacción: `pg_advisory_xact_lock` para serializar, luego `max` del número de los códigos que cumplen `^ITMS-[0-9]+$` más 1 (0 si no hay), con ancho de 4 dígitos. Si el correlativo supera 9999 lanza un error. Ni `WO-` ni `OCD-` participan del correlativo.
- El `INSERT` va parametrizado y es la única escritura del backend. El resto de los módulos de `tools/` siguen siendo de solo lectura.
- Un ticket creado aparece en `buscar_tickets_similares` por la columna `busqueda` generada, sin pasos extra.

Convenciones:

- Las tools reciben la sesión como contexto: `ejecutarTool(nombre, entrada, { sesion })` (ya existe).
- El borrador vive solo en memoria y desaparece con la sesión.
- Plantilla preliminar que presenta el agente (Markdown): título "Borrador de ticket", los datos (título, aplicativo, ambiente, tipo, grupo resolutor, problema, evidencias o "Sin evidencias", solución o "Sin solución propuesta") y una pregunta final para confirmar o pedir cambios.
- El agente muestra en la plantilla exactamente lo que devolvió `proponer_ticket`. Si el usuario pide cambios, vuelve a proponer y hace falta otro mensaje para confirmar.
- Comportamiento del agente:
  - Cuando el usuario quiere registrar un problema, busca incidentes y tickets similares para proponer el grupo resolutor y la solución, y no inventa soluciones: si no hay base, deja la solución vacía.
  - Si no puede inferir el grupo con base en los similares, lo pregunta.
  - Nunca llama a `crear_ticket` en el mismo mensaje en que propuso el borrador.
  - Tras crear, menciona la clave `ITMS-XXXX`.

## Plan de implementación

1. Reescribir `proponer_ticket` en `backend/src/tools/creacion.js` sobre el modelo nuevo (validaciones, `tipo` derivado, `descripcion` armada) y registrarla en `tools/index.js`. Prueba: un script de `node` con una sesión simulada comprueba el borrador, cada rechazo y que `jira_tickets` sigue con 540 filas.
2. Reescribir `crear_ticket` con el `INSERT` en `jira_tickets` y la generación de `ITMS-XXXX` bajo `pg_advisory_xact_lock`, y registrarla. Prueba: el script comprueba el rechazo sin borrador y en el mismo turno, la fila creada, los códigos correlativos, el rechazo del cuarto ticket y la restauración del borrador si el `INSERT` falla. Al final borra los tickets de prueba.
3. Ajustar el prompt de `backend/src/agente.js`: flujo de creación (extraer datos, buscar similares, proponer grupo y solución, plantilla, crear solo tras confirmación). Prueba: un script con `POST /api/chat` recorre el flujo contra Gemini y comprueba que la fila se crea solo tras el segundo mensaje.
4. Actualizar `CLAUDE.md` (creación activa, código `ITMS-`, regla por turno, recarga que borra los tickets creados) y los textos que dicen "SPEC 08" como pendiente. Prueba: `CLAUDE.md` ya no dice que la creación está apagada.

## Criterios de aceptación

- [ ] `definiciones` contiene `proponer_ticket` y `crear_ticket`, además de las 8 tools anteriores.
- [ ] `proponer_ticket` con datos válidos devuelve el borrador con `tipo` `WO` para `QA` y `OCD` para `Producción`, y no inserta filas en `jira_tickets`.
- [ ] `proponer_ticket` lanza un error en español con título vacío, problema vacío, `ambiente` `Desarrollo`, `grupo_resolutor` `Otro`, aplicativo inexistente y textos que superan el máximo.
- [ ] Proponer un segundo borrador reemplaza al primero.
- [ ] `crear_ticket` lanza un error sin borrador, y en el mismo turno en que se propuso, sin insertar filas.
- [ ] `crear_ticket` en un turno posterior inserta exactamente una fila con `estado` `Registrado`, `url` nulo, el `tipo`, el `grupo_resolutor` y el `codigo_aplicacion` del borrador, y una `descripcion` con las tres secciones.
- [ ] El primer ticket creado tiene `codigo_ticket` `ITMS-0001` y el siguiente `ITMS-0002`. Los códigos `WO-` y `OCD-` existentes no cambian.
- [ ] Dos creaciones simultáneas desde sesiones distintas no repiten `codigo_ticket`.
- [ ] Tras crear, el borrador es nulo y llamar de nuevo a `crear_ticket` lanza un error. Una sesión que ya creó 3 tickets rechaza un cuarto.
- [ ] Un ticket sin `evidencias` ni `detalle_solucion` queda con "Sin evidencias" y "Sin solución propuesta" en `descripcion`.
- [ ] Si el `INSERT` falla, el borrador se restaura y la tool lanza un error.
- [ ] El ticket creado aparece en `buscar_tickets_similares` con su clave `ITMS-XXXX` y `creado_en` dentro de la ventana de 90 días.
- [ ] `INSERT` solo aparece en `crear_ticket` en todo `backend/src/`. Los otros módulos de `tools/` no escriben en la base.
- [ ] En el chat, al describir un error y pedir un ticket, el agente presenta la plantilla con grupo resolutor propuesto y `jira_tickets` mantiene el mismo número de filas.
- [ ] Al responder "sí, créalo" en un mensaje posterior se inserta una fila cuyos datos coinciden con la plantilla, y la respuesta menciona su clave `ITMS-XXXX`.
- [ ] Si en un solo mensaje el usuario da todos los datos y pide crear el ticket, el agente solo presenta la plantilla y la tabla no cambia hasta el mensaje siguiente.
- [ ] `db/nexo_dev_bcp_postgresql.sql`, el esquema, `POST /api/chat`, `frontend/` y `sesiones.js` no cambian.
- [ ] `CLAUDE.md` describe la creación activa, el formato `ITMS-`, la confirmación por turno y el límite de 3 tickets por sesión.

## Decisiones

- **Sí:** crear una spec nueva y dejar la SPEC 05 intacta. Lo eligió el equipo. La SPEC 05 ya está implementada y es el historial de un modelo de datos que cambió.
- **Sí:** insertar en `jira_tickets` y guardar problema, evidencias y solución propuesta como secciones de `descripcion`. Lo eligió el equipo. La tabla no tiene columnas para eso y no se modifica el archivo entregado.
- **No:** crear incidentes en `jira_incidentes` ni agregar columnas a `jira_tickets`. Lo primero exige un `api_id` y otro destino; lo segundo cambia el esquema entregado.
- **Sí:** formato de código `ITMS-XXXX` para los tickets nuevos. Lo eligió el equipo.
- **Sí:** prefijo `ITMS-` más 4 dígitos con correlativo desde `0001`, calculado con el máximo existente. El ancho y el correlativo no los confirmó el equipo: se asumieron a partir de "ITMS-XXXX".
- **No:** continuar la numeración `WO-` / `OCD-`. Ya no se distingue el tipo en el código; `tipo` queda en su columna.
- **Sí:** `tipo` derivado del ambiente (`QA` → `WO`, `Producción` → `OCD`). Es la relación que muestran los datos actuales.
- **Sí:** `pg_advisory_xact_lock` dentro de la transacción para calcular el correlativo. Evita códigos repetidos sin crear secuencias ni tocar la migración.
- **No:** una `SEQUENCE` en `db/nexo_dev_bcp_migracion.sql`. Es más robusta, pero modifica la carga.
- **Sí:** el agente propone el `grupo_resolutor` con base en tickets e incidentes similares y el usuario lo confirma en la plantilla. Lo eligió el equipo. Si no puede inferirlo, pregunta.
- **Sí:** la confirmación la exige el código con un mensaje del usuario entre propuesta y creación, y `crear_ticket` no recibe datos del modelo (diseño de la SPEC 05).
- **Sí:** máximo 3 tickets por sesión y estado inicial `Registrado`.
- **Sí:** el ticket nuevo usa `creado_en` por defecto. Entra en la ventana de 90 días de las búsquedas.
- **Sí:** verificación manual con scripts de `node`, `psql` y `POST /api/chat`.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El modelo llama a `proponer_ticket` y `crear_ticket` en el mismo mensaje | El backend rechaza `crear_ticket` si no hubo un mensaje del usuario después del borrador |
| El usuario responde algo que no es una confirmación y el modelo crea el ticket igual | Aceptado en el MVP: el código exige un mensaje, no su contenido. El prompt pide confirmación explícita |
| El grupo resolutor propuesto está mal | Va en la plantilla y el usuario lo confirma o lo cambia antes de crear |
| La solución propuesta se inventa | El prompt la limita a lo que devuelven las búsquedas; sin base queda "Sin solución propuesta" |
| El formato `ITMS-XXXX` no era el que se quería (ancho o correlativo) | Está marcado como supuesto en Decisiones; ajustar antes de aprobar |
| Dos creaciones simultáneas generan el mismo código | `pg_advisory_xact_lock` en la misma transacción del `INSERT` |
| Tickets de prueba llenan `jira_tickets` | Los scripts de prueba borran sus tickets `ITMS-`; recargar la base los elimina |
| Recargar la base borra los tickets creados desde el chat | Documentado en `CLAUDE.md` |
| Cualquiera con acceso a la URL puede crear tickets | Aceptado en el MVP; el límite de 3 por sesión acota el daño. La autenticación queda para otra spec |
| La SPEC 07 exige que ningún archivo contenga `INSERT` y esta spec agrega uno | Ese criterio de la SPEC 07 se reemplaza por el de esta spec: `INSERT` solo en `crear_ticket` |
| Cada ticket creado exige varias llamadas al modelo y la cuota gratuita (15 por minuto) es limitada | Límite de 5 rondas de tools por mensaje y 502 con mensaje claro al agotarse la cuota |

## Lo que **no** está en esta spec

- Crear incidentes o modificar `jira_incidentes`.
- Botón de confirmación u otro cambio en la interfaz o en `POST /api/chat`.
- Editar, cerrar o borrar tickets.
- Agente 2 de aprovisionamiento.
- Integración con Jira real.
- Detección de duplicados y autenticación.
- Evidencias como archivos adjuntos.
- Cambios al esquema entregado o a la migración.
- Pruebas automáticas.
