"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileQuestion, ShieldCheck } from "lucide-react";

type ConfirmationData = {
  token: string;
  expiresAt: string;
  usedAt: string | null;
  expired: boolean;
  receivable: {
    id: string;
    assignor: string;
    debtor: string;
    issueDate: string;
    dueDate: string;
    faceValue: string;
    confirmationStatus: string;
  };
};

function money(value: string) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function date(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

export default function PublicConfirmationPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<ConfirmationData | null>(null);
  const [response, setResponse] = useState("confirmed");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/confirm/${token}`)
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "Link inválido.");
        return payload as ConfirmationData;
      })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Link inválido.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/confirm/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response,
          respondentName: String(form.get("respondentName") ?? ""),
          respondentRole: String(form.get("respondentRole") ?? ""),
          respondentEmail: String(form.get("respondentEmail") ?? ""),
          respondentPhone: String(form.get("respondentPhone") ?? ""),
          responseNotes: String(form.get("responseNotes") ?? ""),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Não foi possível registrar a resposta.");
      setMessage(`Resposta registrada com sucesso. Protocolo: ${String(payload.evidenceHash).slice(0, 16)}`);
      setData((current) => current ? { ...current, usedAt: new Date().toISOString(), receivable: { ...current.receivable, confirmationStatus: response === "confirmed" ? "Confirmado" : response === "divergent" ? "Divergente" : "Não reconhecido" } } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a resposta.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="public-confirm">
      <section className="public-confirm-card">
        <div className="portal-brand"><span>H</span><b>HOAM</b><small>CONFIRMAÇÃO DE DUPLICATA</small></div>
        {loading && <p className="muted">Carregando dados da confirmação...</p>}
        {error && <div className="portal-alert danger">{error}</div>}
        {data && (
          <>
            <div className="confirm-head">
              <p className="eye">LINK SEGURO SEM CADASTRO</p>
              <h1>Confirme as informações da duplicata</h1>
              <p>Esta tela não exige login. A resposta será registrada com data, hora, IP, navegador e hash de evidência.</p>
            </div>

            <div className="confirm-summary">
              <div><small>Duplicata</small><b>{data.receivable.id}</b></div>
              <div><small>Cedente</small><b>{data.receivable.assignor}</b></div>
              <div><small>Sacado</small><b>{data.receivable.debtor}</b></div>
              <div><small>Valor</small><b>{money(data.receivable.faceValue)}</b></div>
              <div><small>Emissão</small><b>{date(data.receivable.issueDate)}</b></div>
              <div><small>Vencimento</small><b>{date(data.receivable.dueDate)}</b></div>
            </div>

            {(data.expired || data.usedAt) && (
              <div className="portal-alert danger">
                {data.usedAt ? "Este link já foi utilizado." : "Este link expirou. Solicite uma nova confirmação à HOAM."}
              </div>
            )}

            {!data.expired && !data.usedAt && (
              <form className="confirm-form" onSubmit={submit}>
                <div className="confirm-choice">
                  <button className={response === "confirmed" ? "active" : ""} type="button" onClick={() => setResponse("confirmed")}><CheckCircle2 /> Confirmo</button>
                  <button className={response === "divergent" ? "active" : ""} type="button" onClick={() => setResponse("divergent")}><AlertTriangle /> Há divergência</button>
                  <button className={response === "rejected" ? "active" : ""} type="button" onClick={() => setResponse("rejected")}><FileQuestion /> Não reconheço</button>
                </div>

                <div className="formgrid">
                  <Field label="Nome do responsável" name="respondentName" />
                  <Field label="Cargo / área" name="respondentRole" />
                  <Field label="E-mail corporativo" name="respondentEmail" type="email" />
                  <Field label="Telefone" name="respondentPhone" required={false} />
                </div>

                <label className="confirm-label">Observações {response !== "confirmed" ? "(obrigatório)" : "(opcional)"}</label>
                <textarea name="responseNotes" placeholder="Descreva divergência, motivo do não reconhecimento ou observações relevantes." />

                <label className="confirm-accept">
                  <input required type="checkbox" /> Declaro que as informações acima são verdadeiras e que possuo autoridade para responder por esta confirmação.
                </label>

                {message && <div className="portal-alert">{message}</div>}
                {error && <div className="portal-alert danger">{error}</div>}
                <button className="btn gold" disabled={submitting}>
                  <ShieldCheck size={14} /> {submitting ? "Registrando..." : "Enviar confirmação"}
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function Field({ label, name, type, required = true }: { label: string; name: string; type?: string; required?: boolean }) {
  return <div className="field"><label>{label}</label><input name={name} required={required} type={type} /></div>;
}
