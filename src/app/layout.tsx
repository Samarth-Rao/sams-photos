import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { formatDate, getLatestPhoto, isConfigured } from "@/lib/photos";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const SITE_NAME = "sam's polaroids";
const DESCRIPTION =
  "One photo a day, developed in public. A running streak of instant-film frames — chemical, not nostalgic.";

export async function generateMetadata(): Promise<Metadata> {
  const base: Metadata = {
    title: {
      default: SITE_NAME,
      template: `%s — ${SITE_NAME}`,
    },
    description: DESCRIPTION,
  };

  try {
    if (!isConfigured) return base;
    const latest = await getLatestPhoto();
    if (!latest) return base;

    return {
      ...base,
      openGraph: {
        title: SITE_NAME,
        description: DESCRIPTION,
        images: [
          {
            url: latest.full,
            width: latest.width,
            height: latest.height,
            alt: latest.alt ?? latest.caption ?? formatDate(latest.date),
          },
        ],
      },
    };
  } catch {
    // The manifest may not be reachable yet — fall back to static metadata
    // rather than let a metadata fetch take the whole route down.
    return base;
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {children}
      </body>
    </html>
  );
}
