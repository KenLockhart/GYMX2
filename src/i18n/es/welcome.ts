import type { Messages } from "../messages";

export const welcome: Messages["welcome"] = {
  title: "Bienvenida",
  eyebrow: "Bienvenido a GYMX2",
  heading: "Encontremos a tu coach",
  intro:
    "Tres preguntas rápidas para sugerirte coaches y programas que te queden. Solo los coaches a los que te unas ven tus respuestas, y puedes cambiarlas cuando quieras en tu perfil.",
  submit: "Ver mis coaches sugeridos",
  skip: "Omitir por ahora",
  matches: {
    title: "Tus coaches sugeridos",
    forYou: "Coaches para ti",
    find: "Encuentra a tu coach",
    youWant: (goals) => `Quieres: ${goals}.`,
    startingWith: "Empezando por",
    none: "Ningún coach tiene esas especialidades todavía. Mira a todos y elige quien te parezca mejor. Puedes escribirle a un coach cuando te unas a él.",
    best: "Mejor opción",
    helpsWith: "Te ayuda con: ",
    startWith: "Empieza con: ",
    subscribersOnly: "Solo suscriptores · ",
    plansFrom: (price) => `Planes desde ${price}/mes`,
    meet: (name) => `Conocer a ${name}`,
    seeAll: "Ver todos los coaches",
    dashboard: "Ir a mi inicio",
    onceJoinedBefore: "Cuando te unas a un coach, sus programas aparecerán en",
    programs: "Programas",
    onceJoinedAfter: ", donde puedes empezar uno hoy.",
  },
};
