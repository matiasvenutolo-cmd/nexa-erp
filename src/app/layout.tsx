import type { Metadata, Viewport } from "next";
import { Manrope, Outfit } from "next/font/google";
import "./globals.css";

// Mismas tipografías que Nexa Soluciones: Manrope para el texto, Outfit para títulos.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "NEXA · Producción y stock",
  description:
    "Sistema de producción y stock de NEXA — Conexiones Plásticas Sudamericana.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#002094",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${manrope.variable} ${outfit.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
