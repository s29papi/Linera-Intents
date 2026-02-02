import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700']
});

export const metadata: Metadata = {
  title: 'Launch Your Token',
  description: 'Create a token using Linera GraphQL',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="font-display bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
