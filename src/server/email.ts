type SendConfirmationEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

type SendEmailResult =
  | { status: "skipped"; reason: string }
  | { status: "sent"; providerId: string | null }
  | { status: "failed"; reason: string };

function resendApiKey() {
  return process.env.RESEND_API_KEY?.trim();
}

function sender() {
  return process.env.CONFIRMATION_EMAIL_FROM?.trim() || "HOAM Warehouse <onboarding@resend.dev>";
}

export async function sendTransactionalEmail(input: SendConfirmationEmailInput): Promise<SendEmailResult> {
  const apiKey = resendApiKey();
  if (!apiKey) return { status: "skipped", reason: "RESEND_API_KEY não configurada." };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: sender(),
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { status: "failed", reason: payload?.message ?? payload?.error ?? "Falha no provedor de e-mail." };
    return { status: "sent", providerId: payload?.id ?? null };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Falha inesperada no envio." };
  }
}

export async function sendConfirmationEmail(input: SendConfirmationEmailInput): Promise<SendEmailResult> {
  return sendTransactionalEmail(input);
}

export async function sendUserInviteEmail(input: SendConfirmationEmailInput): Promise<SendEmailResult> {
  return sendTransactionalEmail(input);
}

export function buildUserInviteEmail(params: {
  name: string;
  email: string;
  groupName: string;
  link: string;
  expiresAt: Date;
}) {
  const expires = params.expiresAt.toLocaleDateString("pt-BR");
  const subject = "Convite de acesso · HOAM Warehouse";
  const text = [
    `Olá, ${params.name}.`,
    ``,
    `Você foi convidado(a) para acessar o HOAM Warehouse com o perfil ${params.groupName}.`,
    `E-mail de acesso: ${params.email}`,
    ``,
    `Defina sua senha pelo link seguro até ${expires}:`,
    params.link,
    ``,
    `Se você não esperava este convite, ignore esta mensagem.`,
  ].join("\n");
  const html = `
    <div style="margin:0;padding:32px;background:#090b0d;color:#f5f5f3;font-family:Arial,sans-serif">
      <div style="max-width:640px;margin:auto;background:#121518;border:1px solid #292d31;border-radius:14px;padding:28px">
        <div style="letter-spacing:2px;color:#c9a45d;font-weight:700;margin-bottom:22px">HOAM WAREHOUSE</div>
        <h1 style="font-size:24px;line-height:1.2;margin:0 0 12px;color:#ffffff">Convite de acesso</h1>
        <p style="color:#a7adb4;line-height:1.6">Olá, ${params.name}. Você foi convidado(a) para acessar o HOAM Warehouse.</p>
        <div style="border:1px solid #292d31;border-radius:10px;padding:16px;margin:20px 0;background:#0f1113">
          <p><strong>E-mail:</strong> ${params.email}</p>
          <p><strong>Perfil:</strong> ${params.groupName}</p>
        </div>
        <a href="${params.link}" style="display:inline-block;background:#c9a45d;color:#111;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:8px">Definir senha e acessar</a>
        <p style="color:#8c9299;font-size:12px;margin-top:20px">Link válido até ${expires}. Caso você não esperasse este convite, ignore esta mensagem.</p>
      </div>
    </div>
  `;
  return { subject, text, html };
}

export function buildConfirmationEmail(params: {
  assignorName: string;
  debtorName: string;
  receivableId: string;
  faceValue: string;
  dueDate: string;
  link: string;
  expiresAt: Date;
}) {
  const expires = params.expiresAt.toLocaleDateString("pt-BR");
  const subject = `Confirmação de duplicata ${params.receivableId} · HOAM Warehouse`;
  const text = [
    `Prezados,`,
    ``,
    `A HOAM solicita a confirmação das informações da duplicata ${params.receivableId}.`,
    `Cedente: ${params.assignorName}`,
    `Sacado: ${params.debtorName}`,
    `Valor: ${params.faceValue}`,
    `Vencimento: ${params.dueDate}`,
    ``,
    `Acesse o link seguro até ${expires}:`,
    params.link,
    ``,
    `Não é necessário cadastro. A resposta será registrada com evidência eletrônica.`,
  ].join("\n");
  const html = `
    <div style="margin:0;padding:32px;background:#090b0d;color:#f5f5f3;font-family:Arial,sans-serif">
      <div style="max-width:640px;margin:auto;background:#121518;border:1px solid #292d31;border-radius:14px;padding:28px">
        <div style="letter-spacing:2px;color:#c9a45d;font-weight:700;margin-bottom:22px">HOAM WAREHOUSE</div>
        <h1 style="font-size:24px;line-height:1.2;margin:0 0 12px;color:#ffffff">Confirmação de duplicata</h1>
        <p style="color:#a7adb4;line-height:1.6">Solicitamos a confirmação das informações abaixo. Não é necessário criar conta ou senha.</p>
        <div style="border:1px solid #292d31;border-radius:10px;padding:16px;margin:20px 0;background:#0f1113">
          <p><strong>Duplicata:</strong> ${params.receivableId}</p>
          <p><strong>Cedente:</strong> ${params.assignorName}</p>
          <p><strong>Sacado:</strong> ${params.debtorName}</p>
          <p><strong>Valor:</strong> ${params.faceValue}</p>
          <p><strong>Vencimento:</strong> ${params.dueDate}</p>
        </div>
        <a href="${params.link}" style="display:inline-block;background:#c9a45d;color:#111;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:8px">Confirmar informações</a>
        <p style="color:#8c9299;font-size:12px;margin-top:20px">Link válido até ${expires}. A resposta será registrada com data, hora, IP, navegador e hash de evidência.</p>
      </div>
    </div>
  `;
  return { subject, text, html };
}
