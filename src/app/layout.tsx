import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Work Storage", description: "Seu cofre pessoal de informações" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" suppressHydrationWarning><body>{children}</body></html>;
}
