import type { Messages } from "../messages";

export const checkin: Messages["checkin"] = {
  title: "Check-in semanal",
  intro: (week) =>
    `Un minuto para contarles a tus coaches cómo te fue en la semana. Solo tú y los coaches a los que te uniste lo ven. Semana del ${week}.`,
  joinFirst: "Primero únete a un coach y tus check-ins le llegarán.",
  findCoach: "Encontrar un coach",
  alreadyDone:
    "Ya hiciste tu check-in esta semana. Puedes cambiarlo hasta el domingo.",
  scales: {
    energy: { label: "Energía", low: "Agotado", high: "Lleno de energía" },
    sleep: { label: "Sueño", low: "Malo", high: "Excelente" },
    stress: { label: "Estrés", low: "Tranquilo", high: "Abrumado" },
    motivation: { label: "Motivación", low: "Batallando", high: "Con todo" },
  },
  wins: "Logros de la semana",
  hard: "Lo que fue difícil",
  question: "Una pregunta para tu coach (opcional)",
  saving: "Guardando...",
  update: "Actualizar check-in",
  submit: "Hacer check-in",
  past: "Check-ins anteriores",
  weekOf: (week) => `Semana del ${week}`,
  winsLine: (text) => `Logros: ${text}`,
  hardLine: (text) => `Difícil: ${text}`,
  askedLine: (text) => `Preguntaste: ${text}`,
  yourCoach: "Tu coach",
};

export const progress: Messages["progress"] = {
  title: "Tu progreso",
  intro:
    "Solo tú y los administradores de GYMX2 ven tus puntos, nivel y racha. Todos pueden ver tus insignias.",
  newBadges: (n) => (n > 1 ? "Nuevas insignias:" : "Nueva insignia:"),
  level: (n) => `Nivel ${n}`,
  toNextLevel: "Progreso hacia el siguiente nivel",
  points: (n) => `${n} puntos`,
  toNext: (points, next) => `${points} para ${next}`,
  topLevel: "Alcanzaste el nivel máximo",
  streak: "Racha",
  days: (n) => (n === 1 ? `${n} día` : `${n} días`),
  best: (days) => `Mejor: ${days}`,
  keepGoing: " · Haz algo hoy para mantenerla",
  streakCoach:
    "Cuenta los días en que publicas videos, asignas Tareas, agendas sesiones o escribes a tus miembros.",
  streakMember:
    "Cuenta los días en que terminas una Tarea, escribes una Nota, confirmas una sesión o escribes a tu coach.",
  challenges: "Retos de esta semana",
  challengesStatus: (done, total) =>
    `${done} de ${total} hechos · Se reinician el lunes · Completa los cuatro para ganar ⚔️ Guerrero de la semana`,
  done: "Hecho ✓",
  badges: "Insignias",
  earnedCount: (earned, total) => `${earned} de ${total} ganadas`,
  earned: (date) => `Ganada el ${date}`,
  share: "Compartir",
  howPoints: "Cómo funcionan los puntos",
  pointsCoach:
    "Video publicado 3 · nuevo miembro se une 3 · sesión agendada 2 · Tarea asignada 1 · mensaje enviado 1.",
  pointsMember:
    "Tarea terminada 3 · confirmación de sesión 2 · mensaje enviado 1 · Nota escrita 1.",
  levels: "Niveles:",
  goTasks: "Ir a tus Tareas",
};
