import { NextResponse } from "next/server";
import { accountApi } from "@/lib/account-api";
import { validateAndProcessFile } from "@/lib/chat-attachments";

const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function POST(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return reply({ error: "Choose a PDF, DOCX or TXT file." }, 400);
  if (!/\.(pdf|docx|txt)$/i.test(file.name)) return reply({ error: "Knowledge import supports PDF, DOCX and TXT files." }, 415);
  try {
    const processed = await validateAndProcessFile(file);
    if (!processed.extractedText) return reply({ error: "No readable text was found in this file." }, 422);
    const title = file.name.replace(/\.[^.]+$/, "").trim().slice(0, 200) || "Imported document";
    const content = processed.extractedText.slice(0, 200_000);
    const { data: duplicate } = await auth.admin.from("knowledge_sources").select("id,title,content,created_at")
      .eq("user_id", auth.user.id).eq("title", title).eq("content", content).limit(1).maybeSingle();
    if (duplicate) return reply({ source: duplicate, duplicate: true });
    const { data, error } = await auth.admin.from("knowledge_sources").insert({ user_id: auth.user.id, title, content })
      .select("id,title,content,created_at").single();
    return error ? reply({ error: "Could not import this document." }, 503) : reply({ source: data, duplicate: false }, 201);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Could not process this document." }, 400);
  }
}
