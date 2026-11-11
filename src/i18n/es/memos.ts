import type { Messages } from "../messages";

export const memos: Messages["memos"] = {
  title: "Notas",
  intro: "Escribe notas breves sobre tus días.",
  introShare:
    "Son privadas, a menos que decidas compartir alguna con tus coaches.",
  introPrivate: "Son privadas, solo para ti.",
  cancelEditing: "Cancelar edición",
  loadError:
    "No pudimos cargar tus Notas. Actualiza la página e inténtalo de nuevo.",
  none: "Todavía no has escrito ninguna Nota.",
  shared: " · Compartida con tus coaches",
  edit: "Editar",
  confirmDelete: "¿Eliminar esta Nota? Esto no se puede deshacer.",
  delete: "Eliminar",
  deleting: "Eliminando...",
  date: "Fecha",
  editNote: "Edita tu nota",
  howToday: "¿Cómo te fue hoy?",
  share: "Compartir con mis coaches",
  shareHint: "Si no, solo tú puedes leer esta Nota.",
  saving: "Guardando...",
  saveChanges: "Guardar cambios",
  save: "Guardar Nota",
};

export const notificationsPage: Messages["notificationsPage"] = {
  title: "Notificaciones",
  intro:
    "Me gusta, comentarios, respuestas y anuncios de la comunidad. Elige qué recibes en Perfil, Notificaciones.",
  someone: "Alguien",
  nothing:
    "Aún no hay nada. Cuando alguien reaccione o comente tus publicaciones, lo verás aquí.",
  allCaughtUp: "Estás al día.",
  unread: (n) => `${n} sin leer`,
  markAllRead: "Marcar todo como leído",
  recent: "Recientes",
  today: "Hoy",
  yesterday: "Ayer",
  unreadTag: " · sin leer",
  others: (count) =>
    count <= 1
      ? ""
      : count === 2
        ? " y 1 persona más"
        : ` y ${count - 1} personas más`,
  like: (name, others) =>
    others
      ? `A ${name}${others.replace(" y ", " y a ")} les gustó tu publicación`
      : `A ${name} le gustó tu publicación`,
  comment: (who) => `${who} comentó tu publicación`,
  progress_reply: (who) => `${who} comentó tu publicación de progreso`,
  reply: (who) => `${who} respondió a tu comentario`,
  announcement: (name, count) =>
    count > 1
      ? `${name} publicó ${count} anuncios`
      : `${name} publicó un anuncio`,
  removed:
    "Se eliminó una de tus publicaciones por no cumplir las normas de la comunidad",
  mention: (who) => `${who} te mencionó`,
  message: (who) => `${who} te envió un mensaje`,
};
