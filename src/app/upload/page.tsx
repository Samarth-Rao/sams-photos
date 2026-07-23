import type { Metadata } from "next";
import Link from "next/link";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";
import { Uploader } from "@/components/Uploader";

export const metadata: Metadata = {
  title: "Upload",
};

/**
 * Server Component so the auth check never ships a flash of the wrong UI —
 * the cookie is read before anything renders, not swapped in after hydration.
 */
export default async function UploadPage() {
  const authed = await isAuthenticated();

  return (
    <>
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="label-mono no-underline">
            sam&apos;s polaroids
          </Link>
          <p className="label-mono">upload</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        {authed ? <Uploader /> : <LoginForm />}
      </main>
    </>
  );
}
