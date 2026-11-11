import type { Messages } from "../messages";

export const options: Messages["options"] = {
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
