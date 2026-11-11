import type { Messages } from "../messages";
import { auth } from "./auth";
import { common } from "./common";
import { dashboard } from "./dashboard";
import { nav } from "./nav";
import { options } from "./options";
import { goalsForm, profile } from "./profile";

export const es: Messages = {
  common,
  nav,
  auth,
  dashboard,
  options,
  goalsForm,
  profile,
};
