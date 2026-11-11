import type { Messages } from "../messages";

export const dashboard: Messages["dashboard"] = {
  title: "Inicio",
  welcome: (name) => `Hola, ${name}`,
  intro: {
    member:
      "Ya estás dentro. Únete a un coach para empezar a recibir Tareas y sesiones, y lleva notas diarias en tus Notas.",
    coach:
      "Ya estás registrado como coach. Sube videos a tu biblioteca, asigna Tareas a tus miembros y agenda sesiones.",
    moderator:
      "Ayudas a mantener segura la Comunidad de GYMX2. Las publicaciones y comentarios reportados aparecerán en tu cola de revisión.",
    admin:
      "Administras GYMX2. Revisa las solicitudes de coach y los roles de los miembros desde el área de administración.",
  },
  checkinTitle: "¿Cómo te fue esta semana?",
  checkinBody: "Tu check-in semanal toma un minuto. Tu coach lee cada uno.",
  checkinButton: "Hacer check-in",
  level: (n) => `Nivel ${n}`,
  streak: "Racha",
  days: (n) => (n === 1 ? `${n} día` : `${n} días`),
  thisWeek: "Esta semana",
  challenges: (done, total) => `${done} / ${total} retos`,
  newBadges: (n) =>
    n > 1
      ? "¡Nuevas insignias! Mira tu progreso"
      : "¡Nueva insignia! Mira tu progreso",
  coachRequestPending:
    "Tu solicitud de coach está esperando la revisión de un administrador.",
  seeTasks: "Ver tus Tareas",
  openCalendar: "Abrir tu calendario",
  visitArmory: "Visitar la Armory",
  findCoach: "Encontrar un coach",
  giveTask: "Asignar una Tarea",
  uploadVideo: "Subir un video",
  scheduleSession: "Agendar una sesión",
  addToArmory: "Agregar a la Armory",
  editProfile: "Editar tu perfil",
  openAdmin: "Abrir administración",
};
