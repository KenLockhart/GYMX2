// The choices coaches pick from when building their profile. Shared by the editor, the profile
// page and (later) the matching engine, so the values must stay stable.

export const COACH_STYLE = {
  motivation: {
    label: "Motivational approach",
    options: [
      { value: "encouraging", label: "Encouraging and patient" },
      { value: "demanding", label: "Tough-love and demanding" },
      { value: "energetic", label: "Energetic and motivational" },
      { value: "calm", label: "Calm and educational" },
    ],
  },
  structure: {
    label: "Training structure",
    options: [
      { value: "high", label: "Highly structured" },
      { value: "moderate", label: "Moderately structured" },
      { value: "flexible", label: "Flexible and adaptive" },
    ],
  },
  communication: {
    label: "Communication style",
    options: [
      { value: "friendly", label: "Friendly and conversational" },
      { value: "direct", label: "Professional and direct" },
      { value: "educational", label: "Educational and explanatory" },
      { value: "high_energy", label: "High-energy and enthusiastic" },
    ],
  },
  accountability: {
    label: "Accountability",
    options: [
      { value: "daily", label: "Daily accountability" },
      { value: "several", label: "Several check-ins a week" },
      { value: "weekly", label: "Weekly accountability" },
      { value: "independent", label: "Independent, support when asked" },
    ],
  },
  relationship: {
    label: "Coaching relationship",
    options: [
      { value: "mentor", label: "Supportive mentor" },
      { value: "partner", label: "Disciplined accountability partner" },
      { value: "educator", label: "Technical fitness educator" },
      { value: "companion", label: "Friendly fitness companion" },
    ],
  },
} as const;
export type StyleKey = keyof typeof COACH_STYLE;
export const STYLE_KEYS = Object.keys(COACH_STYLE) as StyleKey[];

export const POPULATIONS = [
  "Complete beginners",
  "Returning exercisers",
  "Weight-loss clients",
  "Muscle-building clients",
  "Strength training",
  "Bodybuilding",
  "Seniors",
  "Busy professionals",
  "Athletes",
  "Women",
  "Men",
  "Mobility-focused clients",
  "People with disabilities",
  "Postpartum clients",
  "General wellness",
  "Functional fitness",
  "Home workout clients",
  "Gym-based clients",
] as const;

export const SERVICES = [
  "Live one-on-one video sessions",
  "Personalized training plans",
  "Prerecorded workout library",
  "Individual exercise demonstrations",
  "Form-review video submissions",
  "Progress tracking",
  "Weekly check-ins",
  "Daily accountability",
  "In-app messaging",
  "Group coaching",
  "Hybrid coaching",
  "In-person sessions",
] as const;

export const NUTRITION_SUPPORT = [
  "General nutrition education",
  "Healthy eating guidance",
  "Meal-planning support",
  "Habit coaching",
  "Hydration guidance",
  "Sleep and recovery education",
  "Lifestyle accountability",
  "Referrals to registered dietitians",
] as const;

export const BIO_PROMPTS = [
  "The biggest reason I became a coach is…",
  "My coaching superpower is…",
  "If you're nervous about starting, here's what I want you to know…",
  "Something most people don't know about me…",
  "What makes working with me different…",
  "My training philosophy in one sentence…",
] as const;

export const PACKAGE_KINDS = [
  { value: "monthly", label: "Monthly coaching" },
  { value: "premium", label: "Premium 1-on-1 (monthly)" },
  { value: "package", label: "Session package" },
  { value: "single", label: "Single session" },
  { value: "group", label: "Group coaching" },
  { value: "trial", label: "Trial program" },
  { value: "intro", label: "Intro consultation" },
] as const;

export const TIME_ZONES = [
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Phoenix", label: "Arizona Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
] as const;

export const POLICY_FIELDS = [
  {
    key: "commitment",
    label: "Minimum commitment",
    example: "None; month to month",
  },
  {
    key: "renewal",
    label: "Renewal",
    example: "Renews monthly until you cancel",
  },
  {
    key: "cancellation",
    label: "Cancellation",
    example: "Cancel anytime; access lasts to the end of the month",
  },
  {
    key: "refund",
    label: "Refunds",
    example: "Under the GYMX2 Refund and Return Policy",
  },
  { key: "pause", label: "Pausing", example: "Pause up to one month a year" },
  {
    key: "missed",
    label: "Missed sessions",
    example: "Reschedule with 24 hours' notice",
  },
  { key: "fees", label: "Other fees", example: "None" },
] as const;
export type PolicyKey = (typeof POLICY_FIELDS)[number]["key"];

export const COACHING_DETAIL_FIELDS = [
  { key: "sessionLength", label: "Session length", example: "45 minutes" },
  {
    key: "frequency",
    label: "How often",
    example: "3 workouts a week, 1 live call a month",
  },
  {
    key: "channels",
    label: "How we talk",
    example: "In-app messages and video calls",
  },
  {
    key: "responseTime",
    label: "Reply time",
    example: "Within 24 hours on weekdays",
  },
  {
    key: "equipment",
    label: "Equipment needed",
    example: "Dumbbells and bands, or a gym",
  },
  {
    key: "environments",
    label: "Where you can train",
    example: "Gym, home or outdoors",
  },
  { key: "reviewFrequency", label: "Progress reviews", example: "Monthly" },
  {
    key: "adjustments",
    label: "How plans change",
    example: "From your weekly check-ins",
  },
] as const;
export type CoachingDetailKey = (typeof COACHING_DETAIL_FIELDS)[number]["key"];

export function optionLabel(key: StyleKey, value: string | null | undefined) {
  return (
    COACH_STYLE[key].options.find((option) => option.value === value)?.label ??
    null
  );
}

export function timeZoneLabel(value: string) {
  return TIME_ZONES.find((zone) => zone.value === value)?.label ?? value;
}
