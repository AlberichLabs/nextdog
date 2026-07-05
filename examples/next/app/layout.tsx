import type { ReactNode } from 'react';
// Optional NextDog step: inject the browser console-capture script so browser
// `console.*` calls are captured and correlated to the server trace that rendered
// the page. getNextDogScript() returns null outside development, so this is inert
// in production.
import { getNextDogScript } from '@nextdog/next/client';

export const metadata = {
  title: 'NextDog · example-next',
  description: 'A tiny Next.js app instrumented with NextDog.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const script = getNextDogScript();
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          margin: 0,
          background: '#0b1120',
          color: '#e2e8f0',
        }}
      >
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: NextDog's documented browser-capture hook returns an inert, dev-only script string. */}
        {script && <script dangerouslySetInnerHTML={script} />}
        {children}
      </body>
    </html>
  );
}
