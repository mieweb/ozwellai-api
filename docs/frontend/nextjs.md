# Next.js Integration

Integrate Ozwell into your Next.js application with proper handling for SSR and the App Router.

## Installation

```bash
npm install @ozwell/react
# or
yarn add @ozwell/react
# or
pnpm add @ozwell/react
```

## Quick Start

### App Router (Next.js 13+)

Create a client component for the chat widget:

```tsx
// components/OzwellWidget.tsx
'use client';

import { OzwellChat } from '@ozwell/react';

export function OzwellWidget() {
  return (
    <OzwellChat 
      apiKey={process.env.NEXT_PUBLIC_OZWELL_API_KEY!}
      agentId={process.env.NEXT_PUBLIC_OZWELL_AGENT_ID!}
    />
  );
}
```

Add it to your root layout:

```tsx
// app/layout.tsx
import { OzwellWidget } from '@/components/OzwellWidget';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <OzwellWidget />
      </body>
    </html>
  );
}
```

### Pages Router

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app';
import dynamic from 'next/dynamic';

// Dynamic import with SSR disabled
const OzwellChat = dynamic(
  () => import('@ozwell/react').then((mod) => mod.OzwellChat),
  { ssr: false }
);

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <OzwellChat 
        apiKey={process.env.NEXT_PUBLIC_OZWELL_API_KEY!}
        agentId={process.env.NEXT_PUBLIC_OZWELL_AGENT_ID!}
      />
    </>
  );
}
```

---

## Environment Variables

Create a `.env.local` file:

```bash
NEXT_PUBLIC_OZWELL_API_KEY=ozw_scoped_xxxxxxxx
NEXT_PUBLIC_OZWELL_AGENT_ID=agent_xxxxxxxx
```

> ⚠️ Only use `NEXT_PUBLIC_` prefix for **scoped** API keys that are safe for client-side use.

---

## Server-Side Considerations

### Why Client-Only?

The Ozwell widget uses browser APIs (DOM, PostMessage) and must render client-side only. The `'use client'` directive or `dynamic(..., { ssr: false })` ensures this.

### Hydration Safety

The widget is rendered inside an iframe, so hydration mismatches are not a concern. However, if you're passing dynamic props:

```tsx
'use client';

import { OzwellChat } from '@ozwell/react';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

export function OzwellWidget() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  if (!mounted) return null;
  
  return (
    <OzwellChat 
      apiKey={process.env.NEXT_PUBLIC_OZWELL_API_KEY!}
      agentId={process.env.NEXT_PUBLIC_OZWELL_AGENT_ID!}
      context={{ page: pathname }}
    />
  );
}
```

---

## Examples

### With Authentication Context

Pass user data from your auth provider:

```tsx
// components/OzwellWidget.tsx
'use client';

import { OzwellChat } from '@ozwell/react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export function OzwellWidget() {
  const { data: session } = useSession();
  const pathname = usePathname();
  
  return (
    <OzwellChat 
      apiKey={process.env.NEXT_PUBLIC_OZWELL_API_KEY!}
      agentId={process.env.NEXT_PUBLIC_OZWELL_AGENT_ID!}
      context={{
        userId: session?.user?.id,
        email: session?.user?.email,
        page: pathname,
      }}
    />
  );
}
```

### Route-Based Agent Selection

Use different agents for different sections:

```tsx
// components/OzwellWidget.tsx
'use client';

import { OzwellChat } from '@ozwell/react';
import { usePathname } from 'next/navigation';

const AGENTS = {
  '/docs': 'agent_docs_xxxxxxxx',
  '/support': 'agent_support_xxxxxxxx',
  default: 'agent_general_xxxxxxxx',
};

export function OzwellWidget() {
  const pathname = usePathname();
  
  const agentId = Object.entries(AGENTS).find(
    ([path]) => pathname.startsWith(path)
  )?.[1] ?? AGENTS.default;
  
  return (
    <OzwellChat 
      apiKey={process.env.NEXT_PUBLIC_OZWELL_API_KEY!}
      agentId={agentId}
    />
  );
}
```

### Hide on Specific Routes

```tsx
// components/OzwellWidget.tsx
'use client';

import { OzwellChat } from '@ozwell/react';
import { usePathname } from 'next/navigation';

const HIDDEN_ROUTES = ['/checkout', '/auth', '/admin'];

export function OzwellWidget() {
  const pathname = usePathname();
  
  const isHidden = HIDDEN_ROUTES.some(route => 
    pathname.startsWith(route)
  );
  
  if (isHidden) return null;
  
  return (
    <OzwellChat 
      apiKey={process.env.NEXT_PUBLIC_OZWELL_API_KEY!}
      agentId={process.env.NEXT_PUBLIC_OZWELL_AGENT_ID!}
    />
  );
}
```

### With Analytics (Vercel Analytics)

Track chat lifecycle events (not content—that's private):

```tsx
// components/OzwellWidget.tsx
'use client';

import { OzwellChat } from '@ozwell/react';
import { track } from '@vercel/analytics';

export function OzwellWidget() {
  return (
    <OzwellChat 
      apiKey={process.env.NEXT_PUBLIC_OZWELL_API_KEY!}
      agentId={process.env.NEXT_PUBLIC_OZWELL_AGENT_ID!}
      onOpen={() => track('chat_opened')}
      onClose={() => track('chat_closed')}
      onUserShare={(data) => {
        // Only fires when user explicitly shares
        track('user_shared_data', data);
      }}
    />
  );
}
```

> **Privacy Note:** There is no `onMessage` callback. Conversation content is private between the user and Ozwell.

---

## Middleware Considerations

If you're using Next.js middleware for authentication, ensure the Ozwell embed domain is allowed:

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  
  // Allow Ozwell iframe
  response.headers.set(
    'Content-Security-Policy',
    "frame-src 'self' https://embed.ozwell.ai"
  );
  
  return response;
}
```

---

## TypeScript

```tsx
import type { OzwellChatProps } from '@ozwell/react';

// Typed configuration
const ozwellConfig: Partial<OzwellChatProps> = {
  theme: 'auto',
  position: 'bottom-right',
  primaryColor: '#4f46e5',
};

export function OzwellWidget() {
  return (
    <OzwellChat 
      apiKey={process.env.NEXT_PUBLIC_OZWELL_API_KEY!}
      agentId={process.env.NEXT_PUBLIC_OZWELL_AGENT_ID!}
      {...ozwellConfig}
    />
  );
}
```

---

## Troubleshooting

### "Text content does not match server-rendered HTML"

Ensure the component is client-only:

```tsx
// ✅ App Router
'use client';

// ✅ Pages Router
const OzwellChat = dynamic(() => import('@ozwell/react'), { ssr: false });
```

### Widget Not Appearing in Production

1. Verify environment variables are set in your deployment
2. Check that `NEXT_PUBLIC_` prefix is used
3. Rebuild after adding environment variables

### CSP Errors

Add Ozwell domains to your security headers in `next.config.js`:

```javascript
// next.config.js
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline';
      frame-src 'self' https://embed.ozwell.ai;
      connect-src 'self' https://api.ozwell.ai;
    `.replace(/\s{2,}/g, ' ').trim()
  }
];

module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};
```

---

## Next Steps

- [React Integration](./react.md) — Core React documentation
- [Iframe Details](./iframe-integration.md) — Security deep-dive
- [Backend API](../backend/overview.md) — Server-side integration
