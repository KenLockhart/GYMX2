import type { Messages } from "../messages";

export const calendar: Messages["calendar"] = {
  title: "Calendario",
  introCoach: "Agenda sesiones y mira quién va a asistir.",
  introMember:
    "Las sesiones de tus coaches y las fechas de entrega de tus Tareas, todo en un solo lugar.",
  introOther: "Todas las sesiones de GYMX2.",
  introTimes: "Horarios de introducción",
  schedule: "Agendar una sesión",
  loadError:
    "No pudimos cargar tu calendario. Actualiza la página e inténtalo de nuevo.",
  comingUp: "Próximamente",
  noSessions: "Todavía no hay sesiones agendadas.",
  noSessionsMember:
    "Aún no hay sesiones. Cuando un coach al que te uniste agende una, aparecerá aquí.",
  going: (going, total) => `${going} de ${total} asistirán`,
  changeMonth: "Cambiar de mes",
  previous: "Anterior",
  today: "Hoy",
  next: "Siguiente",
  task: "Tarea",
  taskItem: (title) => `Tarea: ${title}`,
  due: "Vence",
  more: (n) => `+${n} más`,
  thisMonth: "Este mes",
  nothingThisMonth: "No hay nada agendado este mes.",
  responses: {
    pending: "Sin respuesta",
    going: "Asistiré",
    not_going: "No puedo ir",
  },
  form: {
    title: "Título",
    date: "Fecha",
    starts: "Empieza",
    ends: "Termina",
    zone: (zone) =>
      `Los horarios están en tu zona horaria (${zone}). Los miembros los ven en la suya.`,
    overnight:
      " La hora de fin es anterior a la de inicio, así que la sesión termina al día siguiente.",
    location: "Lugar (opcional)",
    videoLink: "Enlace de videollamada (opcional)",
    notes: "Notas (opcional)",
    invite: "Invitar",
    loading: "Cargando...",
  },
  new: {
    back: "Volver al calendario",
    membersError:
      "No pudimos cargar tus miembros. Actualiza la página e inténtalo de nuevo.",
    noMembers:
      "Aún no se ha unido ningún miembro. Pueden unirse desde su página de Coaches.",
    submit: "Agendar sesión",
  },
  edit: {
    title: "Editar sesión",
    back: "Volver a la sesión",
    note: "Si cambias la fecha o la hora, todos los invitados deberán responder de nuevo.",
    submit: "Guardar cambios",
  },
  session: {
    title: "Sesión",
    with: (name) => `con ${name}`,
    finished: "Esta sesión ya terminó.",
    edit: "Editar",
    confirmCancel: (title) =>
      `¿Cancelar "${title}"? Desaparecerá de los calendarios de tus miembros.`,
    cancel: "Cancelar sesión",
    cancelling: "Cancelando...",
    youreLive: "Estás en vivo ahora mismo.",
    coachLive: "Tu coach está en vivo ahora mismo.",
    teachLive:
      "Da esta sesión en vivo en GYMX2. Los miembros miran y chatean aquí; asistir en vivo les da puntos.",
    roomOpen:
      "La sala en vivo está abierta. Tu coach empezará pronto, y puedes mirar y chatear aquí.",
    watchLive: "Ver en vivo",
    openRoom: "Abrir sala en vivo",
    where: "Dónde",
    videoCall: "Videollamada",
    joinCall: "Unirse a la llamada",
    notes: "Notas",
    coming: "¿Vas a asistir?",
    letCoachKnow: "Avísale a tu coach.",
    invited: (going, total) => `Invitados (${going} de ${total} asistirán)`,
    watchedLive: "Lo vio en vivo",
  },
  intros: {
    body: "Las sesiones de introducción gratuitas permiten que los miembros nuevos te conozcan antes de comprometerse. Agrega los horarios en que estás libre; los miembros reservan uno desde tu perfil, con un mensaje opcional. Las reservas aparecen en ambos calendarios.",
    notApproved:
      "Los miembros podrán reservar cuando se apruebe tu perfil de coach.",
    finish: "Completa tu perfil",
  },
  live: {
    title: "Sesión en vivo",
    live: "En vivo",
    liveWith: (name) => `En vivo con ${name}`,
    notRecorded:
      "Las sesiones en vivo no se graban. Solo el coach aparece en cámara. Los administradores de GYMX2 pueden revisar el chat en vivo para mantener a todos seguros.",
    cameraError:
      "No pudimos usar tu cámara y micrófono. Permite el acceso en tu navegador e inténtalo de nuevo.",
    couldntGoLive: "No pudimos iniciar la transmisión en vivo.",
    dropped:
      "Se cayó tu conexión. Presiona Transmitir en vivo para reconectarte.",
    serviceError:
      "No pudimos conectarnos al servicio de video en vivo. Revisa tu internet e inténtalo de nuevo.",
    confirmEnd: "¿Terminar la sesión en vivo para todos?",
    turnOnCamera: "Encender cámara",
    ending: "Terminando...",
    end: "Terminar sesión en vivo",
    connecting: "Conectando...",
    reconnect: "Reconectar",
    goLive: "Transmitir en vivo",
    broadcasting: "Estás en vivo. Los miembros invitados te están viendo aquí.",
    window:
      "Puedes transmitir en vivo desde 30 minutos antes del inicio hasta una hora después del final.",
    framing:
      "Revisa tu encuadre y empieza la transmisión. Los miembros reciben un correo cuando empiezas.",
    membersSee: "Los miembros te ven y te escuchan; ellos no salen en cámara.",
    cameraOff: "La cámara está apagada",
    soundOn: "Activar sonido",
    mute: "Silenciar",
    connectingVideo: "Conectando al video en vivo...",
    ended: "Esta sesión en vivo terminó.",
    waiting:
      "Esperando a que tu coach empiece la transmisión. Esta página se actualiza sola.",
    chat: "Chat en vivo",
    sayHi: "Saluda al grupo.",
    chatOpens: "El chat se abre cuando empieza la sesión en vivo.",
    you: "Tú",
    aMember: "Un miembro",
    coachTag: " (coach)",
    remove: "Eliminar",
    chatMessage: "Mensaje del chat",
    sendPlaceholder: "Envía un mensaje",
    chatOpensShort: "El chat se abre en vivo",
    send: "Enviar",
  },
};
