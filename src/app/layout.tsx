import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import "./workspace.css";
import { ConfirmProvider } from "@/components/Confirm";
import { ToastProvider } from "@/components/Toast";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { getWorkspace } from "@/lib/brands";
import { ensureReady } from "@/lib/schema";

// The layout reads the workspace from the database, so nothing is prerendered at build time.
export const dynamic = "force-dynamic";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureReady();
  const workspace = getWorkspace();
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <WorkspaceProvider workspace={workspace}>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
