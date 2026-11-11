import type { Messages } from "../messages";

export const tasks: Messages["tasks"] = {
  title: "Tareas",
  loadError:
    "No pudimos cargar tus Tareas. Actualiza la página e inténtalo de nuevo.",
  due: (date) => `Vence el ${date}`,
  done: (date) => `Hecha el ${date}`,
  watch: (title) => `Ver: ${title}`,
  theVideo: "el video",
  saving: "Guardando...",
  markDone: "Marcar como hecha",
  markNotDone: "Marcar como no hecha",
  toDo: (n) => `Pendientes (${n})`,
  doneHeading: (n) => `Hechas (${n})`,
  nothingToDo:
    "No tienes nada pendiente por ahora. Las Tareas de tu coach aparecerán aquí.",
  noneGiven: "Todavía no se ha asignado ninguna Tarea.",
  progress: (done, total) => `${done} de ${total} hechas`,
  confirmDelete: (title) =>
    `¿Eliminar "${title}"? Los miembros también la perderán.`,
  delete: "Eliminar",
  deleting: "Eliminando...",
  formerMember: "Exmiembro",
  notDoneYet: "Aún no está hecha",
  give: "Asignar una Tarea",
  new: {
    back: "Volver a Tareas",
    needVideo: "Primero necesitas un video terminado.",
    uploadOne: "Sube uno",
    noMembers:
      "Aún no se ha unido ningún miembro. Pueden unirse desde su página de Coaches.",
    loadError:
      "No pudimos cargar tus videos y miembros. Actualiza la página e inténtalo de nuevo.",
    video: "Video",
    taskTitle: "Título",
    pillar: "Pilar",
    pillarHint:
      "Los miembros ganan insignias de pilar por las Tareas de cada uno.",
    instructions: "Instrucciones",
    dueDate: "Fecha de entrega (opcional)",
    members: "Miembros",
    submit: "Asignar Tarea",
  },
};
