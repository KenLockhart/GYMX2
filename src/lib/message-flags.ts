// Spots messages that may be moving a member off GYMX2: phone numbers, email addresses,
// payment apps and links, and invitations to talk or pay elsewhere. Flags are a prompt for an
// admin to look, not proof of anything, so they lean toward catching too much.

export type MessageFlag = "phone" | "email" | "payment" | "off_platform";

export const FLAG_LABELS: Record<MessageFlag, string> = {
  phone: "Phone number",
  email: "Email address",
  payment: "Payment app",
  off_platform: "Talk elsewhere",
};

const PHONE = /(?:\+?1[\s.-]*)?\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/;
const EMAIL = /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-z0-9-]+(?:\.[a-z0-9-]+)*\s*(?:\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i;
const PAYMENT = new RegExp(
  [
    String.raw`\bvenmo\b`,
    String.raw`\bcash\s*app\b`,
    String.raw`\bzelle\b`,
    String.raw`\bpay\s*pal\b`,
    String.raw`\bapple\s*cash\b`,
    String.raw`\bchime\b`,
    // A $cashtag, not a price: it starts with a letter.
    String.raw`(?:^|[\s(])\$[a-z][a-z0-9_-]{1,19}\b`,
    String.raw`\b(?:paypal\.me|venmo\.com|cash\.app|buy\.stripe\.com|square\.link|checkout\.square\.site|ko-fi\.com|gumroad\.com|patreon\.com|stan\.store)\b`,
    String.raw`\bpay\s+(?:me|you)\s+(?:directly|direct|privately|outside|off)\b`,
  ].join("|"),
  "i",
);
const OFF_PLATFORM = new RegExp(
  [
    String.raw`\bwhats\s*app\b`,
    String.raw`\btelegram\b`,
    String.raw`\bsnap\s*chat\b`,
    String.raw`\bkik\b`,
    String.raw`\b(?:text|call|dm|message|hit)\s+me\b(?!\s+(?:here|on\s+(?:here|gymx2)))`,
    String.raw`\bmy\s+(?:number|cell|phone|personal\s+email)\b`,
    String.raw`\b(?:outside|off)\s+(?:of\s+)?(?:gymx2|gym\s*x2|the\s+app|the\s+platform|the\s+site|this\s+app|here)\b`,
    String.raw`\b(?:skip|avoid|save\s+on|cut\s+out)\s+(?:the\s+)?(?:fees?|platform|middle\s*man|app)\b`,
  ].join("|"),
  "i",
);

export function detectFlags(body: string): MessageFlag[] {
  const flags: MessageFlag[] = [];
  if (PHONE.test(body)) flags.push("phone");
  if (EMAIL.test(body)) flags.push("email");
  if (PAYMENT.test(body)) flags.push("payment");
  if (OFF_PLATFORM.test(body)) flags.push("off_platform");
  return flags;
}

export function describeFlags(flags: MessageFlag[]) {
  return flags.map((flag) => FLAG_LABELS[flag]).join(", ");
}
