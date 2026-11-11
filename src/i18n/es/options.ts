import type { Messages } from "../messages";

export const options: Messages["options"] = {
  badgesLabel: "Insignias",
  // Badges, by their English name (a few keys are shared by member and coach badges).
  badges: {
    "Team Up": { name: "En equipo", description: "Únete a un coach" },
    "First Rep": {
      name: "Primera repetición",
      description: "Termina tu primera Tarea",
    },
    "Dialed In": { name: "Enfocado", description: "Termina 10 Tareas" },
    Machine: { name: "Máquina", description: "Termina 50 Tareas" },
    "Sharp Mind": {
      name: "Mente aguda",
      description: "Termina 5 Tareas de Mente",
    },
    "Strong Body": {
      name: "Cuerpo fuerte",
      description: "Termina 5 Tareas de Cuerpo",
    },
    "Lifted Spirit": {
      name: "Espíritu en alto",
      description: "Termina 5 Tareas de Espíritu",
    },
    "Mind • Body • Spirit": {
      name: "Mente • Cuerpo • Espíritu",
      description: "Termina 3 Tareas de cada pilar",
    },
    "On a Roll": {
      name: "En racha",
      description: "Mantente activo 7 días seguidos",
    },
    Unstoppable: {
      name: "Imparable",
      description: "Mantente activo 30 días seguidos",
    },
    "Showed Up": {
      name: "Presente",
      description: "Confirma que irás a una sesión",
    },
    Regular: { name: "Constante", description: "Ve a 10 sesiones" },
    Journaler: { name: "Escritor", description: "Escribe 10 Notas" },
    "Geared Up": {
      name: "Equipado",
      description: "Compra algo en la Armory",
    },
    "Weekly Warrior": {
      name: "Guerrero de la semana",
      description: "Completa todos los retos semanales",
    },
    "Habit Starter": {
      name: "Primer hábito",
      description: "Marca tu primer hábito diario",
    },
    "Habit Machine": {
      name: "Máquina de hábitos",
      description: "Marca 100 hábitos diarios",
    },
    "Balanced Day": {
      name: "Día en equilibrio",
      description: "Marca un hábito de Mente, Cuerpo y Espíritu el mismo día",
    },
    "Lights, Camera": {
      name: "Luces, cámara",
      description: "Publica tu primer video",
    },
    "Library Builder": {
      name: "Creador de biblioteca",
      description: "Publica 10 videos",
    },
    Crew: { name: "Equipo", description: "Logra que 5 miembros se unan" },
    "Squad Leader": {
      name: "Líder de escuadrón",
      description: "Logra que 25 miembros se unan",
    },
    "Program Designer": {
      name: "Diseñador de programas",
      description: "Asigna 25 Tareas",
    },
    "Whole Athlete Coach": {
      name: "Coach integral",
      description: "Asigna Tareas de Mente, Cuerpo y Espíritu",
    },
    "Session Host": {
      name: "Anfitrión de sesiones",
      description: "Agenda 10 sesiones",
    },
    "Open for Business": {
      name: "Abierto al público",
      description: "Haz tu primera venta en la Armory",
    },
    Merchant: {
      name: "Comerciante",
      description: "Haz 10 ventas en la Armory",
    },
  },
  challenges: {
    "Finish 3 Tasks": "Termina 3 Tareas",
    "Train Mind, Body and Spirit": "Entrena Mente, Cuerpo y Espíritu",
    "Write 3 Memos": "Escribe 3 Notas",
    "Show up to a session": "Asiste a una sesión",
    "Give 5 Tasks": "Asigna 5 Tareas",
    "Schedule 2 sessions": "Agenda 2 sesiones",
    "Publish a video": "Publica un video",
    "Send 10 messages": "Envía 10 mensajes",
  },
  levels: {
    Rookie: "Novato",
    Contender: "Contendiente",
    Warrior: "Guerrero",
    Elite: "Élite",
    Champion: "Campeón",
    Legend: "Leyenda",
  },
  goals: {
    lose_weight: "Bajar de peso",
    build_muscle: "Ganar músculo y fuerza",
    get_fit: "Mejorar mi condición y resistencia",
    mobility: "Moverme mejor y recuperarme",
    eat_better: "Comer mejor",
    reduce_stress: "Manejar el estrés",
    sleep_better: "Dormir mejor",
    build_habits: "Crear hábitos que duren",
    find_purpose: "Encontrar propósito y motivación",
    grow_spiritually: "Crecer espiritualmente",
  },
  experience: {
    new: { label: "Soy nuevo en esto", hint: "Apenas estoy empezando" },
    some: { label: "Algo de experiencia", hint: "He entrenado por temporadas" },
    experienced: {
      label: "Con experiencia",
      hint: "Entrenar es parte de mi vida",
    },
  },
  pillars: { mind: "Mente", body: "Cuerpo", spirit: "Espíritu" },
  pillarHints: {
    mind: "Estrés, sueño, enfoque y hábitos",
    body: "Fuerza, condición física, peso y nutrición",
    spirit: "Propósito, motivación y crecimiento interior",
  },
  notificationTypes: {
    comment: { label: "Comentarios en tus publicaciones", hint: "" },
    reply: { label: "Respuestas a tus comentarios", hint: "" },
    progress_reply: {
      label: "Comentarios en tus publicaciones de progreso",
      hint: "",
    },
    announcement: { label: "Anuncios de tus coaches", hint: "" },
    like: {
      label: "Me gusta en tus publicaciones",
      hint: "Agrupados, así una publicación popular envía solo uno hasta que lo veas.",
    },
    removed: {
      label: "Se eliminó algo que publicaste",
      hint: "Con el motivo, cuando se indicó uno.",
    },
    message: {
      label: "Mensajes directos",
      hint: "Solo te enviamos correo por el primer mensaje sin leer de una conversación.",
    },
  },
};
