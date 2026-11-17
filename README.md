# Implementacion de Chatbot question y answers

Necesitamos una interface web en html y js similar a claude para que nos sirva 
de input para realizar consultas sobre:

1. Como generar tickets de un problema en un entorno pre productivo o productivo
2. Que nos de sugerencias de ticket que recientemente se hayan generado y que sean similares a lo que estamos solicitando.

## Objetivo
El MVP es un chatbot web que sirve de interfaz para consultar el estado de nuestro entorno y crear tickets de problemas.

Alcance del MVP:
- No se integra con las plataformas reales. Todas las fuentes de información son tablas simuladas en una base de datos PostgreSQL.
- Las tablas simulan las consultas a Jira, Confluence, Portal de APIs (mantenimiento de servicio de APIs) y GitHub.
- El agente solo interactúa con esa base de datos PostgreSQL.

Defineme en un MarkDown la arquitectura de este agente, los componentes backend, los servicios que nos sirvan como fuente de información
y de la interfaces web.

## Agente que crea tickets 

El agente debera consultar a las siguientes fuentes de información:
1. Plataforma Jira para consultar informacion de tickets.
2. Plataforma Confluence para consultar informacion de modelos operativos, informacion de los proyectos de la organizacion.
3. Repositorio Github para consultar informacion de soluciones a nivel de codigo que se hayan aplicado.
4. El portal de apis que nos sirven para obtener la informacion disponible de cada proyecto.

### Agente 1: 
enfocado en solucionar un problema o un error. Que sea capas en base de preguntas y respuestas crear un nuevo ticket en jira (Plataforma que usaremos en este caso) que contienen
la siguiente información:
1. Detalle del problema,
2. Equipo de la organización que realiza la solucion del problema
3. Evidencias del problema 
4. El nombre del aplicativo donde esta ocurriendo el problema. 
5. El ambiente certificacion y producción. 
6. El detalle de la solucion

#### Ejemplos: 
1. Se esta dando un error de tipo 500 en el api que consulta informacion de personas.
El agente debe generar un ticket basado en errores similares de otras apis.
2. Se esta dando un error de alto consumo de memoria en una base de datos. El agente debe
generar un ticket basado en errores similares de otras bases de datos.
3. Se esta dando un error de alto consumo de CPU en una base de datos. El agente debe
generar un ticket basado en errores similares de otras bases de datos.
4. Se esta dando problemas en general. El agente debera interactual con otros tickets para buscar una posible solucion.


### Agente 2:
Dar soporte para realizar una implementacion o aprovicionamiento de un componente

#### Ejemplos:
1. Aprovisionamiento de un nuevo AKS.
2. Aprovisionamiento de un nuevo Base de Datos Azure SQL.
3. Aprovisionamiento de un nuevo Topico en Confluent Cloud.
4. Aprovisionamiento de un nuevo Redis.
5. Aprovisionamiento de un nuevo Repositorio en Github que este preparado para CI/CD

## Enfoque
- Queremos enfocarnos en generar un incremento de la productivad
- Reduccion de costos y tiempos de desarrollo para los desarrolladores de software.
- Reduccion de riesgos o fallos en produccion
- Reutilizacion o beneficios en multiples areas


