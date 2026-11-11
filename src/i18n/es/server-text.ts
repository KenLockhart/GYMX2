import { options } from "./options";

// Spanish for messages the server sends back in English (form errors and confirmations). Exact
// matches first, then patterns for messages with names or numbers in them.
export const esServerText: Record<string, string> = {
  // Shared areas
  "A photo didn't finish uploading. Please try again.":
    "Una foto no terminó de subirse. Inténtalo de nuevo.",
  "Add photos or one video, not both": "Agrega fotos o un video, no ambos.",
  "Add where you'll meet.": "Agrega dónde se van a reunir.",
  "Admins can't send messages.":
    "Los administradores no pueden enviar mensajes.",
  "Choose a coach.": "Elige un coach.",
  "Choose a file to upload.": "Elige un archivo para subir.",
  "Choose a post or a comment to report":
    "Elige una publicación o un comentario para reportar.",
  "Choose an item.": "Elige un artículo.",
  "Choose up to 50 coaches": "Elige hasta 50 coaches.",
  "Choose which coach community": "Elige la comunidad de qué coach.",
  "Coach not found.": "No encontramos a ese coach.",
  "Enter the price like 24.99, or leave it blank.":
    "Escribe el precio, como 24.99, o déjalo en blanco.",
  "Enter the price like 24.99.": "Escribe el precio, como 24.99.",
  "Files can be up to 50 MB.": "Los archivos pueden pesar hasta 50 MB.",
  "Images can be up to 5 MB.": "Las imágenes pueden pesar hasta 5 MB.",
  "Join this coach before reviewing them.":
    "Únete a este coach antes de dejarle una reseña.",
  "Keep details to 1,000 characters.":
    "Usa 1,000 caracteres o menos para los detalles.",
  "Keep payments and contact on GYMX2: remove outside payment or phone details.":
    "Mantén los pagos y el contacto en GYMX2: quita datos de pago externos o teléfonos.",
  "Keep the details under 1,000 characters":
    "Usa menos de 1,000 caracteres para los detalles.",
  "Keep the reason under 500 characters.":
    "Usa menos de 500 caracteres para el motivo.",
  "Keep your message to 1,000 characters.":
    "Usa 1,000 caracteres o menos para tu mensaje.",
  "Keep your reply to 1,000 characters.":
    "Usa 1,000 caracteres o menos para tu respuesta.",
  "Leave this coach first (from their profile), then block them.":
    "Primero deja a este coach (desde su perfil) y luego bloquéalo.",
  "Leave this coach before blocking them.":
    "Deja a este coach antes de bloquearlo.",
  "Nothing to dismiss.": "No hay nada que descartar.",
  "One of those answers didn't look right.":
    "Una de esas respuestas no parece correcta.",
  "Only coaches can post announcements and challenges.":
    "Solo los coaches pueden publicar anuncios y retos.",
  "Only members can block coaches.":
    "Solo los miembros pueden bloquear coaches.",
  "Only members can review coaches.":
    "Solo los miembros pueden dejar reseñas a los coaches.",
  "Only the coach can reply.": "Solo el coach puede responder.",
  "Only this coach and their members can post here.":
    "Solo este coach y sus miembros pueden publicar aquí.",
  "Pick a length.": "Elige una duración.",
  "Pick a star rating": "Elige una calificación de estrellas.",
  "Pick at least one time.": "Elige al menos un horario.",
  "Review removed.": "Reseña eliminada.",
  "Review updated.": "Reseña actualizada.",
  "Saving coaches is for members.": "Guardar coaches es para miembros.",
  "Stripe couldn't refund this order. Please try again, or refund it from the Stripe dashboard.":
    "Stripe no pudo reembolsar este pedido. Inténtalo de nuevo o reembólsalo desde el panel de Stripe.",
  "Stripe has no payment for this order.":
    "Stripe no tiene un pago para este pedido.",
  "Thanks! Your review is posted.": "¡Gracias! Tu reseña está publicada.",
  "That comment wasn't found.": "No encontramos ese comentario.",
  "That photo upload didn't work. Please try again.":
    "La subida de esa foto no funcionó. Inténtalo de nuevo.",
  "That plan isn't available right now.":
    "Ese plan no está disponible por ahora.",
  "That post wasn't found.": "No encontramos esa publicación.",
  "That review wasn't found.": "No encontramos esa reseña.",
  "That video upload didn't work. Please try again.":
    "La subida de ese video no funcionó. Inténtalo de nuevo.",
  "The questionnaire is for members.": "El cuestionario es para miembros.",
  "This coach hasn't finished setting up payments yet.":
    "Este coach todavía no termina de configurar sus pagos.",
  "This is your own plan.": "Este es tu propio plan.",
  "This order was already refunded.": "Este pedido ya fue reembolsado.",
  "Use 200 characters or fewer for the place.":
    "Usa 200 caracteres o menos para el lugar.",
  "Use JPG, PNG or WebP photos.": "Usa fotos JPG, PNG o WebP.",
  "Use a PDF, EPUB, ZIP, MP3, MP4, PNG or JPG file.":
    "Usa un archivo PDF, EPUB, ZIP, MP3, MP4, PNG o JPG.",
  "Use a PNG, JPG or WebP image.": "Usa una imagen PNG, JPG o WebP.",
  "Visible again.": "Visible de nuevo.",
  "We couldn't attach your media. Please try again.":
    "No pudimos adjuntar tus archivos. Inténtalo de nuevo.",
  "We couldn't block this coach. Please try again.":
    "No pudimos bloquear a este coach. Inténtalo de nuevo.",
  "We couldn't dismiss that. Please try again.":
    "No pudimos descartar eso. Inténtalo de nuevo.",
  "We couldn't find that item.": "No encontramos ese artículo.",
  "We couldn't find that order.": "No encontramos ese pedido.",
  "We couldn't join that coach. Please try again.":
    "No pudimos unirte a ese coach. Inténtalo de nuevo.",
  "We couldn't leave that coach. Please try again.":
    "No pudimos sacarte de ese coach. Inténtalo de nuevo.",
  "We couldn't post that comment. Please try again.":
    "No pudimos publicar ese comentario. Inténtalo de nuevo.",
  "We couldn't post that. Please try again.":
    "No pudimos publicar eso. Inténtalo de nuevo.",
  "We couldn't remove that comment. Please try again.":
    "No pudimos quitar ese comentario. Inténtalo de nuevo.",
  "We couldn't remove that item. Please try again.":
    "No pudimos quitar ese artículo. Inténtalo de nuevo.",
  "We couldn't remove that post. Please try again.":
    "No pudimos quitar esa publicación. Inténtalo de nuevo.",
  "We couldn't reset your feed.": "No pudimos restablecer tu feed.",
  "We couldn't save that item. Please try again.":
    "No pudimos guardar ese artículo. Inténtalo de nuevo.",
  "We couldn't save your preferences.": "No pudimos guardar tus preferencias.",
  "We couldn't save your reply. Please try again.":
    "No pudimos guardar tu respuesta. Inténtalo de nuevo.",
  "We couldn't save your review.": "No pudimos guardar tu reseña.",
  "We couldn't send that report. Please try again.":
    "No pudimos enviar ese reporte. Inténtalo de nuevo.",
  "We couldn't send your report. Please try again.":
    "No pudimos enviar tu reporte. Inténtalo de nuevo.",
  "We couldn't share that progress photo.":
    "No pudimos compartir esa foto de progreso.",
  "We couldn't start checkout. Please try again.":
    "No pudimos iniciar el pago. Inténtalo de nuevo.",
  "We couldn't unblock this coach. Please try again.":
    "No pudimos desbloquear a este coach. Inténtalo de nuevo.",
  "Write something or add a photo or video":
    "Escribe algo o agrega una foto o un video.",
  "You already have a membership with this coach. Manage it in My purchases.":
    "Ya tienes una membresía con este coach. Adminístrala en Mis compras.",
  "You blocked this coach. Unblock them to join.":
    "Bloqueaste a este coach. Desbloquéalo para unirte.",
  "You can reply to a comment, not to a reply.":
    "Puedes responder a un comentario, no a una respuesta.",
  "You can't comment on that post.": "No puedes comentar esa publicación.",
  "You can't delete that comment.": "No puedes eliminar ese comentario.",
  "You can't delete that post.": "No puedes eliminar esa publicación.",
  "You can't edit that comment.": "No puedes editar ese comentario.",
  "You can't edit that post.": "No puedes editar esa publicación.",
  "You can't follow that person.": "No puedes seguir a esa persona.",
  "You can't handle this report.": "No puedes atender este reporte.",
  "You can't mute that person.": "No puedes silenciar a esa persona.",
  "You can't post there.": "No puedes publicar ahí.",
  "You can't remove that post.": "No puedes quitar esa publicación.",
  "You can't remove this comment.": "No puedes quitar este comentario.",
  "You can't remove this post.": "No puedes quitar esta publicación.",
  "You can't report this review.": "No puedes reportar esta reseña.",
  "You can't review this post.": "No puedes revisar esta publicación.",
  "You have a paid membership with this coach. Cancel it in My purchases first.":
    "Tienes una membresía de pago con este coach. Primero cancélala en Mis compras.",
  "You're commenting a lot. Try again in a few minutes.":
    "Estás comentando mucho. Inténtalo de nuevo en unos minutos.",
  "You're posting a lot. Take a breather and try again in a few minutes.":
    "Estás publicando mucho. Tómate un respiro e inténtalo de nuevo en unos minutos.",
  "You've sent a lot of reports today. Try again tomorrow.":
    "Enviaste muchos reportes hoy. Inténtalo de nuevo mañana.",
  "Remove guarantees about results.": "Quita las garantías sobre resultados.",
  "Remove medical claims: diagnosing, treating or prescribing is outside fitness coaching.":
    "Quita las afirmaciones médicas: diagnosticar, tratar o recetar está fuera del coaching de fitness.",
  "Only mention medical or dietitian titles you hold; GYMX2 will ask for proof.":
    "Menciona solo títulos médicos o de nutrición que tengas; GYMX2 pedirá comprobante.",
  "Hidden from public pages.": "Oculto de las páginas públicas.",
  "A post can have up to 6 photos or one video":
    "Una publicación puede tener hasta 6 fotos o un video.",
  "Replies go one level deep, on the same post":
    "Las respuestas solo tienen un nivel, en la misma publicación.",
  "Sign in to send messages": "Inicia sesión para enviar mensajes.",
  "Up to 4 photos per message": "Hasta 4 fotos por mensaje.",
  "Write a message or add a photo": "Escribe un mensaje o agrega una foto.",
  "You can only message your coaches and your members":
    "Solo puedes escribirles a tus coaches y a tus miembros.",
  "You can't remove this comment": "No puedes quitar este comentario.",
  "You can't remove this post": "No puedes quitar esta publicación.",
  "You can't review this post": "No puedes revisar esta publicación.",
  "Order not found": "No encontramos ese pedido.",
  "Review not found.": "No encontramos esa reseña.",
  "Report not found.": "No encontramos ese reporte.",
  // Member screens
  "A session can last up to 24 hours.":
    "Una sesión puede durar hasta 24 horas.",
  "A session can last up to 24 hours": "Una sesión puede durar hasta 24 horas.",
  "Add at least one day before publishing.":
    "Agrega al menos un día antes de publicar.",
  "Add the full shop link, starting with https://":
    "Agrega el enlace completo de la tienda, empezando con https://",
  "Answer every scale": "Responde todas las escalas",
  "Chat opens when the session is live.":
    "El chat se abre cuando la sesión está en vivo.",
  "Check-in updated.": "Check-in actualizado.",
  "Check-ins are for members.": "Los check-ins son para miembros.",
  "Checked in. Your coaches can see it now.":
    "Check-in listo. Tus coaches ya pueden verlo.",
  "Choose Going or Can't go.": "Elige Asistiré o No puedo ir.",
  "Choose Going or Can't go": "Elige Asistiré o No puedo ir.",
  "Choose Mind, Body or Spirit.": "Elige Mente, Cuerpo o Espíritu.",
  "Choose a Memo.": "Elige una Nota.",
  "Choose a Task.": "Elige una Tarea.",
  "Choose a category.": "Elige una categoría.",
  "Choose a date and start time.": "Elige una fecha y una hora de inicio.",
  "Choose a day.": "Elige un día.",
  "Choose a habit.": "Elige un hábito.",
  "Choose a photo.": "Elige una foto.",
  "Choose a program.": "Elige un programa.",
  "Choose a session.": "Elige una sesión.",
  "Choose a valid date.": "Elige una fecha válida.",
  "Choose a video.": "Elige un video.",
  "Choose an end time.": "Elige una hora de fin.",
  "Choose at least one member.": "Elige al menos un miembro.",
  "Choose at least one member": "Elige al menos un miembro.",
  "Choose front, side, back or other.": "Elige frente, perfil, espalda u otra.",
  "Choose one of your videos.": "Elige uno de tus videos.",
  "Choose one of your videos that has finished processing":
    "Elige uno de tus videos que ya haya terminado de procesarse.",
  "Choose who to message.": "Elige a quién escribirle.",
  "Choose a start time in the future": "Elige una hora de inicio en el futuro.",
  "Enter a monthly price like 29 or 29.99.":
    "Escribe un precio mensual, como 29 o 29.99.",
  "Enter a percentage like 10.": "Escribe un porcentaje, como 10.",
  "Enter a price of at least $1.00.": "Escribe un precio de al menos $1.00.",
  "Enter a title.": "Escribe un título.",
  "Enter a title": "Escribe un título.",
  "Enter a waist between 15 and 80 inches.":
    "Escribe una cintura entre 15 y 80 pulgadas.",
  "Enter a weight between 50 and 800 lb.": "Escribe un peso entre 50 y 800 lb.",
  "Enter an amount like 5 or 5.00.": "Escribe una cantidad, como 5 o 5.00.",
  "Enter body fat between 2% and 70%.":
    "Escribe una grasa corporal entre 2% y 70%.",
  "Enter the minimum payout.": "Escribe el pago mínimo.",
  "Enter the sale percentage.": "Escribe el porcentaje de venta.",
  "Enter the shipping fee like 5.99, or 0 for free shipping.":
    "Escribe el costo de envío, como 5.99, o 0 para envío gratis.",
  "Enter the sign-up bonus.": "Escribe el bono de registro.",
  "Give the day a title.": "Ponle un título al día.",
  "Intro not found.": "No encontramos esa introducción.",
  "Invite at least one member.": "Invita al menos a un miembro.",
  "Invite at least one member": "Invita al menos a un miembro.",
  "Live video isn't set up yet.":
    "El video en vivo todavía no está configurado.",
  "Name the habit.": "Ponle nombre al hábito.",
  "Name the plan.": "Ponle nombre al plan.",
  "Name the program.": "Ponle nombre al programa.",
  "Only coaches can offer intros.":
    "Solo los coaches pueden ofrecer introducciones.",
  "Only members can book an intro.":
    "Solo los miembros pueden reservar una introducción.",
  "Only the video's coach can change it.":
    "Solo el coach del video puede cambiarlo.",
  "Photos can be up to 10 MB.": "Las fotos pueden pesar hasta 10 MB.",
  "Pick times at least an hour from now.":
    "Elige horarios con al menos una hora de anticipación.",
  "Reply sent.": "Respuesta enviada.",
  "Saved and published. Your members can start it.":
    "Guardado y publicado. Tus miembros ya pueden empezarlo.",
  "Saved.": "Guardado.",
  "See you there.": "Nos vemos ahí.",
  "Someone has booked that time. Cancel the intro first.":
    "Alguien ya reservó ese horario. Primero cancela la introducción.",
  "Someone just booked that time. Please pick another.":
    "Alguien acaba de reservar ese horario. Elige otro.",
  "Tell us a little about how you'll share GYMX2.":
    "Cuéntanos un poco cómo vas a compartir GYMX2.",
  "Thanks for letting your coach know.": "Gracias por avisarle a tu coach.",
  "That check-in wasn't found.": "No encontramos ese check-in.",
  "That day hasn't unlocked yet.": "Ese día todavía no se desbloquea.",
  "That message wasn't found.": "No encontramos ese mensaje.",
  "That price is too high.": "Ese precio es demasiado alto.",
  "That reply wasn't found.": "No encontramos esa respuesta.",
  "That shipping fee is too high.": "Ese costo de envío es demasiado alto.",
  "That time isn't available any more.": "Ese horario ya no está disponible.",
  "That upload didn't work. Please try again.":
    "Esa subida no funcionó. Inténtalo de nuevo.",
  "The link is too long.": "El enlace es demasiado largo.",
  "The live room isn't ready.": "La sala en vivo no está lista.",
  "The meeting link is too long.":
    "El enlace de la reunión es demasiado largo.",
  "The meeting link must be a full address starting with https://":
    "El enlace de la reunión debe ser una dirección completa que empiece con https://",
  "The minimum payout is at least $1.": "El pago mínimo es de al menos $1.",
  "The session must end after it starts.":
    "La sesión debe terminar después de empezar.",
  "The session must end after it starts":
    "La sesión debe terminar después de empezar.",
  "Time not found.": "No encontramos ese horario.",
  "Times must be in the next 120 days.":
    "Los horarios deben estar dentro de los próximos 120 días.",
  "Upload the file buyers will download.":
    "Sube el archivo que descargarán los compradores.",
  "Upload the file people will download.":
    "Sube el archivo que la gente descargará.",
  "Use 1,000 characters or fewer.": "Usa 1,000 caracteres o menos.",
  "Use 100 characters or fewer for the tracking number.":
    "Usa 100 caracteres o menos para el número de rastreo.",
  "Use 100 characters or fewer for the tracking number":
    "Usa 100 caracteres o menos para el número de rastreo.",
  "Use 120 characters or fewer for the title.":
    "Usa 120 caracteres o menos para el título.",
  "Use 2,000 characters or fewer for the description.":
    "Usa 2,000 caracteres o menos para la descripción.",
  "Use 2,000 characters or fewer for the instructions.":
    "Usa 2,000 caracteres o menos para las instrucciones.",
  "Use 2,000 characters or fewer for the notes.":
    "Usa 2,000 caracteres o menos para las notas.",
  "Use 20 sizes or fewer.": "Usa 20 tallas o menos.",
  "Use 200 characters or fewer for the location.":
    "Usa 200 caracteres o menos para el lugar.",
  "Use 3 to 24 lowercase letters, numbers or dashes, starting with a letter or number.":
    "Usa de 3 a 24 letras minúsculas, números o guiones, empezando con una letra o un número.",
  "Use 4,000 characters or fewer for the description.":
    "Usa 4,000 caracteres o menos para la descripción.",
  "Use 4,000 characters or fewer.": "Usa 4,000 caracteres o menos.",
  "Use 4,000 characters or fewer": "Usa 4,000 caracteres o menos.",
  "Use 5,000 characters or fewer.": "Usa 5,000 caracteres o menos.",
  "Use 60 characters or fewer for the name.":
    "Usa 60 caracteres o menos para el nombre.",
  "Use a JPG, PNG or WebP photo.": "Usa una foto JPG, PNG o WebP.",
  "Use a day from 1 to 365.": "Usa un día del 1 al 365.",
  "Use a monthly price from $1 to $1,000.":
    "Usa un precio mensual de $1 a $1,000.",
  "Use a percentage up to 100.": "Usa un porcentaje de hasta 100.",
  "Use an amount up to $1,000.": "Usa una cantidad de hasta $1,000.",
  "Use numbers with up to one decimal, like 182.4.":
    "Usa números con hasta un decimal, como 182.4.",
  "Use whole days.": "Usa días completos.",
  "Use whole months.": "Usa meses completos.",
  "Use whole numbers for your targets.": "Usa números enteros para tus metas.",
  "Use whole numbers, like 150.": "Usa números enteros, como 150.",
  "We couldn't add that habit. Please try again.":
    "No pudimos agregar ese hábito. Inténtalo de nuevo.",
  "We couldn't add those times. Please try again.":
    "No pudimos agregar esos horarios. Inténtalo de nuevo.",
  "We couldn't cancel that session. Please try again.":
    "No pudimos cancelar esa sesión. Inténtalo de nuevo.",
  "We couldn't create that program. Please try again.":
    "No pudimos crear ese programa. Inténtalo de nuevo.",
  "We couldn't delete that Memo. Please try again.":
    "No pudimos eliminar esa Nota. Inténtalo de nuevo.",
  "We couldn't delete that Task. Please try again.":
    "No pudimos eliminar esa Tarea. Inténtalo de nuevo.",
  "We couldn't delete that photo.": "No pudimos eliminar esa foto.",
  "We couldn't delete that video. Please try again.":
    "No pudimos eliminar ese video. Inténtalo de nuevo.",
  "We couldn't delete the program. Please try again.":
    "No pudimos eliminar el programa. Inténtalo de nuevo.",
  "We couldn't find that session.": "No encontramos esa sesión.",
  "We couldn't find that video.": "No encontramos ese video.",
  "We couldn't leave that program. Please try again.":
    "No pudimos sacarte de ese programa. Inténtalo de nuevo.",
  "We couldn't open the live room. Please try again.":
    "No pudimos abrir la sala en vivo. Inténtalo de nuevo.",
  "We couldn't remove that day.": "No pudimos quitar ese día.",
  "We couldn't remove that habit. Please try again.":
    "No pudimos quitar ese hábito. Inténtalo de nuevo.",
  "We couldn't remove that time. Please try again.":
    "No pudimos quitar ese horario. Inténtalo de nuevo.",
  "We couldn't save that Memo. Please try again.":
    "No pudimos guardar esa Nota. Inténtalo de nuevo.",
  "We couldn't save that Task. Please try again.":
    "No pudimos guardar esa Tarea. Inténtalo de nuevo.",
  "We couldn't save that photo. Please try again.":
    "No pudimos guardar esa foto. Inténtalo de nuevo.",
  "We couldn't save that. Please try again.":
    "No pudimos guardar eso. Inténtalo de nuevo.",
  "We couldn't save the program. Please try again.":
    "No pudimos guardar el programa. Inténtalo de nuevo.",
  "We couldn't save your check-in. Please try again.":
    "No pudimos guardar tu check-in. Inténtalo de nuevo.",
  "We couldn't save your settings. Please try again.":
    "No pudimos guardar tu configuración. Inténtalo de nuevo.",
  "We couldn't send that.": "No pudimos enviar eso.",
  "We couldn't send your reply. Please try again.":
    "No pudimos enviar tu respuesta. Inténtalo de nuevo.",
  "We couldn't start that program. Please try again.":
    "No pudimos empezar ese programa. Inténtalo de nuevo.",
  "We couldn't start the upload. Please try again.":
    "No pudimos iniciar la subida. Inténtalo de nuevo.",
  "We couldn't update that Task. Please try again.":
    "No pudimos actualizar esa Tarea. Inténtalo de nuevo.",
  "Write a message first.": "Primero escribe un mensaje.",
  "Write a message first": "Primero escribe un mensaje.",
  "Write a note first.": "Primero escribe una nota.",
  "Write a reply first": "Primero escribe una respuesta.",
  "Write something first": "Primero escribe algo.",
  "You can add photos for the last 7 days.":
    "Puedes agregar fotos de los últimos 7 días.",
  "You can go live from 30 minutes before the start until an hour after the end.":
    "Puedes transmitir en vivo desde 30 minutos antes del inicio hasta una hora después del final.",
  "You can log the last 7 days.": "Puedes registrar los últimos 7 días.",
  "You can only update the last 7 days.":
    "Solo puedes actualizar los últimos 7 días.",
  "You can't remove that message.": "No puedes eliminar ese mensaje.",
  "Task not found": "No encontramos esa Tarea.",
  "Session not found": "No encontramos esa sesión.",
  "Tasks can only go to members who joined you":
    "Solo puedes asignar Tareas a miembros que se unieron a ti.",
  "You can only invite members who joined you":
    "Solo puedes invitar a miembros que se unieron a ti.",
  "Coach access required": "Se requiere acceso de coach.",
  "This intro has already started.": "Esta introducción ya empezó.",
  "This intro was already cancelled.": "Esta introducción ya se canceló.",
  "You already have an intro with this coach.":
    "Ya tienes una introducción con este coach.",
  "You can have up to 3 upcoming intros at a time.":
    "Puedes tener hasta 3 introducciones próximas a la vez.",
  "That photo upload didn't work": "La subida de esa foto no funcionó.",
  // General
  "That didn't work. Please try again.": "Eso no funcionó. Inténtalo de nuevo.",
  "Please try again.": "Inténtalo de nuevo.",
  // Sign-up, log-in and passwords
  "Enter a valid email address.": "Escribe un correo electrónico válido.",
  "Use at least 8 characters for your password.":
    "Usa al menos 8 caracteres para tu contraseña.",
  "Use 72 characters or fewer for your password.":
    "Usa 72 caracteres o menos para tu contraseña.",
  "Enter your name.": "Escribe tu nombre.",
  "Use 80 characters or fewer for your name.":
    "Usa 80 caracteres o menos para tu nombre.",
  "Enter your password.": "Escribe tu contraseña.",
  "That email and password didn't match, or the email isn't confirmed yet.":
    "Ese correo y esa contraseña no coinciden, o el correo aún no está confirmado.",
  "We couldn't create that account. Check your details or try logging in.":
    "No pudimos crear esa cuenta. Revisa tus datos o intenta iniciar sesión.",
  "Check your email for a link to confirm your account.":
    "Revisa tu correo: te enviamos un enlace para confirmar tu cuenta.",
  "If that email has an account, a reset link is on its way.":
    "Si ese correo tiene una cuenta, te enviamos un enlace para restablecer la contraseña.",
  "We couldn't update your password. Request a new reset link and try again.":
    "No pudimos actualizar tu contraseña. Pide un nuevo enlace e inténtalo de nuevo.",
  // Profile
  "Use 1,000 characters or fewer for your bio.":
    "Usa 1,000 caracteres o menos para tu bio.",
  "We couldn't save your profile. Please try again.":
    "No pudimos guardar tu perfil. Inténtalo de nuevo.",
  "Profile saved.": "Perfil guardado.",
  "Type DELETE in capital letters to confirm.":
    "Escribe ELIMINAR en mayúsculas para confirmar.",
  "That password isn't right.": "Esa contraseña no es correcta.",
  "We couldn't delete your account. Please email support@gymx2.com and we'll do it for you.":
    "No pudimos eliminar tu cuenta. Escríbenos a support@gymx2.com y lo haremos por ti.",
  "Admins can't delete their own account. Ask another admin to change your role to member first.":
    "Los administradores no pueden eliminar su propia cuenta. Pide a otro administrador que primero cambie tu rol a miembro.",
  "You've sold items in the Armory, so we close coach accounts by hand to settle your buyers and payouts. Email support@gymx2.com and we'll take care of it.":
    "Vendiste artículos en la Armory, así que cerramos las cuentas de coach manualmente para resolver tus compradores y pagos. Escríbenos a support@gymx2.com y nos encargamos.",
  "You have members on paid plans. Email support@gymx2.com so we can wind their memberships down before closing your account.":
    "Tienes miembros en planes pagados. Escríbenos a support@gymx2.com para terminar sus membresías antes de cerrar tu cuenta.",
  "You have affiliate commissions that haven't been paid yet. Email support@gymx2.com and we'll settle them and close your account.":
    "Tienes comisiones de afiliado sin pagar. Escríbenos a support@gymx2.com y las liquidaremos antes de cerrar tu cuenta.",
  "Use 3 to 40 lowercase letters, numbers and single dashes, like ken-lockhart.":
    "Usa de 3 a 40 letras minúsculas, números y guiones simples, como ken-lockhart.",
  "Another coach already has that address. Try another.":
    "Otro coach ya tiene esa dirección. Prueba con otra.",
  "Saved. Your page is off.": "Guardado. Tu página está desactivada.",
  "Your browser sent something we didn't expect. Please try again.":
    "Tu navegador envió algo inesperado. Inténtalo de nuevo.",
  "We couldn't turn on notifications. Please try again.":
    "No pudimos activar las notificaciones. Inténtalo de nuevo.",
  "No device got it. Turn notifications off and on again.":
    "Ningún dispositivo la recibió. Desactiva y vuelve a activar las notificaciones.",
  "Those settings didn't look right.": "Esa configuración no parece correcta.",
  "We couldn't save your settings.": "No pudimos guardar tu configuración.",
  // Goals and specialties
  "Pick at least one goal": "Elige al menos una meta",
  "Pick your experience": "Elige tu experiencia",
  "Pick your main focus": "Elige tu enfoque principal",
  "We couldn't save your answers. Please try again.":
    "No pudimos guardar tus respuestas. Inténtalo de nuevo.",
  "We couldn't save your goals. Please try again.":
    "No pudimos guardar tus metas. Inténtalo de nuevo.",
  "Goals saved.": "Metas guardadas.",
  "Only coaches have specialties.": "Solo los coaches tienen especialidades.",
  "Pick from the list.": "Elige de la lista.",
  "We couldn't save your specialties. Please try again.":
    "No pudimos guardar tus especialidades. Inténtalo de nuevo.",
  "Specialties saved. Members with these goals will see you suggested.":
    "Especialidades guardadas. Los miembros con estas metas te verán como sugerencia.",
};

const linkName = (label: string) =>
  label === "website" ? "del sitio web" : `de ${label}`;

// "✅ First Rep, 🔟 Dialed In" → the same badges with Spanish names.
const badgeList = (list: string) =>
  list
    .split(", ")
    .map((entry) => {
      const space = entry.indexOf(" ");
      const name = entry.slice(space + 1);
      return `${entry.slice(0, space)} ${options.badges[name]?.name ?? name}`;
    })
    .join(", ");

export const esServerPatterns: [RegExp, (...parts: string[]) => string][] = [
  [
    /^The (.+) link is too long\.$/,
    (label) => `El enlace ${linkName(label)} es demasiado largo.`,
  ],
  [
    /^The (.+) link must be a full address starting with https:\/\/$/,
    (label) =>
      `El enlace ${linkName(label)} debe ser una dirección completa que empiece con https://`,
  ],
  [
    /^Your page is live at (.+)$/,
    (url) => `Tu página está publicada en ${url}`,
  ],
  [/^New badge: (.+)!$/, (list) => `¡Nueva insignia: ${badgeList(list)}!`],
  [/^Nice work! \+(\d+) points\.$/, (n) => `¡Buen trabajo! +${n} puntos.`],
  [
    /^Keep it to (\d+) habits\. Remove one to add another\.$/,
    (n) => `Máximo ${n} hábitos. Quita uno para agregar otro.`,
  ],
  [
    /^This video is used by (\d+) Tasks?\. Delete (?:that Task|those Tasks) on the Tasks page first, then try again\.$/,
    (n) =>
      `Este video se usa en ${n === "1" ? "1 Tarea" : `${n} Tareas`}. Primero elimínala${n === "1" ? "" : "s"} en la página de Tareas y vuelve a intentarlo.`,
  ],
  [
    /^This video is still used by a Task\. Delete that Task first, then try again\.$/,
    () =>
      "Este video todavía se usa en una Tarea. Primero elimina esa Tarea y vuelve a intentarlo.",
  ],
  [
    /^Up to (\d+) photos per (message|post)\.$/,
    (n, kind) =>
      `Hasta ${n} fotos por ${kind === "post" ? "publicación" : "mensaje"}.`,
  ],
  [/^Renews (.+)$/, (date) => `Se renueva el ${date}`],
  [/^Ends (.+)$/, (date) => `Termina el ${date}`],
  [/^Free trial until (.+)$/, (date) => `Prueba gratis hasta el ${date}`],
  [/^Free trial, ends (.+)$/, (date) => `Prueba gratis, termina el ${date}`],
  [/^Shipped · Tracking (.+)$/, (code) => `Enviado · Rastreo ${code}`],
  [/^(.+)'s community$/, (name) => `Comunidad de ${name}`],
];
