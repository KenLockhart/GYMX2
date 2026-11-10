import type { CoachProfileView } from "./coach-profile";

// Coach Jasmine: a fictional demonstration profile. Nothing here describes a real person, and the
// page labels every rating, review, price, credential and result as sample data.
export const SAMPLE_COACH: CoachProfileView = {
  id: "sample",
  sample: true,
  name: "Coach Jasmine",
  firstName: "Jasmine",
  photoUrl: null,
  headline:
    "I'm the coach who will celebrate your first push-up just as much as your first 100-pound deadlift.",
  verification: "verified",
  specialties: ["Strength", "Weight Loss", "Beginners"],
  location: "Atlanta, GA",
  formats: ["online", "in_person"],
  rating: { average: 4.9, count: 86 },
  experienceYears: 8,
  match: {
    total: 92,
    categories: {
      goals: 95,
      personality: 96,
      schedule: 85,
      communication: 92,
      experience: 94,
      budget: 85,
    },
    reasons: [
      "You both put strength and steady fat loss first.",
      "You asked for an encouraging, patient coach, and that's Jasmine's main style.",
      "She checks in weekly with messages in between, which is the rhythm you picked.",
      "She works with a lot of beginners and people coming back after a break.",
    ],
    discuss: [
      "Her live sessions are weekday evenings; ask whether a weekend slot is possible.",
      "The plan that fits you is near the top of your budget, so compare what's included.",
      "Your home equipment is limited; ask how she adapts plans to it.",
    ],
  },
  about: {
    intro: [
      "Fitness should make you feel stronger, more confident and more capable, not intimidated.",
      "I love working with people who are ready to make a change but aren't sure where to begin.",
      "My coaching style combines encouragement, structure, education and accountability.",
      "I believe small victories create lasting transformations. Whether you're learning your first squat or reaching a major strength milestone, we'll celebrate the progress together.",
    ],
    threeWords: ["Encouraging", "Structured", "Joyful"],
    prompts: [
      {
        prompt: "The biggest reason I became a coach is…",
        answer:
          "I was the nervous beginner once. A patient coach changed how I saw the gym, and I want to be that person for someone else.",
      },
      {
        prompt: "My coaching superpower is…",
        answer:
          "Breaking big goals into small, winnable weeks, so you always know what today's job is.",
      },
      {
        prompt:
          "If you're nervous about starting, here's what I want you to know…",
        answer:
          "Nobody is judging your first week. We start where you are, and every rep counts.",
      },
      {
        prompt: "Something most people don't know about me…",
        answer:
          "I taught myself to deadlift from library books before I ever had a coach.",
      },
    ],
    interests: [
      "Powerlifting meets",
      "Trail walks",
      "Cooking for friends",
      "Gospel brunch playlists",
    ],
    funFacts: [
      "Has a soft spot for kettlebells",
      "Celebrates every PR with a handwritten note",
    ],
    quote: "Strong is built one ordinary Tuesday at a time.",
  },
  idealClient:
    "Someone who is willing to learn, show up consistently, communicate openly, and understand that progress is built one workout at a time.",
  populations: [
    {
      label: "Complete beginners",
      note: "Most of my clients start here, with form first and confidence second.",
    },
    {
      label: "Returning exercisers",
      note: "Easing back in after a break without overdoing week one.",
    },
    {
      label: "Weight-loss clients",
      note: "Strength training plus habits, never crash dieting.",
    },
    {
      label: "Strength training",
      note: "Squat, hinge, press and pull, progressed safely.",
    },
    {
      label: "Busy professionals",
      note: "Three focused sessions a week that fit a full calendar.",
    },
    {
      label: "Women",
      note: "Many of my clients are women building strength for the first time.",
    },
  ],
  betterServedBy:
    "Competitive bodybuilders, people in post-surgery rehab and anyone needing a medical nutrition plan will be better served by a specialist. I'm happy to refer you.",
  style: {
    traits: [
      "Encouraging and patient",
      "Friendly and conversational",
      "Structured but flexible",
      "Education-focused",
      "Celebrates milestones",
      "Consistent accountability",
    ],
    attributes: [
      {
        label: "Motivation",
        primary: "Encouraging and patient",
        secondary: "Calm and educational",
      },
      { label: "Structure", primary: "Moderately structured" },
      {
        label: "Communication",
        primary: "Friendly and conversational",
        secondary: "Educational",
      },
      {
        label: "Accountability",
        primary: "Weekly check-ins",
        secondary: "Messages in between",
      },
      {
        label: "Relationship",
        primary: "Supportive mentor",
        secondary: "Technical educator",
      },
    ],
    note: "I'll push you when you're ready, but never before. You'll always know why we're doing what we're doing.",
  },
  loveLanguages: { primary: "encouragement", secondary: "milestones" },
  coaching: {
    included: [
      "Personalized training plans",
      "Weekly progress check-ins",
      "Exercise demonstration videos",
      "Form-review video submissions",
      "In-app messaging",
      "Monthly progress reviews",
    ],
    details: [
      { label: "Programming", value: "Built for you, adjusted every week" },
      {
        label: "Live sessions",
        value: "Optional, 45 minutes, on premium plans",
      },
      { label: "Check-ins", value: "Weekly, plus a monthly progress review" },
      {
        label: "Messages",
        value: "In the GYMX2 app, replies within 24 hours on weekdays",
      },
      { label: "Equipment", value: "Full gym, or dumbbells and bands at home" },
      { label: "Where you train", value: "Gym, home or outdoors" },
      {
        label: "Changes to your plan",
        value: "From your check-ins, form videos and how you feel",
      },
    ],
  },
  results: {
    expertise: [
      "First-time lifters",
      "Fat loss with strength",
      "Rebuilding consistency",
    ],
    methodology:
      "Every client starts with a movement check and a four-week foundation block. We progress load and volume slowly, track a few simple numbers and change the plan based on your check-ins, not a template.",
    stories: [
      {
        title: "From first squat to first pull-up",
        summary:
          "A sample story showing how case studies will look: a nervous beginner who trained three times a week for six months.",
      },
      {
        title: "Back after a long break",
        summary:
          "A sample story about returning to training after a few years off, starting with two short sessions a week.",
      },
    ],
  },
  nutrition: {
    offers: [
      "General nutrition education",
      "Healthy eating guidance",
      "Habit coaching",
      "Hydration guidance",
      "Sleep and recovery education",
      "Referrals to registered dietitians",
    ],
    qualifications:
      "Sample: a general nutrition coaching certificate (not a dietitian).",
    scope:
      "Jasmine coaches everyday healthy habits. Meal plans for medical conditions, diagnosis and medication are for doctors and registered dietitians.",
  },
  availability: {
    acceptingClients: true,
    timeZone: "Eastern Time",
    schedule: [
      { days: "Mon to Thu", hours: "6:00 to 9:00 AM, 5:00 to 8:00 PM" },
      { days: "Saturday", hours: "8:00 AM to noon" },
    ],
    details: [
      {
        label: "Training locations",
        value: "Online anywhere; in person in Midtown Atlanta",
      },
      { label: "Languages", value: "English, conversational Spanish" },
      {
        label: "Accessibility",
        value: "Seated and low-impact options for every program",
      },
      {
        label: "Capacity",
        value: "Taking new clients: 4 spots left this month",
      },
    ],
  },
  packages: [
    {
      name: "Intro call",
      kind: "intro",
      priceCents: 0,
      billing: "One time",
      sessions: "1 video or in-person call",
      duration: "20 minutes",
      includes: [
        "Talk through your goals",
        "See if we're a good fit",
        "No commitment",
      ],
    },
    {
      name: "Online Coaching",
      kind: "monthly",
      priceCents: 14900,
      billing: "Monthly",
      sessions: "Personalized plan",
      duration: "Ongoing",
      includes: [
        "Training plan updated weekly",
        "Weekly check-ins",
        "Form reviews",
        "In-app messaging",
      ],
      featured: true,
    },
    {
      name: "Premium 1-on-1",
      kind: "premium",
      priceCents: 29900,
      billing: "Monthly",
      sessions: "4 live sessions a month",
      duration: "45 minutes each",
      includes: [
        "Everything in Online Coaching",
        "Live video or in-person sessions",
        "Priority replies",
      ],
    },
    {
      name: "Single session",
      kind: "single",
      priceCents: 7500,
      billing: "One time",
      sessions: "1 session",
      duration: "60 minutes",
      includes: ["Technique session", "Written notes afterward"],
    },
  ],
  policies: [
    { label: "Minimum commitment", value: "None; plans are month to month" },
    { label: "Renewal", value: "Renews monthly until you cancel" },
    {
      label: "Cancellation",
      value: "Cancel anytime; access lasts to the end of the month",
    },
    { label: "Refunds", value: "Under the GYMX2 Refund and Return Policy" },
    { label: "Pausing", value: "Pause up to one month a year" },
    { label: "Missed sessions", value: "Reschedule with 24 hours' notice" },
    { label: "Other fees", value: "None" },
  ],
  credentials: [
    {
      title: "Certified Personal Trainer",
      organization: "Example: NASM",
      status: "verified",
      detail: "Sample entry showing how a verified certificate appears",
    },
    {
      title: "CPR/AED",
      organization: "Example: American Red Cross",
      status: "pending",
      detail: "Sample entry showing a certificate waiting for review",
    },
    {
      title: "Women's Fitness Specialist",
      organization: "Example: specialty course",
      status: "unverified",
      detail: "Sample entry showing a self-reported qualification",
    },
  ],
  reviews: {
    categories: [
      { label: "Communication", score: 4.9 },
      { label: "Professionalism", score: 5 },
      { label: "Knowledge", score: 4.8 },
      { label: "Motivation", score: 5 },
      { label: "Accountability", score: 4.8 },
      { label: "Personalization", score: 4.9 },
    ],
    items: [
      {
        author: "Sample member A",
        date: "October 2026",
        format: "Online coaching",
        goal: "Build strength",
        rating: 5,
        body: "This is a sample review to show the layout. Real reviews come only from members who have joined a coach.",
        reply:
          "Sample coach reply: thank you for trusting me with your first program!",
      },
      {
        author: "Sample member B",
        date: "September 2026",
        format: "Premium 1-on-1",
        goal: "Lose body fat",
        rating: 5,
        body: "Another sample review. Members can mention their goal if they want to; it's always optional.",
        reply: null,
      },
    ],
  },
  video: {
    prompts: [
      "Who are you?",
      "Why did you become a trainer?",
      "What types of clients do you enjoy helping?",
      "What happens during the first month?",
    ],
  },
  intro: {
    title: "Meet your coach before you commit",
    priceCents: 0,
    minutes: 20,
    formats: ["Video call", "In person in Atlanta"],
    cancellation: "Free to cancel or reschedule up to 2 hours before.",
    questions: [
      "What's the main thing you want to change?",
      "How many days a week can you train?",
      "Anything you'd like Jasmine to know before you talk?",
    ],
  },
};
