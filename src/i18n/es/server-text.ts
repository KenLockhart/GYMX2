// Spanish for messages the server sends back in English (form errors and confirmations). Exact
// matches first, then patterns for messages with names or numbers in them.
export const esServerText: Record<string, string> = {
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
];
