import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] items-center justify-center px-6">
      <SignUp />
    </main>
  );
}
