# Forja · Guía de uso

Forja es una aplicación móvil primero para planear, registrar y revisar tus sesiones de fuerza. Las sesiones, medidas, perfiles y fotos se quedan en el dispositivo hasta que configures y actives la sincronización cifrada.

## Abrirla en el celular

Publica el contenido de esta carpeta en un sitio estático con HTTPS y abre esa dirección en el navegador del teléfono. Usa **Instalar Forja** si el navegador ofrece la instalación o elige **Añadir a pantalla de inicio** desde el menú del navegador. La app guarda su interfaz para trabajar sin conexión. Las fichas abiertas se guardan automáticamente. Desde Ejercicios puedes guardar las imágenes JPG (~9 MB) o las animaciones GIF (~123 MB) por separado; la descarga de GIF recomienda Wi-Fi y permite cancelar. El navegador debe permitir los service workers, que necesitan HTTPS salvo en localhost.

Para revisar en el computador puedes abrir `index.html` mediante un servidor local. La dirección `http://127.0.0.1:8892/` sirve solo en este equipo; el celular no puede llegar a esa dirección por internet.

## Entrenar

- El catálogo conserva los 1.324 ejercicios del conjunto enviado y los 56 movimientos originales de Forja (1.380 en total). Los nombres y las instrucciones del conjunto aparecen en español; también puedes buscar por el nombre original en inglés. Cada ficha tiene JPG y GIF locales con atribución Gym visual.
- Los 56 movimientos originales ahora muestran su par local de JPG y GIF. Cuando el conjunto no tiene una versión exacta, la ficha identifica claramente la variante visual usada.
- En **Rutinas** las plantillas prehechas están separadas de **Mis rutinas**. Duplica cualquier plantilla, edita tus rutinas, cambia ejercicios directamente desde la lista, ajusta series y orden, o importa/exporta una rutina JSON.
- El **Plan semanal** ofrece distribuciones de cuerpo completo, torso/pierna y Push/Pull/Legs. Puedes asignar una sesión por día, dejar descansos y editar desde cada día: Forja crea una copia personal sin cambiar la plantilla original. Guarda el calendario cuando termines; el plan se refleja en Inicio.
- El plan muestra los días de la semana en que participa cada grupo muscular y una sugerencia para repartir el trabajo. Es una orientación: para hipertrofia, la evidencia no muestra una ventaja clara por aumentar la frecuencia cuando el volumen semanal es igual; dos días pueden ayudar a distribuirlo, pero no son obligatorios. Consulta la [revisión sistemática sobre frecuencia](https://pubmed.ncbi.nlm.nih.gov/30558493/) y las [guías de actividad física de ACSM](https://acsm.org/education-resources/trending-topics-resources/physical-activity-guidelines/).
- **Personalizar mi plan** ajusta objetivo, experiencia, días, equipo, duración y bloque de 4, 6 u 8 semanas. Antes de guardar, muestra una vista previa por día; el plan adapta el número de ejercicios, ofrece sustituciones disponibles y reduce volumen en la semana de descarga.
- En una sesión se guardan automáticamente peso, repeticiones, RPE, descanso, notas técnicas y molestias. El temporizador se puede pausar o ajustar y repite tres avisos de tono con vibración; el calentamiento guiado dura cinco minutos. **Próxima serie** enfoca el siguiente set pendiente.
- En el catálogo, las miniaturas JPG cargan bajo demanda con espacio reservado para evitar saltos en pantalla; los GIF se cargan al abrir su ficha o se guardan aparte para uso sin conexión.
- La guía permite elegir entre las voces en español instaladas en el teléfono o usar la mejor voz disponible automáticamente. No activa el micrófono hasta que la enciendes. El reconocimiento depende del navegador y puede requerir conexión. La app intenta mantener la pantalla activa durante el entrenamiento.
- Al crear una rutina puedes partir de una plantilla de cuerpo completo, torso o piernas, y después cambiar ejercicios, series y orden desde el celular.

El mapa frontal oculta subdivisiones pequeñas para que se lea mejor, pero conserva el cuello, los tobillos, los aductores y los pies; la espalda mantiene su detalle. Los isquiotibiales se pueden seleccionar desde atrás. Cuello, aductores y pies aparecen como referencia anatómica y no generan una estimación de recuperación por separado. Tocar un lado representa el grupo completo en ambos lados. La recuperación que muestra Forja es orientativa y no mide la recuperación fisiológica.

## Progreso y copias

**Progreso** contiene calendario, historial, grupos musculares trabajados, marcas y gráficas de carga/volumen/1RM estimado. El panel de inicio resume el siguiente paso semanal y compara bienestar con rendimiento solo cuando hay suficientes registros; la correlación es orientativa y no explica causas. Forja conserva hasta siete copias automáticas diarias locales, restaurables desde Progreso; no incluyen fotos ni credenciales de nube, y al restaurar mantienen las fotos y conexión actuales. Registra peso corporal, cintura, pecho, cadera, brazo y muslo para ver tendencias por periodo. El respaldo JSON manual sí puede incluir fotos y permite moverlas entre dispositivos; como puede ser grande, guárdalo en un lugar seguro.

**CSV** exporta cada serie para analizarla en una hoja de cálculo. **Informe PDF** abre el diálogo de impresión del navegador; elige “Guardar como PDF”. El archivo de rutina compartida no incluye datos de perfil.

Las metas pueden seguir sesiones, peso, una marca en un ejercicio o días consecutivos. Los retos pueden compartirse por invitación y avance mediante archivos JSON; cada persona importa y devuelve el archivo manualmente. No hay chat ni clasificación en vivo.

## Salud de Apple y Android

La versión web permite descargar o compartir un archivo JSON portable con la última sesión. No puede escribir directamente en Apple Health ni Health Connect desde el navegador. Para la conexión nativa haría falta empaquetar Forja para iOS/Android, añadir las integraciones de cada sistema y solicitar los permisos correspondientes. El proyecto actual sigue siendo una PWA: para publicarla en Play Store falta generar y firmar un paquete Android (AAB), probarlo en dispositivos reales y completar la ficha de publicación. Las medidas corporales y sesiones siguen guardadas en Forja mientras tanto.

## Sincronización cifrada entre dispositivos

La sincronización está implementada, pero requiere un proyecto propio de Supabase. Forja cifra el archivo de datos en el dispositivo con AES-GCM y una clave derivada de la frase privada con PBKDF2 antes de enviarlo. Fotos, claves de acceso y frases privadas no se envían en la sincronización. Usa el mismo correo de cuenta, frase privada y nombre de perfil en tus dispositivos. Si pierdes la frase, nadie puede descifrar la copia de la nube.

1. Crea un proyecto en Supabase y una cuenta de usuario con correo y contraseña.
2. En **SQL Editor**, ejecuta [`backend/supabase/schema.sql`](backend/supabase/schema.sql). El esquema limita lectura y escritura a la cuenta dueña con Row Level Security.
3. En **Progreso → Sincronizar**, escribe la URL del proyecto, la clave pública (`publishable` o `anon`), correo, contraseña y una frase privada de al menos 12 caracteres. Pulsa **Iniciar sesión** y **Cifrar y sincronizar**. No uses la clave `service_role` en la app.
4. Repite esos pasos en el otro dispositivo con la misma cuenta, frase y nombre de perfil. La app combina sesiones y registros por identificador/fecha; los cambios nuevos se sincronizan después de guardar.

La app conserva el token de inicio de sesión en el almacenamiento de sesión del navegador. La frase de cifrado no se guarda y hay que volver a escribirla después de abrir una sesión nueva. Las fotos se mueven con el respaldo manual, no con la nube.

## Avisos con Forja cerrada

El recordatorio local solo se comprueba cuando Forja está abierta. Puedes posponer todos los avisos una hora y configurar horas de silencio; el horario del servidor también las respeta para avisos push. Para avisos push con la app cerrada, la app necesita una dirección HTTPS, permisos del navegador y un servidor que despache push. Supabase debe tener activos `pg_cron`, `pg_net` y Vault.

1. Instala la CLI oficial de Supabase y ejecuta `supabase login`; desde `backend/supabase`, enlaza el proyecto con `supabase link --project-ref TU_PROJECT_REF`. Ejecuta `schema.sql` en el SQL Editor.
2. Genera un par VAPID en un equipo de confianza, por ejemplo con `npx web-push generate-vapid-keys`. La clave pública se pega en Forja; la privada queda solo en secretos del servidor.
3. En una terminal dentro de `backend/supabase`, guarda `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (por ejemplo `mailto:tu-correo@ejemplo.com`) y `FORJA_CRON_SECRET` con `supabase secrets set ...`. `SUPABASE_SERVICE_ROLE_KEY` debe existir solo en el servidor de funciones; jamás la pegues en Forja.
4. Despliega `push-dispatch` desde `backend/supabase` con `supabase functions deploy push-dispatch --no-verify-jwt`. La función valida el secreto cron antes de leer suscripciones.
5. Sustituye los tres valores de ejemplo en [`backend/supabase/schedule-push.sql`](backend/supabase/schedule-push.sql) y ejecuta ese SQL una vez en el proyecto. El trabajo llama la función cada minuto. Conserva la URL, clave pública y secreto cron en Supabase Vault.
6. En Forja inicia sesión, pega la **clave pública VAPID**, guarda tus días y hora, y pulsa **Activar avisos aunque cierres Forja**. Acepta el permiso de notificaciones del navegador.

El push solo dice “Tu sesión te espera”; no incluye medidas ni información privada. La disponibilidad final depende del soporte de push y de las restricciones de batería/permisos del navegador y del sistema operativo.

## Datos y fuentes externas

El contenido personal y las fotos se guardan en IndexedDB; los datos que antes estaban en `localStorage` se migran al abrir la versión actual. Si el navegador no admite IndexedDB, Forja intenta conservar los datos en `localStorage`. Usa el respaldo JSON antes de borrar los datos del navegador. El conjunto Gym visual entregado por ti aporta 1.324 JPG y 1.324 GIF guardados junto a Forja a 180 × 180; cada ficha acredita `© Gym visual — https://gymvisual.com/`. Los 56 movimientos originales también usan JPG y GIF del conjunto local; sus variantes se señalan en la ficha cuando no hay coincidencia exacta.

El diseño toma como referencia videos de ejercicios de [press con mancuernas](https://www.muscleandstrength.com/exercises/dumbbell-bench-press.html), [prensa de piernas](https://www.muscleandstrength.com/exercises/45-degree-leg-press.html), [jalón al pecho](https://www.muscleandstrength.com/exercises/lat-pull-down.html) y [sentadilla goblet](https://www.muscleandstrength.com/exercises/dumbbell-goblet-squat). La app no transmite información al abrirse: la conexión de nube y la suscripción push solo se inician desde sus controles.

### Desarrollo y pruebas

La lógica compartida de sincronización, análisis y validación del respaldo vive en `forja-core.js`. Si tienes Node.js instalado, puedes ejecutar la suite completa (lógica y service worker) con `node --test tests/*.test.cjs`.

El tema claro se aplica a todas las pantallas y cambia también el color de la barra del navegador; el manifiesto de instalación cambia entre las variantes clara y oscura según el perfil activo. Puedes elegir cinco colores de acento y cada perfil conserva su selección. En Accesibilidad se puede ajustar el texto, el contraste, el movimiento y el tamaño de los controles; las preferencias se guardan localmente. El respaldo JSON incorpora las fotos privadas guardadas en este dispositivo; para cuidar memoria y espacio en móviles, incluye hasta 500 fotos y 32 MB. La importación valida y normaliza primero el contenido. El service worker conserva la estructura principal para abrir Forja sin red y limita a 180 recursos de ejercicio los medios descargados automáticamente durante el uso. Las imágenes y animaciones que la persona elige guardar desde el catálogo se conservan en una caché separada para acceso sin conexión.
### Referencias técnicas

- [Service workers y contexto seguro · MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker)
- [Push API · MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Row Level Security · Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Programar Edge Functions · Supabase](https://supabase.com/docs/guides/functions/schedule-functions)


## Catálogo de movimientos con Gym visual

Forja incluye los 1.324 movimientos de `dataset-exercises.json`, junto con su imagen JPG, animación GIF e instrucciones en español cuando el conjunto las proporciona. Los nombres se presentan en español y se conserva el nombre original para las búsquedas. Los medios se conservan en `exercise-assets/images` y `exercise-assets/videos` a 180 × 180. Cada ficha conserva la atribución `© Gym visual — https://gymvisual.com/`.

El catálogo permite descargar las 1.324 imágenes o las 1.324 animaciones por separado desde Ejercicios. La descarga muestra el avance, usa conexiones concurrentes moderadas, se puede cancelar y conserva lo ya guardado para reanudarla. Los recursos de cada ficha también se guardan al abrirlos. Antes de publicar o redistribuir el sitio, revisa `exercise-assets/NOTICE.md` y las condiciones de Gym visual: el permiso del repositorio no sustituye una licencia que pueda exigirse para el uso público.
