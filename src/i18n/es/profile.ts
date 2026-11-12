import type { Messages } from "../messages";

export const goalsForm: Messages["goalsForm"] = {
  goals: "¿En qué quieres trabajar?",
  goalsHint: "Elige todas las que quieras.",
  experience: "¿Cuánta experiencia tienes?",
  focus: "¿Por dónde quieres empezar?",
};

export const profile: Messages["profile"] = {
  title: "Tu perfil",
  coachProfileLink: "Tu perfil de coach",
  coachProfileHint:
    "Foto, historia, estilo de coaching, precios y más: la página que ven los miembros cuando te encuentran.",
  photo: {
    title: "Tu foto de cuenta",
    body: "Personaliza tu cuenta de GYMX2 con una foto.",
    privacy:
      "Solo tú y los administradores de GYMX2 pueden ver esta foto privada de cuenta. Es independiente de la foto de tu perfil público de coach.",
    upload: "Agregar foto",
    replace: "Cambiar foto",
    remove: "Quitar foto",
    fileHint: "JPG, PNG o WebP · hasta 5 MB",
    imageAlt: "Tu foto de cuenta",
    previewAlt: "Vista previa de tu nueva foto de cuenta",
    uploading: "Subiendo y revisando tu foto…",
    removing: "Quitando foto…",
    uploadSuccess: "Tu foto está guardada.",
    removeSuccess: "Tu foto se quitó.",
    errors: {
      "invalid-type": "Elige una imagen JPG, PNG o WebP.",
      "too-large": "Elige una imagen de hasta 5 MB.",
      "invalid-path": "No se pudo verificar esa carga de foto.",
      "upload-unavailable": "Esta carga de foto venció. Elígela de nuevo.",
      "upload-missing": "La foto no terminó de subir. Inténtalo de nuevo.",
      "invalid-image": "Ese archivo no es una imagen válida. Elige otra foto.",
      "save-failed": "No pudimos guardar la foto. Inténtalo de nuevo.",
      "remove-failed": "No pudimos quitar la foto. Inténtalo de nuevo.",
      "upload-failed": "La carga se detuvo. Revisa tu conexión e inténtalo de nuevo.",
    },
  },
  goals: {
    title: "Tus metas",
    body: "Las usamos para sugerirte coaches. Los coaches a los que te unes las ven para adaptar tu entrenamiento.",
    matches: "Ver tus coaches sugeridos",
    save: "Guardar metas",
  },
  specialties: {
    title: "Tus especialidades",
    body: "Los miembros nuevos eligen sus metas al registrarse. Elige en qué eres mejor como coach y te sugeriremos a los miembros que lo buscan.",
    save: "Guardar especialidades",
  },
  publicPage: {
    title: "Página pública",
    body: "Una página que puedes compartir en redes sociales y en tu bio para que nuevas personas te encuentren y se unan en GYMX2.",
    view: "Ver tu página",
    address: "Tu dirección",
    on: "Página activada",
    onHint:
      "Cualquier persona con el enlace, y los buscadores, pueden ver tu nombre, bio, enlaces, especialidades, programas publicados, planes de membresía y reseñas de miembros. Nunca tu correo ni tus miembros.",
    save: "Guardar página pública",
  },
  push: {
    title: "Notificaciones en el teléfono",
    admin:
      "Recibe una notificación en este dispositivo cuando un mensaje necesite revisión.",
    coach:
      "Recibe una notificación en este dispositivo por mensajes nuevos y publicaciones de grupo de tus miembros.",
    member:
      "Recibe una notificación en este dispositivo por mensajes, publicaciones de grupo, cuando tu coach esté en vivo y por nuevos días de programa.",
    eachDevice:
      "Actívalas por separado en cada teléfono o computadora que uses.",
    checking: "Revisando este dispositivo...",
    unsupported:
      "Este navegador no puede recibir notificaciones. Prueba con Chrome, Edge, Firefox o Safari.",
    iosTitle: "En iPhone y iPad, primero agrega GYMX2 a tu pantalla de inicio.",
    iosBefore: "En Safari, toca el botón Compartir y luego",
    iosAdd: "Agregar a inicio",
    iosAfter:
      ". Abre GYMX2 desde el nuevo ícono y vuelve aquí para activar las notificaciones.",
    blocked:
      "Las notificaciones de GYMX2 están bloqueadas en la configuración de este navegador. Permítelas ahí y vuelve a cargar esta página.",
    turnOn: "Activar notificaciones",
    turningOn: "Activando...",
    test: "Enviar una prueba",
    turnOff: "Desactivar en este dispositivo",
    on: "Las notificaciones están activadas en este dispositivo.",
    failed:
      "Este navegador no pudo activar las notificaciones. Inténtalo de nuevo.",
    sent: "Enviada. Debería aparecer en unos segundos.",
  },
  community: {
    title: "Notificaciones de la comunidad",
    body: "Elige qué aparece en tus notificaciones (la campana del menú), qué se envía a tu teléfono y qué te enviamos por correo. Las notificaciones en el teléfono también deben estar activadas arriba, y los correos necesitan tener activada la opción “Envíame correos sobre mensajes, sesiones y recordatorios” en tu perfil.",
    notifyMe: "Avísame sobre",
    inApp: "En la app",
    phone: "Teléfono",
    email: "Correo",
    notInCenter: "No aparece en el centro de notificaciones",
    save: "Guardar configuración de notificaciones",
  },
  affiliate: {
    title: "Programa de afiliados",
    body: "Gana dinero trayendo personas a GYMX2: una parte de lo que compren durante un año, más un bono cuando hagan su primera compra.",
    open: "Abrir el programa de afiliados",
  },
  data: {
    title: "Tus datos",
    body: "Descarga una copia de todo lo que GYMX2 guarda sobre ti: tu perfil, mensajes, registros, check-ins, compras y más, en un archivo JSON que puedes abrir en cualquier editor de texto.",
    download: "Descargar mis datos",
  },
  form: {
    bio: "Bio",
    social: "Redes sociales",
    website: "Sitio web",
    emails: "Correos",
    emailUpdates: "Envíame correos sobre mensajes, sesiones y recordatorios",
    emailUpdatesHint:
      "Incluye recordatorios de sesiones y de Tareas por vencer, avisos de racha y un resumen los lunes. Siempre te escribimos sobre tus pedidos.",
    save: "Guardar perfil",
  },
  delete: {
    title: "Eliminar tu cuenta",
    confirm:
      "¿Eliminar tu cuenta de GYMX2 para siempre? Esto no se puede deshacer.",
    profileGone:
      "Se eliminan tu perfil, mensajes, Tareas, Notas y respuestas del calendario.",
    coachGone:
      "Se eliminan tus videos, Tareas, sesiones y artículos de la Armory, y los miembros pierden acceso a ellos.",
    downloads:
      "Las descargas que compraste dejan de funcionar. El equipo ya pedido se envía de todos modos.",
    records:
      "Guardamos los registros de compras anteriores por motivos fiscales, sin tu nombre.",
    typeDelete: "Escribe ELIMINAR para confirmar",
    password: "Tu contraseña",
    submit: "Eliminar mi cuenta",
    pending: "Eliminando...",
  },
};
