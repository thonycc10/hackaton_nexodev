# SPEC 09 — Creación por tipo: WO, OCD, ITSM e INC

> **Status:** Approved
> **Depends on:** SPEC 06, SPEC 07, SPEC 08
> **Date:** 2026-11-13
> **Objective:** Hacer que el agente pregunte el tipo (WO, OCD, ITSM o INC) y el ambiente (QA o Producción) al crear, guarde WO, OCD e ITSM en `jira_tickets` e INC en `jira_incidentes`, y consulte ambas tablas al buscar similares.

## Por qué existe esta spec

La SPEC 08 crea siempre en `jira_tickets`, deriva el tipo del ambiente (QA → `WO`, Producción → `OCD`) y usa un solo código, `ITMS-XXXX`. El equipo pidió otra cosa: que el usuario elija el tipo, que el tipo y el ambiente sean independientes (cualquier tipo en cualquier ambiente), que un incidente (`INC`) vaya a `jira_incidentes` y que las consultas miren las dos tablas. Esta spec cambia esas reglas de la SPEC 08, que queda como historial, y conserva el resto: borrador en la sesión, confirmación por turno exigida por código y límite de 3 por sesión.

## Alcance

**Dentro:**

- Cambios de esquema propios, en nuestros scripts (no en el archivo entregado):
  - `db/nexo_dev_bcp_migracion.sql`: el CHECK `jira_tickets_tipo_check` admite `WO`, `OCD` e `ITSM`.
  - `db/nexo_dev_bcp_incidentes.sql`: el CHECK de `jira_incidentes.ambiente` admite `QA` y `Producción`. Los 300 incidentes existentes siguen en Producción.
- `proponer_ticket` y `crear_ticket` en `backend/src/tools/creacion.js` con el contrato nuevo:
  - `tipo` (`WO`, `OCD`, `ITSM` o `INC`) y `ambiente` (`QA` o `Producción`) son campos separados y obligatorios, sin relación entre sí.
  - `WO`, `OCD` e `ITSM` se insertan en `jira_tickets`. `INC` se inserta en `jira_incidentes`.
  - Códigos con prefijo por tipo y correlativo propio de 4 dígitos: `WO-0001`, `OCD-0001`, `ITSM-0001`, `INC-0001`. Reemplazan al `ITMS-XXXX` de la SPEC 08.
  - Un INC exige además servicio (`api_id`), `severidad` y `tipo_incidente`.
- `buscar_tickets_similares` acepta `ITSM` en su filtro `tipo`.
- Prompt del sistema en `backend/src/agente.js`:
  - El agente pregunta el tipo y el ambiente si el usuario no los dio.
  - Para un INC pide el servicio y propone severidad y tipo de incidente.
  - Siempre que busca similares (por un problema, una necesidad o antes de crear), consulta `buscar_tickets_similares` y `buscar_incidentes`.
- Actualización de `CLAUDE.md`.

**Fuera de alcance (para otras specs):**

- Unir las dos búsquedas en una sola tool o cambiar sus esquemas de salida.
- Un filtro `ambiente` en las tools de búsqueda.
- Crear incidentes ya `Terminado`, con causa raíz o solución definitivas, y cambiar el estado de un ticket o incidente.
- Cambios en `frontend/`, `POST /api/chat`, `sesiones.js` y el flujo de `server.js`.
- Modificar `db/nexo_dev_bcp_postgresql.sql`.
- Renumerar o migrar códigos existentes (`WO-0000001101`, `OCD-01103`, `INC-100048`).
- Agente 2 de aprovisionamiento.
- Pruebas automáticas.

## Modelo de datos

### Cambios de esquema

```sql
-- db/nexo_dev_bcp_migracion.sql (repetible): ITSM como tercer tipo de jira_tickets
ALTER TABLE nexo_dev_bcp.jira_tickets DROP CONSTRAINT IF EXISTS jira_tickets_tipo_check;
ALTER TABLE nexo_dev_bcp.jira_tickets
    ADD CONSTRAINT jira_tickets_tipo_check CHECK (tipo IN ('WO', 'OCD', 'ITSM'));
```

En `db/nexo_dev_bcp_incidentes.sql`, la columna `ambiente` pasa de `CHECK (ambiente = 'Producción')` a `CHECK (ambiente IN ('QA', 'Producción'))`, con el mismo `DEFAULT 'Producción'`. El archivo ya hace `DROP TABLE IF EXISTS` y recrea la tabla, así que sigue siendo repetible.

### Dónde se guarda cada tipo

| Tipo | Tabla | Código | Ambiente |
| --- | --- | --- | --- |
| `WO` | `jira_tickets` | `WO-0001` | `QA` o `Producción` |
| `OCD` | `jira_tickets` | `OCD-0001` | `QA` o `Producción` |
| `ITSM` | `jira_tickets` | `ITSM-0001` | `QA` o `Producción` |
| `INC` | `jira_incidentes` | `INC-0001` | `QA` o `Producción` |

Correlativo: dentro de la transacción, `pg_advisory_xact_lock` y el máximo de los códigos del prefijo que cumplen exactamente `^PREFIJO-[0-9]{4}$`, más 1 (1 si no hay). Los códigos de otro ancho (`WO-0000001101`, `OCD-01103`, `INC-100048`) no cuentan, así que no chocan. Si pasa de 9999 lanza un error.

### Columnas al crear

`jira_tickets` (WO, OCD, ITSM): igual que en la SPEC 08, con `tipo` y `ambiente` elegidos por el usuario y `descripcion` en tres secciones (`Problema:`, `Evidencias:`, `Solución propuesta:`). `estado` `Registrado`, `url` nulo, `creado_en` por defecto.

`jira_incidentes` (INC):

| Columna | Valor |
| --- | --- |
| `codigo_incidente` | `INC-` + correlativo de 4 dígitos |
| `codigo_aplicacion` | código resuelto con `resolverAplicativo` |
| `api_id` | servicio elegido; debe pertenecer al aplicativo (`portal_apis.codigo_aplicacion`) |
| `ambiente` | `QA` o `Producción` |
| `severidad` | `Crítica`, `Alta`, `Media` o `Baja` |
| `tipo_incidente` | uno de los 11 valores cerrados |
| `titulo` | título del borrador |
| `descripcion` | dos secciones: `Problema:` y `Solución propuesta:` |
| `evidencias` | las evidencias del borrador, o `NULL` |
| `causa_raiz`, `solucion`, `resuelto_en` | `NULL` (el CHECK de la tabla solo los permite en `Terminado`) |
| `grupo_resolutor` | uno de los 6 grupos |
| `estado` | `Registrado` |
| `url` | `NULL` |
| `creado_en` | por defecto (`now()`), así entra en la ventana de 90 días |

### Contrato de las tools

```js
proponer_ticket({
  tipo: "WO | OCD | ITSM | INC",          // obligatorio
  ambiente: "QA | Producción",            // obligatorio, independiente del tipo
  titulo, detalle_problema, aplicativo, grupo_resolutor,   // obligatorios, como en la SPEC 08
  detalle_solucion?, evidencias?,         // opcionales, como en la SPEC 08
  // Solo para INC (obligatorios con INC, error con otro tipo):
  api_id: "integer",
  severidad: "Crítica | Alta | Media | Baja",
  tipo_incidente: "error_http_5xx | latencia_timeout | memoria_bd | cpu_bd | conexiones_bd | certificado_vencido | autenticacion | despliegue_fallido | contrato_incompatible | integracion_mainframe | monitoreo",
})
// -> { borrador: { tipo, ambiente, titulo, aplicativo, grupo_resolutor, estado: "Registrado", descripcion,
//                  api_id?, servicio?, severidad?, tipo_incidente?, evidencias? } }

crear_ticket()   // sin entrada
// -> { ticket: { clave, tipo, ambiente, titulo, descripcion, aplicativo, estado, grupo_resolutor, url: null, creado_en,
//                similitud: null, api_id?, servicio?, severidad?, tipo_incidente? } }
```

Reglas:

- Todas las validaciones de la SPEC 08 siguen (textos obligatorios, máximos de 200 y 4000 caracteres, grupo y aplicativo válidos, errores en español).
- `tipo` y `ambiente` fuera de sus valores lanzan error. Un `ambiente` y un `tipo` cualesquiera son una combinación válida.
- Un `INC` sin `api_id`, `severidad` o `tipo_incidente`, o con un `api_id` que no existe o no es del aplicativo, lanza un error. Los tres campos con un tipo distinto de `INC` también lanzan error.
- `crear_ticket` mantiene las reglas de la SPEC 08: sin borrador, mismo turno y límite de 3 por sesión (cuenta todos los tipos), con borrador consumido antes de insertar y restaurado si el `INSERT` falla, todo dentro de una transacción.
- Los `INSERT` parametrizados de `jira_tickets` y `jira_incidentes` son las únicas escrituras del backend.
- Lo creado aparece en las búsquedas porque `busqueda` es una columna generada en ambas tablas.

## Plan de implementación

1. Cambios de esquema: agregar `ITSM` al CHECK en `db/nexo_dev_bcp_migracion.sql` y relajar el CHECK de `ambiente` en `db/nexo_dev_bcp_incidentes.sql`. Aplicar ambos a `nexo_dev_bcp` sin recargar la base (los scripts son repetibles). Prueba: `psql` acepta un INSERT de prueba con `ITSM` y un incidente en `QA`, y los rechaza con otro valor; hay 540 tickets y 300 incidentes; el archivo entregado no cambió; ejecutar la recarga completa en una base temporal dos veces deja los mismos conteos.
2. Reescribir `proponer_ticket` en `backend/src/tools/creacion.js` con `tipo` y `ambiente` separados y los campos de INC, y actualizar su definición en `tools/index.js`. Prueba: un script de `node` con una sesión simulada comprueba cada tipo, las combinaciones tipo/ambiente, los campos de INC, cada rechazo y que ninguna tabla cambia.
3. Reescribir `crear_ticket` con el destino por tipo y los códigos con prefijo. Prueba: el script comprueba cada tipo en su tabla, los códigos `WO-0001`, `OCD-0001`, `ITSM-0001`, `INC-0001` y sus correlativos, que los códigos de otro ancho no cuentan, el límite de 3, la concurrencia y la restauración del borrador si el `INSERT` falla. Borra sus datos de prueba al final.
4. Agregar `ITSM` al filtro `tipo` de `buscar_tickets_similares` (`tools/jira-tickets.js` y su definición en `tools/index.js`) y quitar de las descripciones de `buscar_incidentes` la limitación a Producción. Prueba: un ticket `ITSM` creado se encuentra con `tipo: "ITSM"` y un `INC` en `QA` se encuentra con `buscar_incidentes`.
5. Ajustar el prompt de `backend/src/agente.js`. Prueba: un script con `POST /api/chat` recorre los casos de los criterios contra Gemini.
6. Actualizar `CLAUDE.md`. Prueba: ya no menciona `ITMS-XXXX` ni que el tipo se deriva del ambiente.

## Criterios de aceptación

- [ ] `db/nexo_dev_bcp_postgresql.sql` no cambia respecto a git.
- [ ] `jira_tickets` acepta `tipo` `ITSM` y rechaza otro valor fuera de `WO`, `OCD` e `ITSM`. `jira_incidentes` acepta `ambiente` `QA` y `Producción` y rechaza otro.
- [ ] Tras aplicar los scripts, `jira_tickets` tiene 540 filas y `jira_incidentes` 300, y la recarga completa dos veces seguidas deja los mismos conteos.
- [ ] `proponer_ticket` acepta las 8 combinaciones de tipo y ambiente (`WO`, `OCD`, `ITSM`, `INC` por `QA` y `Producción`) y no escribe en ninguna tabla.
- [ ] `proponer_ticket` lanza un error en español con `tipo` `XYZ`, `ambiente` `Desarrollo`, un `INC` sin `api_id`, `severidad` o `tipo_incidente`, un `api_id` inexistente o de otro aplicativo, y un `api_id` con tipo `WO`.
- [ ] `crear_ticket` con tipo `WO`, `OCD` o `ITSM` inserta una fila en `jira_tickets` con ese `tipo`, el `ambiente` elegido, `estado` `Registrado` y `url` nulo, y con tipo `INC` inserta una fila en `jira_incidentes` con `severidad`, `tipo_incidente`, `api_id`, `evidencias`, `estado` `Registrado` y `causa_raiz`, `solucion` y `resuelto_en` nulos. En ambos casos la otra tabla no cambia.
- [ ] Los códigos creados son `WO-0001`, `OCD-0001`, `ITSM-0001` e `INC-0001`, y el siguiente de cada prefijo es `0002`. Los códigos existentes de otro ancho no se alteran ni se cuentan.
- [ ] Dos creaciones simultáneas del mismo tipo desde sesiones distintas no repiten código.
- [ ] Las reglas de la SPEC 08 siguen: rechazo sin borrador y en el mismo turno, límite de 3 por sesión que cuenta todos los tipos, restauración del borrador si el `INSERT` falla.
- [ ] Un ticket `ITSM` creado se encuentra con `buscar_tickets_similares` filtrando `tipo: "ITSM"`, y un `INC` creado en `QA` se encuentra con `buscar_incidentes`.
- [ ] `INSERT` solo aparece en `crear_ticket`, para `jira_tickets` y `jira_incidentes`. Ningún otro módulo de `backend/src/` escribe en la base.
- [ ] En el chat, al pedir un ticket sin decir el tipo, el agente lo pregunta (`WO`, `OCD`, `ITSM` o `INC`), y si falta el ambiente también lo pregunta.
- [ ] En el chat, para un `INC` el agente pide el servicio, propone severidad y tipo de incidente, y los muestra en la plantilla. No crea hasta un mensaje posterior de confirmación.
- [ ] En el chat, al confirmar un `INC`, la respuesta menciona su clave `INC-XXXX` y la fila existe en `jira_incidentes`. Para un `WO`, `OCD` o `ITSM`, la clave existe en `jira_tickets`.
- [ ] En el chat, "Necesito cargar un certificado de pruebas en YAPE" consulta tickets e incidentes y presenta solo claves que existen en su tabla.
- [ ] `POST /api/chat`, `frontend/`, `sesiones.js` y el flujo de `server.js` no cambian.
- [ ] `CLAUDE.md` describe los 4 tipos, la independencia entre tipo y ambiente, los códigos por prefijo y el destino de cada tipo.

## Decisiones

- **Sí:** el usuario elige el tipo (`WO`, `OCD`, `ITSM` o `INC`) y el ambiente por separado. Lo pidió el equipo: cualquier tipo en cualquier ambiente. Reemplaza la derivación QA → `WO` / Producción → `OCD` de la SPEC 08.
- **Sí:** `ITSM` pasa a ser un tercer valor de `jira_tickets.tipo`, con una migración propia. Lo eligió el equipo. Cambia el CHECK de una tabla del archivo entregado, pero solo desde nuestro script de migración.
- **No:** tratar `ITSM` como alias de `WO`, ni descartarlo. El significado de `ITSM` no lo definió el equipo: el agente solo usa el nombre y no inventa una explicación.
- **Sí:** códigos con prefijo por tipo y correlativo propio de 4 dígitos (`WO-0001`, `OCD-0001`, `ITSM-0001`, `INC-0001`). Lo eligió el equipo. Reemplazan al `ITMS-XXXX` de la SPEC 08.
- **No:** continuar la numeración de los códigos existentes. Tienen anchos distintos (10, 5 y 6 dígitos) y el correlativo de 4 dígitos no choca con ellos.
- **Sí:** el correlativo solo cuenta códigos con exactamente 4 dígitos. Evita que `WO-0000001101` empuje el siguiente a un número enorme.
- **Sí:** un `INC` se guarda en `jira_incidentes`. Exige `api_id`, `severidad` y `tipo_incidente` porque la tabla los tiene como obligatorios. El agente los pide o los propone con base en incidentes similares y el usuario los confirma. Lo eligió el equipo.
- **Sí:** un `INC` nace `Registrado`, sin causa raíz ni solución, porque la tabla solo las permite en `Terminado`. La solución propuesta va como sección de `descripcion`, igual que en los tickets. `evidencias` usa su columna.
- **Sí:** relajar el CHECK de `jira_incidentes.ambiente` a `QA` y `Producción`. Lo eligió el equipo, para que cualquier tipo admita cualquier ambiente. Los incidentes existentes siguen en Producción.
- **Sí:** mantener dos tools de búsqueda y que el agente llame a ambas siempre que busque similares. Lo eligió el equipo. No se unen esquemas ni rankings.
- **Sí:** una sola pareja `proponer_ticket` y `crear_ticket` para los cuatro tipos, con los campos de `INC` solo cuando el tipo es `INC`. Mantiene una sola confirmación por turno y no suma tools.
- **Sí:** el límite de 3 tickets por sesión cuenta todos los tipos.
- **Sí:** verificación manual con scripts de `node`, `psql` y `POST /api/chat`.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Más campos y más preguntas hacen que el modelo omita el tipo o el ambiente | `tipo` y `ambiente` son obligatorios en `proponer_ticket` y el error vuelve al modelo; verificación con el flujo de chat |
| El modelo propone un `api_id` que no corresponde al aplicativo | La tool lo valida contra `portal_apis` y lanza un error; el prompt pide usar `consultar_apis` |
| Consultar ambas tablas en cada búsqueda sube las llamadas al modelo y acerca el límite de 15 solicitudes por minuto | Aceptado en el MVP; el 502 por cuota ya se muestra con mensaje claro |
| La SPEC 07 pide no buscar incidentes ante una necesidad de servicio; esta spec lo cambia | El criterio de la SPEC 07 se reemplaza por el de esta spec: se consultan ambas tablas siempre |
| La SPEC 08 y esta spec se contradicen (código `ITMS-` y tipo derivado) | Esta spec reemplaza esas reglas y lo declara; `CLAUDE.md` describe solo la versión nueva |
| Modificar el CHECK de `jira_tickets` en una tabla del archivo entregado | Se hace solo en la migración propia, que es repetible; el archivo entregado no cambia |
| Tickets de prueba llenan las tablas | Los scripts de prueba borran sus filas; recargar la base elimina las creadas desde el chat |
| Los incidentes creados en QA contradicen el texto "incidentes de Producción" de las descripciones | El paso 4 ajusta las descripciones y el prompt |
| Cualquiera con acceso a la URL puede crear tickets | Aceptado en el MVP; el límite de 3 por sesión acota el daño |

## Lo que **no** está en esta spec

- Unir las búsquedas en una sola tool o cambiar sus formatos de salida.
- Un filtro por ambiente en las búsquedas.
- Crear incidentes ya resueltos, o cambiar el estado de un ticket o incidente.
- Cambios en `frontend/`, `POST /api/chat`, `sesiones.js` o `server.js`.
- Modificar el archivo entregado `db/nexo_dev_bcp_postgresql.sql`.
- Renumerar los códigos existentes.
- Agente 2 de aprovisionamiento.
- Pruebas automáticas.
