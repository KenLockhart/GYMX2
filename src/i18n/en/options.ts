// Labels for fixed choices stored by value (goals, experience, Mind/Body/Spirit, notification types).
export const options = {
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
