import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "DECIVANTA",
  description: "Longitudinal executive intelligence that acts because it remembers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
