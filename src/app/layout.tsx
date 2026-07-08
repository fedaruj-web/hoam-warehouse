import type { Metadata } from "next";
import "./globals.css";
import "./improvements.css";

export const metadata: Metadata = {
  title: "HOAM Warehouse",
  description: "Gestão de direitos creditórios",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
