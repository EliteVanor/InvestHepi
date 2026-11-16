import { deleteChat, getChat, listChats } from "@/lib/chats";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";

/** GET /api/chats → the account's saved Ask AI chats (titles); ?id= → one chat with its messages. */
export async function GET(req: Request) {
  return gate(req, { user: true }, async () => {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const chat = await getChat(id);
      return chat ? Response.json({ chat }) : Response.json({ error: "not found" }, { status: 404 });
    }
    const chats = await listChats();
    return Response.json({ chats: chats.map(({ messages, ...c }) => ({ ...c, count: messages.length })) });
  });
}

/** DELETE /api/chats?id= → remove one saved chat. */
export async function DELETE(req: Request) {
  return gate(req, { user: true }, async () => {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    await deleteChat(id);
    return Response.json({ ok: true });
  });
}
