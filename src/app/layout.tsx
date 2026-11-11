import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import "./workspace.css";
import { ConfirmProvider } from "@/components/Confirm";
import { ToastProvider } from "@/components/Toast";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Social Influence Workspace",
  description: "Build a custom social influence dashboard by chatting with your data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
