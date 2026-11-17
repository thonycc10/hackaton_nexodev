# SPEC 04 — Búsqueda de tickets similares en el agente

> **Status:** Approved
> **Depends on:** SPEC 01, SPEC 02
> **Date:** 2026-11-13
> **Objective:** Agregar al agente una tool de solo lectura que busque tickets recientes y similares a un problema descrito, y hacer que el agente la use y muestre los resultados cada vez que el usuario describe un problema.

## Por qué existe esta spec

El README pide que el agente sugiera tickets recientes parecidos a lo que el usuario describe. La SPEC 01 dejó listos la columna `tickets.busqueda` y su índice GIN, y la SPEC 02 dejó la capa de tools, pero ninguna tool consulta aún los tickets. Esta spec es la base de la SPEC 05, que usará los tickets similares para redactar un ticket nuevo.

## Alcance

**Dentro:**

- Tool `buscar_tickets_similares` en `backend/src/tools/tickets.js`, registrada en `backend/src/tools/index.js`.
- Similitud con búsqueda full-text de PostgreSQL sobre `tickets.busqueda` (diccionario `spanish`), ordenada con `ts_rank`.
- Ventana de recencia: solo tickets creados en los últimos 90 días. El número de días es una constante en el código.
- Hasta 5 resultados, ordenados por similitud y, a igualdad, del más reciente al más antiguo.
- Filtros opcionales: `aplicativo`, `ambiente` y `estado`.
- Cada resultado incluye una clave tipo Jira, `NEXO-<id>`, derivada del `id` de la tabla.
- Evidencias recortadas a 300 caracteres.
- Cambio del prompt del sistema en `backend/src/agente.js` para que el agente busque de forma automática cuando el usuario describe un problema, presente los tickets en Markdown y, si no hay coincidencias con filtros, reintente una vez sin ellos.
- Actualización de `CLAUDE.md` con la nueva tool.

**Fuera de alcance (para otras specs):**

- Crear tickets desde el chat y redactar un ticket nuevo a partir de los similares (SPEC 05).
- Tarjetas u otros cambios de interfaz: los tickets se muestran como texto Markdown dentro de la respuesta. No cambia `POST /api/chat` ni `frontend/`.
- Filtro por tipo de aplicativo (`api`, `base_datos`, `aplicacion`).
- Búsqueda por similitud semántica (`pgvector`) y por trigramas (`pg_trgm`).
- Cambios en el esquema de PostgreSQL y en los datos semilla.
- Tools que escriban en la base de datos.
- Pruebas automáticas.

## Modelo de datos

Esta spec no modifica el esquema de PostgreSQL ni el contrato de `POST /api/chat`. Usa la tabla `tickets`, su columna `busqueda` (`tsvector` en español) y el índice `tickets_busqueda_idx` de la SPEC 01. Define el contrato de la nueva tool.

```js
// Entrada de la tool
buscar_tickets_similares({
  consulta: "string",                                  // obligatoria: descripción del problema
  aplicativo: "string (opcional)",                      // nombre de apis_proyectos, por ejemplo "api-personas"
  ambiente: "certificacion | produccion (opcional)",
  estado: "abierto | en_progreso | resuelto | cerrado (opcional)",
})

// Salida: mismo formato que las otras tools
{
  total: 7,                       // coincidencias totales dentro de la ventana, aunque se devuelvan 5
  resultados: [
    {
      clave: "NEXO-42",           // "NEXO-" + tickets.id
      titulo: "Error 500 en api-personas: valores nulos en la consulta",
      detalle_problema: "...",
      equipo_responsable: "Equipo Personas",
      aplicativo: "api-personas", // apis_proyectos.nombre
      ambiente: "produccion",
      estado: "resuelto",
      detalle_solucion: "..." | null,
      evidencias: "..." | null,   // máximo 300 caracteres; si se recorta termina en "…"
      creado_en: "2026-10-30T14:12:00.000Z",
      similitud: 0.0759,          // ts_rank redondeado a 4 decimales
    },
  ],
}
```

Convenciones:

- La consulta se separa en palabras de al menos 3 caracteres, hasta 6 y sin repetir, con la misma regla que las otras tools. Un ticket coincide si contiene cualquiera de ellas. Cuantas más palabras coinciden, mayor es la similitud.
- Los filtros se combinan con AND entre sí y con la consulta. `aplicativo` compara por nombre sin distinguir mayúsculas.
- Un valor fuera del enum de `ambiente` o `estado` lanza un error, igual que en las otras tools. Una consulta vacía también.
- Todas las consultas SQL son parametrizadas.
- La clave `NEXO-<id>` no se guarda en la base: se calcula al leer. La SPEC 05 debe usar la misma regla.
- Comportamiento del agente:
  - Cuando el usuario describe un problema, busca antes de responder, sin que se lo pidan.
  - Presenta cada ticket con su clave, título, estado, ambiente, aplicativo y solución. Si no tiene solución, indica que aún no hay solución registrada.
  - Aclara que la búsqueda cubre los últimos 90 días.
  - Si no hay coincidencias con filtros, repite la búsqueda una vez sin `aplicativo` ni `ambiente` y avisa que amplió el criterio. Si sigue vacía, dice que no encontró tickets similares.
  - Usa solo claves devueltas por la tool. Nunca inventa tickets.
  - Si le piden crear un ticket, explica que esa función aún no está disponible.

## Plan de implementación

1. Crear `backend/src/tools/tickets.js` con `buscarTicketsSimilares({ consulta })`: búsqueda full-text sobre `tickets.busqueda`, ventana de 90 días, orden por `ts_rank` y fecha, máximo 5 filas y `total`. Exportar desde `util.js` la función que separa la consulta en palabras. Prueba: un script de `node` con "error 500 api" devuelve tickets de los últimos 90 días ordenados por similitud.
2. Agregar los filtros `aplicativo`, `ambiente` y `estado` con su validación. Prueba: el script con cada filtro devuelve solo tickets que lo cumplen, y un valor inválido lanza un error.
3. Dar formato al resultado: `clave` `NEXO-<id>`, `aplicativo` por nombre, `creado_en`, `similitud` y evidencias recortadas a 300 caracteres. Prueba: el script muestra todos los campos y ninguna evidencia supera 301 caracteres.
4. Registrar la tool en `backend/src/tools/index.js` con su definición en formato `function` y su ejecutor. Prueba: `definiciones` lista cuatro tools y `ejecutarTool("buscar_tickets_similares", ...)` devuelve resultados.
5. Actualizar el prompt del sistema en `backend/src/agente.js` con las reglas de comportamiento descritas. Prueba: `curl` a `POST /api/chat` con "Tenemos un error 500 en api-personas" devuelve una respuesta que lista tickets cuyas claves existen en la tabla.
6. Actualizar `CLAUDE.md` con la nueva tool y el uso de `tickets.busqueda`. Prueba: `CLAUDE.md` ya no dice que ninguna tool usa `tickets.busqueda`.

## Criterios de aceptación

- [ ] `definiciones` en `backend/src/tools/index.js` contiene `buscar_tickets_similares` además de las tres tools anteriores.
- [ ] `buscar_tickets_similares({ consulta: "error 500 api" })` devuelve entre 1 y 5 resultados y un `total` mayor o igual al número de resultados.
- [ ] Todos los resultados tienen `creado_en` dentro de los últimos 90 días.
- [ ] Los resultados vienen ordenados por `similitud` descendente.
- [ ] Cada `clave` cumple el formato `NEXO-<id>` y su `id` existe en `tickets`.
- [ ] Con `aplicativo: "api-personas"` todos los resultados pertenecen a `api-personas`.
- [ ] Con `ambiente: "produccion"` todos los resultados tienen ese ambiente, y con `estado: "resuelto"` todos tienen ese estado.
- [ ] `ambiente: "desarrollo"` y `estado: "pendiente"` lanzan un error, igual que una consulta vacía.
- [ ] Ninguna `evidencias` supera 301 caracteres, y las recortadas terminan en `…`.
- [ ] La consulta `'; DROP TABLE tickets; --` se trata como texto y no ejecuta SQL: la tool no falla y `tickets` conserva sus 100 filas. Puede devolver resultados, porque busca por las palabras `drop`, `table` y `tickets`.
- [ ] Ninguna tool ejecuta `INSERT`, `UPDATE`, `DELETE` ni DDL (verificable leyendo `backend/src/tools/`).
- [ ] `EXPLAIN` de la consulta de la tool, con `SET enable_seqscan = off`, usa `tickets_busqueda_idx`.
- [ ] Al escribir en el chat "Tenemos un error 500 en api-personas", la respuesta lista al menos un ticket con clave `NEXO-<id>` que existe en la base, con su estado y, cuando existe, su solución.
- [ ] Al escribir un problema sin coincidencias, por ejemplo "La impresora de la oficina no imprime", la respuesta dice que no encontró tickets similares y no incluye ninguna clave `NEXO-`.
- [ ] Al pedir "crea el ticket", el agente explica que esa función aún no está disponible.
- [ ] El esquema de PostgreSQL y `POST /api/chat` no cambian respecto a la SPEC 02.
- [ ] `CLAUDE.md` describe `buscar_tickets_similares` y su uso de `tickets.busqueda`.

## Decisiones

- **Sí:** full-text de PostgreSQL con `ts_rank` sobre `tickets.busqueda`. Aprovecha la columna y el índice de la SPEC 01, y el diccionario español maneja variaciones de palabras.
- **No:** `ILIKE`, `pg_trgm` y `pgvector`. `ILIKE` ignora el índice y ordena peor, `pg_trgm` exige una extensión y `pgvector` exige embeddings.
- **Sí:** ventana de 90 días con orden por similitud y desempate por fecha. Es el sentido de "recientemente generados" del README y cubre toda la semilla.
- **No:** sin ventana y ventana de 30 días. Sin ventana sugeriría tickets antiguos, y 30 días dejaría pocos candidatos.
- **Sí:** coincidir con cualquiera de las palabras y ordenar por similitud. Una descripción libre rara vez repite todas las palabras de un ticket.
- **Sí:** filtros `aplicativo`, `ambiente` y `estado`. Permiten ver errores similares en otros aplicativos y comparar por ambiente.
- **No:** filtro por tipo de aplicativo. El agente puede acercarse con las palabras de la consulta, y se puede sumar en otra spec.
- **Sí:** el agente busca siempre que el usuario describe un problema. El usuario no tiene que saber que la función existe.
- **No:** buscar solo si lo piden. Es más predecible, pero esconde la función principal de la SPEC 04.
- **Sí:** tickets como texto Markdown en la respuesta. No cambia la API ni la interfaz de la SPEC 03.
- **No:** tarjetas en la interfaz. Exigen datos estructurados en `POST /api/chat` y cambios en `frontend/app.js`.
- **Sí:** identificar los tickets con la clave `NEXO-<id>`. La eligió el equipo por parecerse a Jira. Se calcula al leer y no cambia la base.
- **Sí:** la clave se deriva solo del `id`. Así una clave siempre apunta a una fila real y la SPEC 05 puede reutilizar la regla.
- **Sí:** devolver todos los campos con evidencias recortadas a 300 caracteres. Las evidencias son logs y completas consumirían muchos tokens de una cuota gratuita limitada.
- **Sí:** si no hay coincidencias con filtros, reintentar una vez sin `aplicativo` ni `ambiente` y avisarlo. Evita respuestas vacías por filtros demasiado estrictos sin que el usuario lo note.
- **Sí:** máximo 5 resultados por búsqueda. Es la convención de las otras tools.
- **Sí:** verificación manual con un script de `node` y `curl`, igual que en la SPEC 02.

## Riesgos

| Riesgo                                                                                     | Mitigación                                                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Las fechas de los tickets semilla son relativas a la carga. Pasados 90 días la ventana queda vacía | Recargar `db/seed.sql`. Documentar la ventana de 90 días en `CLAUDE.md`                       |
| Cada problema descrito agrega al menos una llamada al modelo y la cuota gratuita de Gemini es limitada | Mantener el límite de 5 rondas de tools y devolver el 502 con mensaje claro al agotarse la cuota |
| Una palabra común, como "error", coincide con muchos tickets y baja la calidad                | El diccionario español descarta palabras vacías, y el orden por `ts_rank` sube los mejores         |
| El modelo cita claves o datos que no devolvió la tool                                      | El prompt exige usar solo claves devueltas. La verificación revisa que las claves existan en la base |
| Los textos de la semilla se repiten (90 detalles distintos en 100 tickets) y los resultados se parecen entre sí | Aceptado en el MVP. Se puede ampliar la semilla en otra spec                         |
| El reintento sin filtros puede mostrar tickets de otro aplicativo como si fueran del pedido | El prompt obliga a avisar que se amplió el criterio                                                 |
| La clave `NEXO-<id>` inventada confunde si luego se integra Jira real                     | Aceptado en el MVP. La integración real reemplazaría la regla de la clave                           |

## Lo que **no** está en esta spec

- Crear tickets desde el chat y redactarlos a partir de los similares.
- Cambios en la interfaz web o en `POST /api/chat`.
- Filtro por tipo de aplicativo.
- Búsqueda por trigramas o por embeddings.
- Cambios en el esquema y en los datos semilla.
- Tools que escriban en la base de datos.
- Pruebas automáticas.
