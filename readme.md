\# PREVI-EDU



\## Prototipo web de apoyo a la prevención de la deserción escolar



\*\*PREVI-EDU\*\* es un prototipo de aplicación web desarrollado como parte de un trabajo de investigación de maestría orientado a evaluar la usabilidad percibida de una herramienta tecnológica de apoyo a la prevención de la deserción escolar.



El prototipo está dirigido principalmente a \*\*directores y docentes de instituciones educativas\*\* y permite gestionar información académica, asistencia, evaluaciones, alertas preventivas y acciones de seguimiento de estudiantes.



> \*\*Importante:\*\* PREVI-EDU es un prototipo académico. La funcionalidad relacionada con técnicas de Machine Learning es simulada mediante datos y reglas predefinidas. El proyecto no evalúa la precisión ni el rendimiento predictivo de un modelo de Machine Learning.



\---



\## Trabajo de investigación



\*\*Título:\*\*



> Usabilidad de una aplicación web con técnicas Machine Learning como apoyo a la prevención de deserción escolar en Celendín 2026.



La investigación busca evaluar la \*\*usabilidad percibida\*\* del aplicativo mediante la escala \*\*System Usability Scale (SUS)\*\*, considerando principalmente la experiencia de uso de docentes y directores.



\---



\## Objetivo del prototipo



PREVI-EDU permite representar de manera funcional los principales procesos que utilizarían docentes y directores para:



\- gestionar estudiantes;

\- consultar información académica;

\- registrar y consultar asistencia;

\- registrar y consultar evaluaciones;

\- visualizar análisis preventivos;

\- consultar alertas de riesgo;

\- registrar acciones de seguimiento;

\- generar reportes;

\- gestionar instituciones y usuarios.



El prototipo será utilizado como instrumento tecnológico durante las pruebas de usabilidad de la investigación.



\---



\## Roles del sistema



\### Administrador



Responsable de la administración general del prototipo.



Funciones principales:



\- Dashboard administrativo.

\- Gestión de instituciones educativas.

\- Gestión y asignación de directores.

\- Gestión general de usuarios.



\### Director



Responsable de la gestión académica de una institución educativa.



Cada Director está asociado a una única institución.



Funciones principales:



\- Dashboard.

\- Información institucional.

\- Gestión académica.

\- Estudiantes.

\- Docentes.

\- Asistencia.

\- Evaluaciones.

\- Alertas.

\- Seguimientos.

\- Reportes.

\- Configuración.



\### Docente



Un Docente puede trabajar en una o varias instituciones educativas.



Sus instituciones se determinan mediante las asignaciones de aulas y áreas curriculares.



El prototipo contempla que el Docente pueda seleccionar la institución con la que desea trabajar y acceder únicamente a las aulas, estudiantes y áreas que tenga asignadas.



\---



\## Usuarios y perfiles



Los usuarios pueden registrarse inicialmente con el perfil base:



`USUARIO`



Posteriormente pueden recibir perfiles funcionales dentro de PREVI-EDU.



Un mismo usuario puede ser simultáneamente:



\- Director.

\- Docente.



Los perfiles se determinan mediante las relaciones existentes en la base de datos.



```text

usuario

&#x20;  ├── director

&#x20;  │      └── institucion\_educativa

&#x20;  │

&#x20;  └── docente

&#x20;         └── asignaciones

&#x20;                └── instituciones

