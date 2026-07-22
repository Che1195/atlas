import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] items-center justify-center px-6">
      <SignIn />
    </main>
  );
}
