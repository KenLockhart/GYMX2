export type UserRole = "member" | "coach" | "admin";

export type Profile = {
  id: string;
  role: UserRole;
  display_name: string;
  bio: string;
  coach_requested: boolean;
  instagram_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  x_url: string | null;
  website_url: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminUser = Pick<
  Profile,
  "id" | "display_name" | "role" | "coach_requested" | "created_at"
> & { email: string };

export type VideoStatus = "uploading" | "processing" | "ready" | "failed";

export type Video = {
  id: string;
  coach_id: string;
  title: string;
  description: string;
  status: VideoStatus;
  duration_seconds: number | null;
  created_at: string;
};

export type Memo = {
  id: string;
  user_id: string;
  memo_date: string;
  body: string;
  shared_with_coaches: boolean;
};

export type ActionState = {
  error?: string;
  message?: string;
};

export type CalendarSession = {
  id: string;
  coach_id: string;
  title: string;
  notes: string;
  location: string;
  meeting_url: string | null;
  starts_at: string;
  ends_at: string;
};

export type Message = {
  id: string;
  coach_id: string;
  member_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type ArmoryItem = {
  id: string;
  coach_id: string;
  kind: "link" | "download";
  category: string;
  title: string;
  description: string;
  price_cents: number | null;
  buy_url: string | null;
  file_path: string | null;
  file_name: string | null;
  image_path: string | null;
  visible_to_all: boolean;
  created_at: string;
};
