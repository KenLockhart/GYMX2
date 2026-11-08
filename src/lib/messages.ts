import type { Message } from "./types";

export type Contact = { id: string; display_name: string; connected: boolean };

export type ConversationSummary = Contact & {
  last: Pick<Message, "body" | "created_at" | "sender_id"> | null;
  unread: number;
};

// The other person in a coach and member pair.
export function otherPerson(message: Pick<Message, "coach_id" | "member_id">, me: string) {
  return message.coach_id === me ? message.member_id : message.coach_id;
}

// One row per person: everyone the viewer can message now, plus anyone they have messaged before.
// Newest conversation first, then people with no messages yet in name order.
export function summarizeConversations(
  contacts: Contact[],
  messages: Pick<Message, "coach_id" | "member_id" | "sender_id" | "body" | "created_at" | "read_at">[],
  me: string,
  formerNames: Map<string, string> = new Map(),
): ConversationSummary[] {
  const byPerson = new Map<string, ConversationSummary>();
  for (const contact of contacts) byPerson.set(contact.id, { ...contact, last: null, unread: 0 });

  for (const message of messages) {
    const id = otherPerson(message, me);
    let row = byPerson.get(id);
    if (!row) {
      row = { id, display_name: formerNames.get(id) ?? "Former contact", connected: false, last: null, unread: 0 };
      byPerson.set(id, row);
    }
    if (!row.last || message.created_at > row.last.created_at) {
      row.last = { body: message.body, created_at: message.created_at, sender_id: message.sender_id };
    }
    if (message.sender_id !== me && message.read_at === null) row.unread += 1;
  }

  return [...byPerson.values()].sort((a, b) => {
    if (a.last && b.last) return b.last.created_at.localeCompare(a.last.created_at);
    if (a.last) return -1;
    if (b.last) return 1;
    return a.display_name.localeCompare(b.display_name);
  });
}

export function preview(body: string, length = 80) {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > length ? `${oneLine.slice(0, length - 1)}…` : oneLine;
}
