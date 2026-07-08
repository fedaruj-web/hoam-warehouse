"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, FileSignature, FileText, Lock, LogOut, PenLine, UploadCloud } from "lucide-react";
import type { Assignor, DocumentRecord } from "@/lib/types";

type PortalChecklistItem = {
  requirement: string;
  label: string;
  type: DocumentRecord["type"];
  status: string;
  pending: boolean;
};

type PortalData = {
  user: { id: string; name: string; email: string; status: string };
  assignor: Assignor;
  documents: DocumentRecord[];
  checklist: PortalChecklistItem[];
  summary: {
    receivables: number;
    documents: number;
    pending: number;
    inReview: number;
    acceptedTerms: number;
    storageConfigured: boolean;
  };
  acceptedTerms: { id: string; term: string; acceptedAt: string; evidenceHash: string | null }[];
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
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível concluir a operação.");
  return payload as T;
}

async function formFetch<T>(url: string, form: FormData): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível concluir a operação.");
  return payload as T;
}

export default function AssignorPortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const completion = useMemo(() => {
    if (!data?.checklist.length) return 0;
    return Math.round(((data.checklist.length - data.summary.pending) / data.checklist.length) * 100);
  }, [data]);

  async function loadPortal() {
    setLoading(true);
    setError(null);
    try {
      setData(await jsonFetch<PortalData>("/api/assignor-portal"));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Acesso não autorizado.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    jsonFetch<PortalData>("/api/assignor-portal")
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Acesso não autorizado.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const form = new FormData(e.currentTarget);
    try {
      await jsonFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      await loadPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Credenciais inválidas.");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setData(null);
    setMessage("Sessão encerrada.");
  }

  async function submitDocument(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const form = new FormData(e.currentTarget);
    try {
      await formFetch<DocumentRecord>("/api/assignor-portal", form);
      e.currentTarget.reset();
      setMessage("Documento registrado e enviado para análise da HOAM.");
      await loadPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar o documento.");
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptTerms(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const form = new FormData(e.currentTarget);
    try {
      const response = await jsonFetch<{ evidenceHash: string }>("/api/assignor-portal", {
        method: "POST",
        body: JSON.stringify({
          action: "accept_terms",
          term: String(form.get("term") ?? "Termos operacionais do portal HOAM"),
          signerName: String(form.get("signerName") ?? ""),
          signerDocument: String(form.get("signerDocument") ?? ""),
        }),
      });
      e.currentTarget.reset();
      setMessage(`Termo aceito e auditado. Hash: ${response.evidenceHash.slice(0, 12)}...`);
      await loadPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar o aceite.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!data && !loading) {
    return (
      <main className="portal-shell">
        <section className="portal-hero">
          <div className="portal-brand"><span>H</span><b>HOAM</b><small>PORTAL DO CEDENTE</small></div>
          <div>
            <p className="eye">ACESSO EXTERNO</p>
            <h1>Documentos, termos e assinaturas em um fluxo controlado.</h1>
            <p>Entre com o usuário criado pela equipe HOAM para acompanhar pendências cadastrais e enviar documentos do seu dossiê.</p>
          </div>
          <div className="portal-trust">
            <Lock size={16} /> Acesso restrito, auditado e vinculado ao cedente.
          </div>
        </section>
        <section className="portal-login-card">
          <form onSubmit={login}>
            <FileSignature size={28} />
            <h2>Entrar no portal</h2>
            <p className="muted">Use as credenciais provisórias recebidas da equipe de cadastro.</p>
            <label>E-mail</label>
            <input name="email" type="email" required />
            <label>Senha</label>
            <input name="password" type="password" required />
            {error && <div className="portal-alert danger">{error}</div>}
            {message && <div className="portal-alert">{message}</div>}
            <button className="btn gold">Acessar portal <ArrowRight size={14} /></button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="portal-app">
      <header className="portal-topbar">
        <div className="portal-brand"><span>H</span><b>HOAM</b><small>PORTAL DO CEDENTE</small></div>
        <div className="portal-user">
          {data ? <><b>{data.user.name}</b><small>{data.user.email}</small></> : <small>Carregando sessão...</small>}
          <button className="btn" onClick={logout}><LogOut size={14} /> Sair</button>
        </div>
      </header>

      {loading && <div className="portal-loading">Carregando portal do cedente...</div>}
      {error && <div className="portal-alert danger">{error}</div>}

      {data && (
        <div className="portal-content">
          <section className="portal-heading">
            <p className="eye">ONBOARDING DOCUMENTAL</p>
            <h1>{data.assignor.nome}</h1>
            <p>{data.assignor.doc} · {data.assignor.complianceStatus ?? "Compliance pendente"} · KYC {data.assignor.kycStatus ?? "pendente"}</p>
          </section>

          <section className="portal-kpis">
            <PortalKpi label="Completude" value={`${completion}%`} icon={<CheckCircle2 />} />
            <PortalKpi label="Pendências" value={String(data.summary.pending)} icon={<FileSignature />} />
            <PortalKpi label="Documentos" value={String(data.summary.documents)} icon={<FileText />} />
            <PortalKpi label="Termos aceitos" value={String(data.summary.acceptedTerms)} icon={<PenLine />} />
          </section>

          <section className="portal-grid">
            <div className="card portal-card">
              <div className="ctitle">Checklist para habilitação do cedente</div>
              <div className="portal-checklist">
                {data.checklist.map((item) => (
                  <div className={item.pending ? "portal-check pending" : "portal-check"} key={item.requirement}>
                    <span>{item.pending ? <FileSignature size={16} /> : <CheckCircle2 size={16} />}</span>
                    <div>
                      <b>{item.label}</b>
                      <small>{item.requirement} · {item.type}</small>
                    </div>
                    <em>{item.status}</em>
                  </div>
                ))}
              </div>
            </div>

            <form className="card portal-card portal-form" onSubmit={submitDocument}>
              <div className="ctitle">Upload de documento</div>
              <label>Nome do documento</label>
              <input name="name" placeholder="Ex.: Contrato social atualizado" required />
              <label>Arquivo</label>
              <input name="file" type="file" />
              <small className="portal-hint">
                {data.summary.storageConfigured ? "Storage configurado: o arquivo será gravado no Supabase Storage." : "Storage ainda não configurado: o envio será registrado como metadado/evidência auditável."}
              </small>
              <label>Tipo</label>
              <select name="type" defaultValue="KYC">
                {["Contrato", "KYC", "Procuração", "Comprovante", "Lastro"].map((item) => <option key={item}>{item}</option>)}
              </select>
              <label>Requisito</label>
              <select name="requirement" defaultValue={data.checklist.find((item) => item.pending)?.requirement ?? "KYC_CEDENTE"}>
                {data.checklist.map((item) => <option key={item.requirement} value={item.requirement}>{item.label}</option>)}
              </select>
              <label>Vencimento, se aplicável</label>
              <input name="expiresAt" type="date" />
              <label>Observações</label>
              <textarea name="notes" placeholder="Informe protocolo, signatário ou observações relevantes." />
              <input name="stage" type="hidden" value="Cadastro" />
              {message && <div className="portal-alert">{message}</div>}
              <button className="btn gold" disabled={submitting}>
                <UploadCloud size={14} /> {submitting ? "Enviando..." : "Registrar envio"}
              </button>
            </form>
          </section>

          <section className="portal-grid">
            <form className="card portal-card portal-form" onSubmit={acceptTerms}>
              <div className="ctitle">Aceite eletrônico de termos</div>
              <label>Termo</label>
              <select name="term" defaultValue="Termos operacionais do portal HOAM">
                <option>Termos operacionais do portal HOAM</option>
                <option>Ciência das regras de cessão e envio documental</option>
                <option>Autorização para tratamento de dados cadastrais</option>
              </select>
              <label>Nome do signatário</label>
              <input name="signerName" defaultValue={data.user.name} required />
              <label>CPF / documento do signatário</label>
              <input name="signerDocument" placeholder="Informe o documento para evidência" required />
              <p className="muted">Ao confirmar, o portal registra usuário, cedente, horário e hash de evidência no audit log.</p>
              <button className="btn gold" disabled={submitting}>
                <PenLine size={14} /> {submitting ? "Registrando..." : "Aceitar e registrar"}
              </button>
            </form>

            <div className="card portal-card">
              <div className="ctitle">Termos aceitos</div>
              <div className="audit-list">
                {data.acceptedTerms.length === 0 && <div className="audit"><b>Nenhum termo aceito ainda</b><small>Os aceites aparecerão aqui com hash de evidência.</small></div>}
                {data.acceptedTerms.map((term) => (
                  <div className="audit" key={term.id}>
                    <span className="mono">{term.evidenceHash?.slice(0, 16) ?? term.id}</span>
                    <b>{term.term}</b>
                    <small>{term.acceptedAt}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="card portal-card">
            <div className="ctitle">Repositório do cedente</div>
            <table>
              <thead>
                <tr><th>Código</th><th>Documento</th><th>Tipo</th><th>Requisito</th><th>Status</th><th>Vencimento</th></tr>
              </thead>
              <tbody>
                {data.documents.length === 0 && <tr><td colSpan={6}>Nenhum documento registrado para este cedente.</td></tr>}
                {data.documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="mono">{doc.id}</td>
                    <td><div className="entity">{doc.name}</div><div className="sub">{doc.uploadedAt} · {doc.size}</div></td>
                    <td>{doc.type}</td>
                    <td><div className="entity">{doc.stage ?? "Cadastro"}</div><div className="sub">{doc.requirement ?? "Sem requisito"}</div></td>
                    <td><span className={doc.status === "Vencido" ? "badge danger" : doc.status === "Válido" ? "badge" : "badge warn"}>{doc.status}</span></td>
                    <td>{doc.expiresAt ?? "Sem vencimento"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </main>
  );
}

function PortalKpi({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="card portal-kpi"><span>{icon}</span><label>{label}</label><b>{value}</b></div>;
}
