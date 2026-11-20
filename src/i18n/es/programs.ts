import type { Messages } from "../messages";

export const programs: Messages["programs"] = {
  title: "Programas",
  program: "Programa",
  introCoach:
    "Crea programas de varias semanas como una serie de días. Los miembros que se unieron a ti empiezan uno, y cada día se desbloquea un día nuevo.",
  introAdmin: "Crea programas de GYMX2 y administra los programas de todos los coaches.",
  introMember:
    "Programas de los coaches a los que te uniste y de GYMX2. Cada día se desbloquea uno nuevo; terminarlo vale +3 puntos.",
  new: "Nuevo programa",
  programTitle: "Título",
  titlePlaceholder: "Inicio fuerte en 6 semanas",
  descriptionOptional: "Descripción (opcional)",
  introVideoOptional: "Video introductorio del programa (opcional)",
  noIntroVideo: "Sin video introductorio",
  introVideoHint:
    "Elige un video listo de tu propia biblioteca. Solo los miembros con acceso al programa pueden ver este video introductorio seleccionado.",
  programIntro: "Introducción del programa",
  introVideoUnavailable: "El video introductorio no está disponible en este momento.",
  platform: "GYMX2",
  description: "Descripción",
  creating: "Creando...",
  create: "Crear y agregar días",
  none: "Todavía no hay programas.",
  aCoach: "Un coach",
  started: (n) => (n === 1 ? "1 lo empezó" : `${n} lo empezaron`),
  published: "Publicado",
  draft: "Borrador",
  weeks: (dayCount) => {
    if (dayCount === 0) return "Aún no tiene días";
    const weeks = Math.ceil(dayCount / 7);
    return dayCount < 7
      ? `${dayCount} ${dayCount === 1 ? "día" : "días"}`
      : `${weeks} ${weeks === 1 ? "semana" : "semanas"} · ${dayCount} días`;
  },
  yours: "Tus programas",
  noneStarted: "Todavía no has empezado ninguno.",
  dayOf: (day, total, done) => `Día ${day} de ${total} · ${done} hechos`,
  fromCoaches: "De tus coaches",
  availablePrograms: "Programas disponibles",
  noneNew: "No hay programas nuevos por ahora.",
  findCoach: "Encontrar un coach",
  starting: "Empezando...",
  startToday: "Empezar hoy",
  back: "Volver a programas",
  publishedHint: "Los miembros que se unieron a ti pueden verlo y empezarlo.",
  publishedPlatformHint:
    "Los miembros pueden encontrar y empezar este programa de GYMX2 en la sección Programas con sesión iniciada.",
  saving: "Guardando...",
  saveProgram: "Guardar programa",
  days: (label) => `Días · ${label}`,
  dayTitle: (n, title) => `Día ${n}: ${title}`,
  confirmRemoveDay: (n) => `¿Quitar el día ${n}?`,
  removing: "Quitando...",
  remove: "Quitar",
  edit: "Editar",
  addDayN: (n) => `Agregar día ${n}`,
  day: "Día",
  dayTitlePlaceholder: "Fuerza de cuerpo completo",
  pillar: "Pilar",
  choose: "Elige",
  instructions: "Instrucciones",
  videoOptional: "Video (opcional)",
  noVideo: "Sin video",
  saveDay: "Guardar día",
  addDay: "Agregar día",
  membersOn: "Miembros en este programa",
  nobody: "Nadie lo ha empezado todavía.",
  aMember: "Un miembro",
  memberProgress: (day, done, total, percent) =>
    `Día ${day} · ${done} de ${total} hechos (${percent}%)`,
  confirmDelete: (title) =>
    `¿Eliminar "${title}"? Los miembros pierden su progreso en él.`,
  deleting: "Eliminando...",
  delete: "Eliminar programa",
  byCoach: (coach) => `Programa · ${coach}`,
  yourCoach: "tu coach",
  daysDone: (done, total) => `${done} de ${total} días hechos`,
  currentProgress: (done, total) =>
    `Versión actual · ${done} de ${total} lecciones completadas`,
  historyProgress: (count) =>
    `${count} lecciones completadas en el historial guardado`,
  upNext: (n) => `Sigue: día ${n}`,
  caughtUp: "Estás al día",
  watch: (title) => `Ver: ${title}`,
  theVideo: "el video",
  unlocks: (date) => `Se desbloquea el ${date}`,
  undo: "Deshacer",
  markDone: "Marcar como hecho",
  confirmLeave: (title) => `¿Dejar "${title}"? Perderás tu progreso en él.`,
  leaving: "Saliendo...",
  leave: "Dejar programa",
};
