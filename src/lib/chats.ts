/**
 * Saved Ask AI conversations, per account (ukey), newest first. Small on purpose for the free Redis
 * tier: at most 30 chats of 30 messages each, answers trimmed to 4,000 characters.
 */
import { ukey } from "./context";
import { getJSON, setJSON } from "./store";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { n: number; title: string; link: string; source: string }[];
  provider?: string;
}

export interface Chat {
  id: string;
  title: string;
  /** Section the chat was started from (for the history list). */
  section?: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export const MAX_CHATS = 30;
export const MAX_MESSAGES = 30;
const key = () => ukey("chats");

export async function listChats(): Promise<Chat[]> {
  return (await getJSON<Chat[]>(key())) ?? [];
}

export async function getChat(id: string): Promise<Chat | null> {
  return (await listChats()).find((c) => c.id === id) ?? null;
}

export async function deleteChat(id: string): Promise<void> {
  await setJSON(key(), (await listChats()).filter((c) => c.id !== id));
}

/** Append one question and its answer; creates the chat when `id` is new or missing. Returns the chat id. */
export async function appendToChat(id: string | undefined, question: string, answer: ChatMessage, section?: string, now = new Date()): Promise<string> {
  const chats = await listChats();
  const cid = id && /^[a-z0-9-]{6,40}$/.test(id) ? id : `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const existing = chats.find((c) => c.id === cid);
  const chat: Chat = existing ?? { id: cid, title: question.slice(0, 80), section, updatedAt: now.toISOString(), messages: [] };
  chat.messages = [...chat.messages, { role: "user" as const, content: question.slice(0, 500) }, { ...answer, content: answer.content.slice(0, 4000) }].slice(-MAX_MESSAGES);
  chat.updatedAt = now.toISOString();
  await setJSON(key(), [chat, ...chats.filter((c) => c.id !== cid)].slice(0, MAX_CHATS));
  return cid;
}
