import type { Metadata } from "next";

export const homepageMetadata: Metadata = {
  title: {
    absolute:
      "GymX2 | Discover Coaches, Instructors & Physical Performance Creators",
  },
  description:
    "Find coaches, instructors and a community for sport, dance, movement and physical performance. Explore your discipline and develop your potential with GymX2.",
};

export const disciplines = [
  {
    title: "Fitness & Training",
    image: "/homepage/fitness-training.webp",
    alt: "Illustrative fitness coaching scene with two athletes training together",
    position: "50% 34%",
    description:
      "Build a practice around movement, consistency and the goals that matter to you.",
  },
  {
    title: "Strength & Conditioning",
    image: "/homepage/strength-conditioning.webp",
    alt: "Illustrative strength coaching scene with an athlete lifting a barbell",
    position: "50% 36%",
    description:
      "Explore strength work, conditioning and the details that support performance.",
  },
  {
    title: "Baseball",
    image: "/homepage/baseball.webp",
    alt: "Illustrative baseball instruction scene focused on batting mechanics",
    position: "50% 36%",
    description:
      "Work on the fundamentals, field awareness and repeatable skills of the game.",
  },
  {
    title: "Football",
    image: "/homepage/football.webp",
    alt: "Illustrative American football practice scene with a player running a drill",
    position: "50% 43%",
    description:
      "Study movement, preparation and the skills behind each position.",
  },
  {
    title: "Basketball",
    image: "/homepage/basketball.webp",
    alt: "Illustrative basketball coaching scene with a player practicing footwork",
    position: "50% 42%",
    description:
      "Develop court skills, footwork and confidence through focused practice.",
  },
  {
    title: "Soccer",
    image: "/homepage/soccer.webp",
    alt: "Illustrative soccer practice scene with a player moving with the ball",
    position: "50% 58%",
    description:
      "Explore ball control, conditioning and the decisions that shape play.",
  },
  {
    title: "Dance & Ballet",
    image: "/homepage/dance-ballet.webp",
    alt: "Illustrative dance instruction scene with a dancer practicing technique",
    position: "50% 38%",
    description:
      "Make room for technique, expression and the many ways to move through dance.",
  },
  {
    title: "Martial Arts",
    image: "/homepage/martial-arts.webp",
    alt: "Illustrative martial arts practice scene with students learning together",
    position: "50% 36%",
    description:
      "Learn through disciplined practice, movement and attention to form.",
  },
  {
    title: "Mobility & Movement",
    image: "/homepage/mobility-movement.webp",
    alt: "Illustrative movement coaching scene focused on mobility and balance",
    position: "50% 34%",
    description:
      "Explore mobility, control and a wider range of ways to move well.",
  },
  {
    title: "Other Physical Skills",
    image: "/homepage/other-physical-skills.webp",
    alt: "Illustrative climbing scene with an athlete practicing on an indoor wall",
    position: "50% 40%",
    description:
      "Bring your own practice, from climbing to the skills that do not fit a label.",
  },
] as const;

export const illustrativeRoles = [
  {
    title: "Pitching & Mechanics",
    category: "Sport",
    description: "Coaching the details behind a repeatable delivery.",
    mark: "P",
  },
  {
    title: "Dance & Movement",
    category: "Dance",
    description: "Helping dancers build technique and find their expression.",
    mark: "D",
  },
  {
    title: "Strength & Performance",
    category: "Training",
    description: "Connecting purposeful strength work with athletic goals.",
    mark: "S",
  },
] as const;

export const learningExamples = [
  {
    title: "Break down the fundamentals",
    category: "SPORT SKILLS",
    image: "/homepage/baseball.webp",
    alt: "Illustrative baseball player practicing batting mechanics",
  },
  {
    title: "Train with intention",
    category: "FITNESS & STRENGTH",
    image: "/homepage/fitness-training.webp",
    alt: "Illustrative coach helping an athlete focus on a strength exercise",
  },
  {
    title: "Move with control",
    category: "DANCE & MOVEMENT",
    image: "/homepage/dance-ballet.webp",
    alt: "Illustrative dance coaching scene focused on movement technique",
  },
] as const;

export const benefits = [
  {
    number: "01",
    title: "Find a practice that fits",
    description:
      "Explore coaches and ideas across sport, dance, training and movement.",
  },
  {
    number: "02",
    title: "Keep learning in motion",
    description:
      "Use coach-led programs, lessons and sessions to build your next step.",
  },
  {
    number: "03",
    title: "Stay connected",
    description:
      "Keep your questions, goals and progress in conversation with the people who support your practice.",
  },
  {
    number: "04",
    title: "Share your coaching focus",
    description:
      "Introduce your approach and coaching focus to signed-in GymX2 members after coach access is approved.",
  },
  {
    number: "05",
    title: "Build lessons and programs",
    description:
      "Use coach tools to develop programs and learning resources around your craft.",
  },
  {
    number: "06",
    title: "Work with learners",
    description:
      "Approved coaches can schedule sessions and stay in touch with learners through GymX2 tools.",
  },
] as const;
