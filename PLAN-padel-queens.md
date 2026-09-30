# Plan de trabajo: Plataforma Padel Queens (padelqueensclub.com)

## 1. Qué estamos construyendo
Una web completa para Padel Queens que cumple tres objetivos por igual: vender cupos a eventos, crecer la comunidad y atraer patrocinadores. Deja de ser una landing y pasa a ser una plataforma de torneos con cuentas de jugadoras.

Idioma: solo español. Ritmo: sin prisa, por fases, cada fase termina en algo usable.

## 2. Decisiones ya tomadas (entrevista)
- Inscripción: formulario + pago con CardNet.
- Parejas: se inscriben en pareja (una jugadora registra a su compañera).
- Pago: la jugadora elige pagar solo su parte o pagar por las dos.
- Cuentas: registro con correo electrónico.
- Jugadora puede: inscribirse y pagar, ver estado de pago, perfil con foto, nivel e historial, ver su ranking, buscar pareja.
- Puntuaciones: resultados por partido, tabla por torneo, ranking de temporada y cuadros de eliminación (brackets).
- Admin gestiona: eventos y links de pago, galería, inscripciones y parejas, partners, textos de la web, resultados y puntuaciones.
- Marca: azul marino profundo, dorado, acento arcilla. Logo corona blanca sobre círculo azul marino. Tipografías Sora y Fraunces. Sin em dashes en los textos.

## 3. Arquitectura (todo en Cloudflare, dominio ya ahí)
- Frontend: sitio estático servido por Cloudflare Workers (static assets) en padelqueensclub.com.
- API: Worker en api.padelqueensclub.com (ya existe el código base en padelqueens-worker.zip).
- Base de datos: D1 `padelqueens-events` (id 52d74fb0-84f4-43ff-b998-dc7f7a67f1c5), ya tiene la tabla `events` con 3 eventos.
- Fotos: R2 (bucket `padelqueens-media`).
- Correos (verificación, recuperar contraseña, confirmación de inscripción): proveedor transaccional tipo Resend. Pendiente de decidir.
- Autenticación: correo + contraseña (hash PBKDF2 con WebCrypto), verificación de correo, sesiones con token firmado. Rol `admin` en la tabla de usuarios reemplaza el "código de administrador" actual.
- Recomendado: mover el proyecto a un repositorio de GitHub para desplegar con `wrangler` y tener historial.

## 4. Modelo de datos (D1)
- `users`: id, email, password_hash, email_verified, role (player/admin), created_at
- `profiles`: user_id, nombre, foto_url, categoria (1ra a 5ta), telefono, busca_pareja (sí/no)
- `events`: (ya existe) + formato (americano, grupos, eliminación), categoria, cupo_max, precio, fecha real, estado (borrador, abierto, cerrado, en juego, finalizado)
- `registrations` (pareja inscrita): id, event_id, player1_id, player2_id o player2_email (si la compañera aún no tiene cuenta), estado (pendiente, confirmada, cancelada)
- `payments`: id, registration_id, user_id que paga, cubre (propia / ambas), monto, estado (pendiente, pagado), referencia CardNet, marcado_por
- `matches`: id, event_id, ronda, pareja_a, pareja_b, cancha, hora, estado
- `scores`: match_id, sets (ej. 6-4, 3-6, 10-8), ganador
- `ranking_points`: user_id, event_id, puntos, temporada
- `photos`: id, event_id opcional, url R2, álbum (Events, Torneos, Behinds, Partners), orden
- `partners`: id, nombre, logo_url, link, orden
- `site_content`: clave, valor (textos editables del hero, manifiesto, CTA)

## 5. Fases

### Fase 0. Base técnica
- Desplegar el Worker actual y confirmar que la web lee los eventos en vivo.
- Pasar a repositorio, estructura de migraciones D1, entorno de pruebas.
- Resultado: la web actual funcionando en padelqueensclub.com con eventos desde la base de datos.

### Fase 1. Cuentas + inscripción en pareja + pago (MVP para cobrar)
- Registro, login, verificar correo, recuperar contraseña.
- Página de evento con formulario: jugadora 1 (ella), jugadora 2 (buscar por correo o invitar), categoría.
- Invitación a la compañera: le llega correo, crea cuenta y confirma.
- Elegir pagar "mi parte" o "las dos". Redirige al link de CardNet con el monto correcto.
- Estado de pago: con links de CardNet no hay confirmación automática, así que el admin marca "pagado" (ver decisión pendiente A).
- "Mi cuenta": mis inscripciones y estado de pago.
- Resultado: se puede abrir un torneo, recibir inscripciones de parejas y cobrar.

### Fase 2. Panel de administración completo
- Login admin por rol (reemplaza el código fijo).
- Eventos: crear, editar, cambiar estado, cupos, precios, links de pago.
- Inscripciones: ver parejas por evento y categoría, marcar pagos, exportar a Excel/CSV.
- Galería: subir fotos a R2, ordenar por álbum.
- Partners y textos editables.
- Resultado: la web se gestiona sin tocar código.

### Fase 3. Competición y puntuaciones
- Generar partidos según formato: americano, fase de grupos, eliminación directa.
- Cargar resultados por partido (admin, o árbitro con rol propio).
- Tabla del torneo que se calcula sola; bracket que avanza solo.
- Vista pública en vivo del torneo (ideal para el día del evento en el celular).
- Resultado: el torneo se corre desde la web.

### Fase 4. Ranking, perfiles y buscar pareja
- Puntos por posición final en cada torneo, ranking de temporada por categoría.
- Perfil de jugadora: foto, nivel, historial de partidos, puntos.
- "Busco pareja": listado de jugadoras disponibles por categoría para un evento.
- Resultado: comunidad activa que vuelve a la web entre torneos.

### Fase 5. Pulido y patrocinadores
- Página de patrocinios con métricas (seguidores, alcance, eventos) y formulario de contacto.
- Correos de confirmación y recordatorios.
- SEO, rendimiento, accesibilidad, seguridad (límite de intentos de login, validaciones).

## 6. Decisiones pendientes
A. Confirmación de pagos: seguir con links de CardNet y marcar manualmente, o pedir a CardNet acceso a su API/webhook para confirmación automática (requiere afiliación de comercio y credenciales).
B. Sistema de puntos del ranking: cuántos puntos por campeona, finalista, semifinal, participación.
C. Lista de categorías oficial (1ra a 5ta, mixto, etc.).
D. Proveedor de correos y remitente (ej. hola@padelqueensclub.com).
E. Si una compañera sin cuenta puede quedar inscrita solo con su correo o si es obligatorio que cree cuenta.
F. Política de cancelación y reembolso.

## 7. Cómo trabajar con Sonnet 5.5
Cambia el modelo a Sonnet 5.5 en este chat y pégale:

> Lee PLAN-padel-queens.md y trabaja la Fase 0 y luego la Fase 1. Usa la base D1 existente y el Worker de padelqueens-worker.zip. Mantén la identidad visual actual de padel-queens.html. Antes de cada fase dime qué vas a hacer y al terminar dime qué quedó listo y qué me toca hacer a mí (despliegues, secretos, etc.). No uses em dashes en los textos de la web.

Luego avanza una fase por vez y revisa cada una antes de seguir.
