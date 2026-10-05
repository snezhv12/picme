import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { HeartWatermark } from "./_components/Heart";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PicMe",
  description: "Show a photo. Everyone guesses whose it is.",
  applicationName: "PicMe",
  // iPhone: open full screen from the home screen, with a light status bar
  appleWebApp: { capable: true, title: "PicMe", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Older iPhones (before iOS 16.4) ignore the manifest and need this tag
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#fff5f8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${instrumentSans.variable} h-full antialiased`}>
      <body className="relative isolate flex min-h-full flex-col font-sans">
        <HeartWatermark />
        {children}
      </body>
    </html>
  );
}
