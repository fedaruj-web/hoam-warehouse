import { NextResponse } from "next/server";
import { usersSeed } from "@/lib/mock-data";
import { writeAudit } from "@/server/audit";
import { createSessionToken, DEMO_PASSWORD, hashToken, mapUser, passwordMatches, SESSION_COOKIE } from "@/server/auth";
import { getDbOrNull } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null;
  const userAgent = request.headers.get("user-agent") ?? null;

  if (!email || !password) {
    return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  const db = getDbOrNull();
  const token = createSessionToken();

  if (!db) {
    const user = usersSeed.find((item) => item.email.toLowerCase() === email && item.status === "Ativo");
    if (!user || password !== DEMO_PASSWORD) {
      return NextResponse.json({ error: "Credenciais inválidas." }, { status: 401 });
    }

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  }

  const user = await db.user.findUnique({
    where: { email },
    include: { permissionGroup: { select: { code: true } } },
  });

  if (!user || user.status !== "ACTIVE" || !passwordMatches(password, user.passwordHash)) {
    await writeAudit(db, {
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: email,
      ipAddress,
      after: { email, userAgent },
    });
    return NextResponse.json({ error: "Credenciais inválidas." }, { status: 401 });
  }

  await db.userSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      ipAddress,
      userAgent,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8),
    },
  });
  await writeAudit(db, {
    action: "LOGIN_SUCCESS",
    entityType: "User",
    entityId: user.id,
    userId: user.id,
    ipAddress,
    after: { email: user.email, userAgent },
  });

  const response = NextResponse.json({ user: mapUser(user) });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
