import { coachTools } from "./coach-tools";
import { coachToolsB } from "./coach-tools-b";
import { emails } from "./emails";
import { lists } from "./lists";
import { sharedA } from "./shared-a";
import { sharedB } from "./shared-b";
import { sharedC } from "./shared-c";

// Spanish for phrases used with <T> and tr(), keyed by the English wording. One file per area.
const parts: Record<string, string>[] = [
  coachTools,
  coachToolsB,
  emails,
  lists,
  sharedA,
  sharedB,
  sharedC,
];

export const esPhrases: Record<string, string> = Object.assign({}, ...parts);
