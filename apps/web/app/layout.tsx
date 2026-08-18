import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "DECIVANTA — Executive Intelligence Watch",
  description: "DECIVANTA reconnects changing conditions to the decisions they affect.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
