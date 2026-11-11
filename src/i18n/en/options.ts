// Labels for fixed choices stored by value (goals, experience, Mind/Body/Spirit, notification types).
export const options = {
  badgesLabel: "Badges",
  // Badges, by their English name (a few keys are shared by member and coach badges).
  badges: {
    "Team Up": { name: "Team Up", description: "Join a coach" },
    "First Rep": { name: "First Rep", description: "Finish your first Task" },
    "Dialed In": { name: "Dialed In", description: "Finish 10 Tasks" },
    Machine: { name: "Machine", description: "Finish 50 Tasks" },
    "Sharp Mind": { name: "Sharp Mind", description: "Finish 5 Mind Tasks" },
    "Strong Body": { name: "Strong Body", description: "Finish 5 Body Tasks" },
    "Lifted Spirit": {
      name: "Lifted Spirit",
      description: "Finish 5 Spirit Tasks",
    },
    "Mind • Body • Spirit": {
      name: "Mind • Body • Spirit",
      description: "Finish 3 Tasks in each pillar",
    },
    "On a Roll": {
      name: "On a Roll",
      description: "Be active 7 days in a row",
    },
    Unstoppable: {
      name: "Unstoppable",
      description: "Be active 30 days in a row",
    },
    "Showed Up": {
      name: "Showed Up",
      description: "Say you're going to a session",
    },
    Regular: { name: "Regular", description: "Go to 10 sessions" },
    Journaler: { name: "Journaler", description: "Write 10 Memos" },
    "Geared Up": {
      name: "Geared Up",
      description: "Buy something in the Armory",
    },
    "Weekly Warrior": {
      name: "Weekly Warrior",
      description: "Finish every weekly challenge",
    },
    "Habit Starter": {
      name: "Habit Starter",
      description: "Check off your first daily habit",
    },
    "Habit Machine": {
      name: "Habit Machine",
      description: "Check off 100 daily habits",
    },
    "Balanced Day": {
      name: "Balanced Day",
      description: "Check off a Mind, Body and Spirit habit on the same day",
    },
    "Lights, Camera": {
      name: "Lights, Camera",
      description: "Publish your first video",
    },
    "Library Builder": {
      name: "Library Builder",
      description: "Publish 10 videos",
    },
    Crew: { name: "Crew", description: "Have 5 members join you" },
    "Squad Leader": {
      name: "Squad Leader",
      description: "Have 25 members join you",
    },
    "Program Designer": {
      name: "Program Designer",
      description: "Give 25 Tasks",
    },
    "Whole Athlete Coach": {
      name: "Whole Athlete Coach",
      description: "Give Tasks in Mind, Body and Spirit",
    },
    "Session Host": {
      name: "Session Host",
      description: "Schedule 10 sessions",
    },
    "Open for Business": {
      name: "Open for Business",
      description: "Make your first Armory sale",
    },
    Merchant: { name: "Merchant", description: "Make 10 Armory sales" },
  } as Record<string, { name: string; description: string }>,
  // Weekly challenges, by their English title.
  challenges: {
    "Finish 3 Tasks": "Finish 3 Tasks",
    "Train Mind, Body and Spirit": "Train Mind, Body and Spirit",
    "Write 3 Memos": "Write 3 Memos",
    "Show up to a session": "Show up to a session",
    "Give 5 Tasks": "Give 5 Tasks",
    "Schedule 2 sessions": "Schedule 2 sessions",
    "Publish a video": "Publish a video",
    "Send 10 messages": "Send 10 messages",
  } as Record<string, string>,
  levels: {
    Rookie: "Rookie",
    Contender: "Contender",
    Warrior: "Warrior",
    Elite: "Elite",
    Champion: "Champion",
    Legend: "Legend",
  } as Record<string, string>,
  goals: {
    lose_weight: "Lose weight",
    build_muscle: "Build muscle and strength",
    get_fit: "Get fitter and build endurance",
    mobility: "Move better and recover",
    eat_better: "Eat better",
    reduce_stress: "Manage stress",
    sleep_better: "Sleep better",
    build_habits: "Build habits that stick",
    find_purpose: "Find purpose and motivation",
    grow_spiritually: "Grow spiritually",
  } as Record<string, string>,
  experience: {
    new: { label: "New to this", hint: "Just getting started" },
    some: { label: "Some experience", hint: "I've trained on and off" },
    experienced: { label: "Experienced", hint: "Training is part of my life" },
  } as Record<string, { label: string; hint: string }>,
  pillars: { mind: "Mind", body: "Body", spirit: "Spirit" } as Record<
    string,
    string
  >,
  pillarHints: {
    mind: "Stress, sleep, focus and habits",
    body: "Strength, fitness, weight and nutrition",
    spirit: "Purpose, motivation and inner growth",
  } as Record<string, string>,
  notificationTypes: {
    comment: { label: "Comments on your posts", hint: "" },
    reply: { label: "Replies to your comments", hint: "" },
    progress_reply: { label: "Comments on your progress posts", hint: "" },
    announcement: { label: "Your coaches' announcements", hint: "" },
    like: {
      label: "Likes on your posts",
      hint: "Grouped, so a popular post sends one until you've seen it.",
    },
    removed: {
      label: "Something you posted was removed",
      hint: "With the reason, when one was given.",
    },
    message: {
      label: "Direct messages",
      hint: "Emails only about the first unread message in a conversation.",
    },
  } as Record<string, { label: string; hint: string }>,
};
