"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";

type InviteData = {
  name: string;
  email: string;
  groupName: string;
  expiresAt: string;
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível validar o convite.");
  return payload as T;
}

export default function UserInvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    jsonFetch<InviteData>(`/api/user-invites/${token}`)
      .then((payload) => {
        if (!active) return;
        setInvite(payload);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Convite inválido ou expirado.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function acceptInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await jsonFetch(`/api/user-invites/${token}`, {
        method: "POST",
        body: JSON.stringify({
          password: String(form.get("password") ?? ""),
          passwordConfirm: String(form.get("passwordConfirm") ?? ""),
        }),
      });
      setAccepted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ativar o convite.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="invite-page">
      <section className="invite-hero">
        <div className="invite-brand"><span>H</span> HOAM WAREHOUSE</div>
        <p>Capital que move. Gestão que protege.</p>
      </section>
      <section className="invite-card">
        {loading ? (
          <p className="invite-muted">Validando convite...</p>
        ) : accepted ? (
          <>
            <CheckCircle2 className="invite-icon success" />
            <h1>Acesso ativado</h1>
            <p className="invite-muted">Sua senha foi definida com sucesso. Você já pode entrar no HOAM Warehouse.</p>
            <Link className="invite-button" href="/">Ir para o login</Link>
          </>
        ) : error ? (
          <>
            <ShieldCheck className="invite-icon" />
            <h1>Convite indisponível</h1>
            <p className="invite-muted">{error}</p>
            <Link className="invite-button secondary" href="/">Voltar ao início</Link>
          </>
        ) : (
          <>
            <KeyRound className="invite-icon" />
            <h1>Defina sua senha</h1>
            <p className="invite-muted">
              Convite para <strong>{invite?.name}</strong> acessar como {invite?.groupName}.
            </p>
            <div className="invite-summary">
              <span>E-mail</span>
              <b>{invite?.email}</b>
              <span>Validade</span>
              <b>{invite?.expiresAt ? new Date(invite.expiresAt).toLocaleDateString("pt-BR") : "Não informada"}</b>
            </div>
            <form onSubmit={acceptInvite}>
              <label>
                Nova senha
                <input name="password" minLength={8} type="password" required />
              </label>
              <label>
                Confirmar senha
                <input name="passwordConfirm" minLength={8} type="password" required />
              </label>
              {error && <p className="invite-error">{error}</p>}
              <button className="invite-button" disabled={submitting}>{submitting ? "Ativando..." : "Ativar acesso"}</button>
            </form>
          </>
        )}
      </section>
      <style jsx>{`
        .invite-page {
          min-height: 100vh;
          display: grid;
          grid-template-columns: minmax(280px, 0.95fr) minmax(320px, 1.05fr);
          background: radial-gradient(circle at 18% 24%, rgba(201, 164, 93, 0.18), transparent 30%), #080a0c;
          color: #f6f3eb;
        }
        .invite-hero {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 56px;
          border-right: 1px solid rgba(255,255,255,0.08);
        }
        .invite-brand {
          letter-spacing: 3px;
          font-size: 13px;
          font-weight: 800;
        }
        .invite-brand span {
          display: inline-grid;
          place-items: center;
          width: 36px;
          height: 36px;
          margin-right: 12px;
          border: 1px solid #c9a45d;
          color: #c9a45d;
        }
        .invite-hero p {
          max-width: 360px;
          color: #c9a45d;
          font-size: 34px;
          line-height: 1.08;
        }
        .invite-card {
          align-self: center;
          justify-self: center;
          width: min(520px, calc(100vw - 40px));
          padding: 34px;
          background: rgba(18, 21, 24, 0.94);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 18px;
          box-shadow: 0 24px 80px rgba(0,0,0,0.38);
        }
        .invite-icon {
          width: 34px;
          height: 34px;
          color: #c9a45d;
          margin-bottom: 16px;
        }
        .invite-icon.success { color: #55efaa; }
        h1 {
          margin: 0 0 10px;
          font-size: 28px;
        }
        .invite-muted {
          color: #aab1ba;
          line-height: 1.6;
        }
        .invite-summary {
          display: grid;
          grid-template-columns: 0.6fr 1.4fr;
          gap: 12px;
          margin: 24px 0;
          padding: 18px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          background: #0e1114;
        }
        .invite-summary span { color: #8d95a0; }
        .invite-summary b { text-align: right; }
        label {
          display: grid;
          gap: 8px;
          margin-bottom: 14px;
          color: #cfd4da;
          font-size: 13px;
        }
        input {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          background: #090b0d;
          color: #fff;
          padding: 13px 14px;
        }
        .invite-button {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          min-height: 44px;
          border: 0;
          border-radius: 10px;
          background: #c9a45d;
          color: #111;
          font-weight: 800;
          text-decoration: none;
          cursor: pointer;
        }
        .invite-button.secondary {
          background: transparent;
          color: #f6f3eb;
          border: 1px solid rgba(255,255,255,0.16);
        }
        .invite-button:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }
        .invite-error {
          color: #ff8a8a;
          font-size: 13px;
        }
        @media (max-width: 820px) {
          .invite-page { grid-template-columns: 1fr; }
          .invite-hero {
            padding: 28px;
            border-right: 0;
            border-bottom: 1px solid rgba(255,255,255,0.08);
          }
          .invite-hero p { font-size: 25px; }
          .invite-card { margin: 26px 0; }
        }
      `}</style>
    </main>
  );
}
